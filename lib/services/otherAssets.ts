import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { assets, bonds, pensions, collectibles, transactions } from "@/db/schema";
import { Money } from "@/lib/money";
import { applyFunding } from "./funding";
import { toFundingInput, type FundingFields } from "@/lib/schemas";
import type { BondInput, PensionInput, CollectibleInput } from "@/lib/schemas";

/**
 * Tahvil, emeklilik ve kıymetli eşya için yazma katmanı.
 *
 * `lib/services/assets.ts` ile aynı desen: ortak `assets` satırı + tür
 * uzantısı + finansman. Ayrı dosyada tutuldu çünkü `assets.ts` zaten
 * 500 satırı aşmış durumda.
 *
 * **Emeklilik finansman akışına girmez.** BES katkısı maaştan kesilir
 * veya otomatik ödemeyle gider; alım anında nakit düşüren tek seferlik
 * bir edinim değildir. Zorlamak yanlış nakit hareketi üretirdi.
 */

const now = () => new Date().toISOString();

function upsertAssetRow(
  id: string,
  v: {
    kind: typeof assets.$inferInsert.kind;
    name: string;
    currency: string;
    country: string | null;
    status: "active" | "planned";
    liquidity: typeof assets.$inferInsert.liquidity;
    note: string | null;
    isNew: boolean;
  },
): void {
  const values = {
    kind: v.kind,
    name: v.name,
    symbol: null,
    accountId: null,
    currency: v.currency,
    country: v.country,
    status: v.status,
    liquidity: v.liquidity,
    note: v.note,
    updatedAt: now(),
  };

  if (v.isNew) {
    db.insert(assets).values({ id, ...values, tags: [], createdAt: now() }).run();
  } else {
    db.update(assets).set(values).where(eq(assets.id, id)).run();
  }
}

/* ------------------------------------------------------------------ */
/* Tahvil                                                              */
/* ------------------------------------------------------------------ */

export async function saveBond(input: BondInput): Promise<string> {
  const id = input.id ?? randomUUID();

  upsertAssetRow(id, {
    kind: "bond",
    name: input.name,
    currency: input.currency,
    country: input.country,
    status: input.status,
    liquidity: input.liquidity,
    note: input.note,
    isNew: !input.id,
  });

  const values = {
    issuer: input.issuer,
    faceValue: input.faceValue,
    couponRate: input.couponRate,
    couponsPerYear: input.couponsPerYear,
    purchasePrice: input.purchasePrice,
    purchaseDate: input.purchaseDate,
    maturityDate: input.maturityDate,
    dayCount: input.dayCount,
    marketPricePct: input.marketPricePct,
    marketPriceDate: input.marketPricePct ? new Date().toISOString().slice(0, 10) : null,
    withholdingRate: input.withholdingRate,
    note: input.note,
  };

  const exists = db.select().from(bonds).where(eq(bonds.assetId, id)).get();
  if (exists) {
    db.update(bonds).set(values).where(eq(bonds.assetId, id)).run();
  } else {
    db.insert(bonds).values({ assetId: id, ...values }).run();
  }

  if (input.status !== "planned") {
    await applyFunding(
      id,
      Money.of(input.purchasePrice, input.currency),
      input.purchaseDate,
      toFundingInput(input as unknown as FundingFields, input.purchaseDate),
    );
  }

  return id;
}

/* ------------------------------------------------------------------ */
/* Emeklilik                                                           */
/* ------------------------------------------------------------------ */

export function savePension(input: PensionInput): string {
  const id = input.id ?? randomUUID();

  upsertAssetRow(id, {
    kind: "pension",
    name: input.name,
    currency: input.currency,
    country: input.country,
    // Emeklilik hesabı tanım gereği uzun vadeli bağlıdır: erken çıkış
    // hem devlet katkısını hem vergi avantajını yakar.
    liquidity: "illiquid",
    status: "active",
    note: input.note,
    isNew: !input.id,
  });

  const values = {
    provider: input.provider,
    startDate: input.startDate,
    participantBalance: input.participantBalance,
    stateContribution: input.stateContribution,
    monthlyContribution: input.monthlyContribution,
    // Boş bırakılırsa Türkiye varsayılan kademeleri kullanılır.
    vestingTiers: [],
    retirementDate: input.retirementDate,
    note: input.note,
  };

  const exists = db.select().from(pensions).where(eq(pensions.assetId, id)).get();
  if (exists) {
    db.update(pensions).set(values).where(eq(pensions.assetId, id)).run();
  } else {
    db.insert(pensions).values({ assetId: id, ...values }).run();
  }

  return id;
}

/* ------------------------------------------------------------------ */
/* Kıymetli eşya                                                       */
/* ------------------------------------------------------------------ */

export async function saveCollectible(input: CollectibleInput): Promise<string> {
  const id = input.id ?? randomUUID();

  upsertAssetRow(id, {
    kind: "collectible",
    name: input.name,
    currency: input.currency,
    country: input.country,
    status: input.status,
    // Satışı alıcı bulmaya bağlı — günler değil aylar sürer.
    liquidity: "months",
    note: input.note,
    isNew: !input.id,
  });

  const values = {
    category: input.category,
    maker: input.maker,
    year: input.year ?? null,
    purchasePrice: input.purchasePrice,
    purchaseDate: input.purchaseDate,
    appraisalValue: input.appraisalValue,
    appraisalDate: input.appraisalValue
      ? (input.appraisalDate ?? new Date().toISOString().slice(0, 10))
      : null,
    annualCosts: input.annualCosts,
    note: input.note,
  };

  const exists = db.select().from(collectibles).where(eq(collectibles.assetId, id)).get();
  if (exists) {
    db.update(collectibles).set(values).where(eq(collectibles.assetId, id)).run();
  } else {
    db.insert(collectibles).values({ assetId: id, ...values }).run();
  }

  if (input.status !== "planned") {
    await applyFunding(
      id,
      Money.of(input.purchasePrice, input.currency),
      input.purchaseDate,
      toFundingInput(input as unknown as FundingFields, input.purchaseDate),
    );
  }

  return id;
}

/* ------------------------------------------------------------------ */
/* Emeklilik katkısı kaydı                                             */
/* ------------------------------------------------------------------ */

/**
 * BES bakiyesini elle günceller ve farkı işlem olarak yazar.
 *
 * Bakiye fon getirisiyle de değişir, katkıyla da; ikisini ayırmak için
 * ek veri gerekir. Bu yüzden fark tek bir `valuation` kaydı olarak
 * yazılır — nakit akışı doğurmaz, yalnızca değişimi tarihe bağlar.
 */
export function recordPensionBalance(
  assetId: string,
  participantBalance: string,
  stateContribution: string,
): void {
  const asset = db.select().from(assets).where(eq(assets.id, assetId)).get();
  if (!asset || asset.kind !== "pension") return;

  db.update(pensions)
    .set({ participantBalance, stateContribution })
    .where(eq(pensions.assetId, assetId))
    .run();

  db.insert(transactions)
    .values({
      id: randomUUID(),
      assetId,
      type: "valuation",
      date: new Date().toISOString().slice(0, 10),
      amount: participantBalance,
      currency: asset.currency,
      fxRateToUsd: asset.currency.toUpperCase() === "USD" ? "1" : null,
      note: "Bakiye güncellendi",
      createdAt: now(),
      updatedAt: now(),
    })
    .run();
}
