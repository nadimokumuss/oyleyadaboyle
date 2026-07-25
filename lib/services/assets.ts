import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  assets, transactions, deposits, properties, vehicles, ventures, accounts,
} from "@/db/schema";
import Decimal from "decimal.js";
import { Money } from "@/lib/money";
import type {
  CashInput, PositionInput, DepositInput, PropertyInput,
  VehicleInput, VentureInput, AccountInput, TransactionInput,
} from "@/lib/schemas";
import { historicalUsdRate } from "@/lib/market/fxStore";
import { applyFunding, clearFundingFor } from "./funding";
import { toFundingInput, type FundingFields } from "@/lib/schemas";

/**
 * Varlık yazma katmanı.
 *
 * Server Action'lardan ayrı tutuldu: burası saf veri işi, HTTP veya
 * çerez bilmiyor. Böylece doğrudan test edilebiliyor ve aynı mantık
 * CSV içe aktarımı gibi başka yerlerden de çağrılabiliyor.
 *
 * Ortak kural: her varlık `assets` satırı + türüne özel uzantı satırı.
 * Alım/satım gibi para hareketleri `transactions`'a yazılır; bakiye
 * hiçbir zaman saklanmaz, oradan türetilir.
 */

const now = () => new Date().toISOString();

/** Alış tarihindeki kuru çeker; bulunamazsa null — uydurmaz. */
async function resolveFxRate(
  currency: string,
  date: string,
): Promise<string | null> {
  if (currency.toUpperCase() === "USD") return "1";
  try {
    return await historicalUsdRate(currency, date);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Hesap                                                               */
/* ------------------------------------------------------------------ */

export function saveAccount(input: AccountInput): string {
  const id = input.id ?? randomUUID();
  const values = {
    institution: input.institution,
    country: input.country,
    type: input.type,
    currency: input.currency,
    note: input.note,
    updatedAt: now(),
  };

  if (input.id) {
    db.update(accounts).set(values).where(eq(accounts.id, input.id)).run();
  } else {
    db.insert(accounts).values({ id, ...values, createdAt: now() }).run();
  }
  return id;
}

/* ------------------------------------------------------------------ */
/* Nakit                                                               */
/* ------------------------------------------------------------------ */

export function saveCash(input: CashInput): string {
  const id = input.id ?? randomUUID();

  upsertAsset(id, {
    kind: "cash",
    name: input.name,
    symbol: null,
    accountId: input.accountId,
    currency: input.currency,
    country: input.country,
    status: "active",
    liquidity: "instant",
    note: input.note,
    isNew: !input.id,
  });

  if (input.id) {
    // Düzenlemede: bakiyeyi tek bir düzeltme işlemine indir.
    // Geçmişi silmek yerine üzerine yazmak, işlem defterini
    // anlaşılmaz hale getirirdi.
    db.delete(transactions).where(eq(transactions.assetId, id)).run();
  }

  db.insert(transactions)
    .values({
      id: randomUUID(),
      assetId: id,
      type: "deposit_in",
      date: new Date().toISOString().slice(0, 10),
      quantity: null,
      pricePerUnit: null,
      amount: input.amount,
      currency: input.currency,
      fxRateToUsd: input.currency === "USD" ? "1" : null,
      fee: null,
      note: "Bakiye girişi",
      createdAt: now(),
      updatedAt: now(),
    })
    .run();

  return id;
}

/* ------------------------------------------------------------------ */
/* Piyasa pozisyonu                                                    */
/* ------------------------------------------------------------------ */

export async function savePosition(input: PositionInput): Promise<string> {
  const id = input.id ?? randomUUID();

  upsertAsset(id, {
    kind: input.kind,
    name: input.name,
    symbol: input.symbol,
    accountId: input.accountId,
    currency: input.currency,
    country: input.country,
    status: input.status,
    liquidity: input.kind === "crypto" ? "instant" : "days",
    note: input.note,
    isNew: !input.id,
  });

  // Toplam tutar = miktar × birim fiyat. Kullanıcıdan toplam istemek
  // yerine birim fiyat istemek daha az hataya yol açıyor.
  const amount = new Decimal(input.quantity).times(input.pricePerUnit).toFixed();
  const fxRate = await resolveFxRate(input.currency, input.purchaseDate);

  if (input.id) {
    db.delete(transactions).where(eq(transactions.assetId, id)).run();
  }

  db.insert(transactions)
    .values({
      id: randomUUID(),
      assetId: id,
      type: "buy",
      date: input.purchaseDate,
      quantity: input.quantity,
      pricePerUnit: input.pricePerUnit,
      amount,
      currency: input.currency,
      fxRateToUsd: fxRate,
      fee: input.fee === "0" ? null : input.fee,
      note: input.status === "planned" ? "Planlanan alım" : "Alım",
      createdAt: now(),
      updatedAt: now(),
    })
    .run();

  // Planlananlar henüz ödenmedi — finansman satın alındığında uygulanır
  if (input.status !== "planned") {
    await applyFunding(
      id,
      Money.of(amount, input.currency).plus(Money.fromDb(input.fee, input.currency)),
      input.purchaseDate,
      toFundingInput(input as unknown as FundingFields, input.purchaseDate),
    );
  }

  return id;
}

/* ------------------------------------------------------------------ */
/* Mevduat                                                             */
/* ------------------------------------------------------------------ */

export async function saveDeposit(input: DepositInput): Promise<string> {
  const id = input.id ?? randomUUID();

  upsertAsset(id, {
    kind: "deposit",
    name: input.name,
    symbol: null,
    accountId: input.accountId,
    currency: input.currency,
    country: null,
    status: "active",
    liquidity: input.maturityDate ? "months" : "instant",
    note: input.note,
    isNew: !input.id,
  });

  const values = {
    principal: input.principal,
    annualRate: input.annualRate,
    compounding: input.compounding,
    dayCount: input.dayCount,
    startDate: input.startDate,
    maturityDate: input.maturityDate,
    withholdingRateOverride: input.withholdingRateOverride,
    autoRenew: input.autoRenew,
  };

  const exists = db.select().from(deposits).where(eq(deposits.assetId, id)).get();
  if (exists) {
    db.update(deposits).set(values).where(eq(deposits.assetId, id)).run();
  } else {
    db.insert(deposits).values({ assetId: id, ...values }).run();
  }

  // Mevduata para yatırmak nakit çıkışıdır
  await applyFunding(
    id,
    Money.of(input.principal, input.currency),
    input.startDate,
    toFundingInput(input as unknown as FundingFields, input.startDate),
  );

  return id;
}

/* ------------------------------------------------------------------ */
/* Gayrimenkul                                                         */
/* ------------------------------------------------------------------ */

export async function saveProperty(input: PropertyInput): Promise<string> {
  const id = input.id ?? randomUUID();

  upsertAsset(id, {
    kind: "realestate",
    name: input.name,
    symbol: null,
    accountId: null,
    currency: input.currency,
    country: input.country,
    status: input.status,
    liquidity: "months",
    note: input.note,
    isNew: !input.id,
  });

  const values = {
    addressLine: input.addressLine,
    city: input.city,
    country: input.country,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    purchasePrice: input.purchasePrice,
    purchaseDate: input.purchaseDate,
    closingCosts: input.closingCosts,
    renovationCost: input.renovationCost,
    indexKey: input.indexKey,
    manualValue: input.manualValue,
    manualValueDate: input.manualValue ? new Date().toISOString().slice(0, 10) : null,
    monthlyRent: input.monthlyRent,
    occupancyRate: input.occupancyRate,
    monthlyCosts: {
      hoa: input.hoa,
      tax: input.propertyTax,
      insurance: input.insurance,
      maintenance: input.maintenance,
    },
  };

  const exists = db.select().from(properties).where(eq(properties.assetId, id)).get();
  if (exists) {
    db.update(properties).set(values).where(eq(properties.assetId, id)).run();
  } else {
    db.insert(properties).values({ assetId: id, ...values }).run();
  }

  // Alış tarihindeki kuru kaydet — kur etkisi ayrıştırması buna bağlı
  await resolveFxRate(input.currency, input.purchaseDate);

  if (input.status !== "planned") {
    const totalCost = Money.of(input.purchasePrice, input.currency)
      .plus(Money.fromDb(input.closingCosts, input.currency))
      .plus(Money.fromDb(input.renovationCost, input.currency));
    await applyFunding(
      id,
      totalCost,
      input.purchaseDate,
      toFundingInput(input as unknown as FundingFields, input.purchaseDate),
    );
  }

  return id;
}

/* ------------------------------------------------------------------ */
/* Araç                                                                */
/* ------------------------------------------------------------------ */

export async function saveVehicle(input: VehicleInput): Promise<string> {
  const id = input.id ?? randomUUID();

  upsertAsset(id, {
    kind: "vehicle",
    name: input.name,
    symbol: null,
    accountId: null,
    currency: input.currency,
    country: input.country,
    status: input.status,
    liquidity: "weeks",
    note: input.note,
    isNew: !input.id,
  });

  const values = {
    make: input.make,
    model: input.model,
    year: input.year,
    odometer: input.odometer,
    country: input.country,
    segment: input.segment,
    purchasePrice: input.purchasePrice,
    purchaseDate: input.purchaseDate,
    manualValue: input.manualValue,
    manualValueDate: input.manualValue ? new Date().toISOString().slice(0, 10) : null,
    annualCosts: {
      insurance: input.insurance,
      tax: input.tax,
      maintenance: input.maintenance,
      fuel: input.fuel,
    },
  };

  const exists = db.select().from(vehicles).where(eq(vehicles.assetId, id)).get();
  if (exists) {
    db.update(vehicles).set(values).where(eq(vehicles.assetId, id)).run();
  } else {
    db.insert(vehicles).values({ assetId: id, ...values }).run();
  }

  await resolveFxRate(input.currency, input.purchaseDate);

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
/* Girişim                                                             */
/* ------------------------------------------------------------------ */

export async function saveVenture(input: VentureInput): Promise<string> {
  const id = input.id ?? randomUUID();

  upsertAsset(id, {
    kind: "venture",
    name: input.name,
    symbol: null,
    accountId: null,
    currency: input.currency,
    country: input.country,
    status: input.status,
    liquidity: "illiquid",
    note: input.note,
    isNew: !input.id,
  });

  const values = {
    legalName: input.legalName,
    country: input.country,
    sector: input.sector,
    ownershipPct: input.ownershipPct,
    committedCapital: input.committedCapital,
    calledCapital: input.calledCapital,
    valuation: input.valuation,
    valuationDate: input.valuationDate,
    monthlyRevenue: input.monthlyRevenue,
    monthlyBurn: input.monthlyBurn,
    cashOnHand: input.cashOnHand,
    stage: input.stage,
  };

  const exists = db.select().from(ventures).where(eq(ventures.assetId, id)).get();
  if (exists) {
    db.update(ventures).set(values).where(eq(ventures.assetId, id)).run();
  } else {
    db.insert(ventures).values({ assetId: id, ...values }).run();
  }

  // Ödenen sermaye kadar nakit çıkışı; taahhüt edilen ama ödenmeyen kısım değil
  if (input.status !== "planned") {
    await applyFunding(
      id,
      Money.of(input.calledCapital, input.currency),
      new Date().toISOString().slice(0, 10),
      toFundingInput(input as unknown as FundingFields, new Date().toISOString().slice(0, 10)),
    );
  }

  return id;
}

/* ------------------------------------------------------------------ */
/* İşlem ekleme                                                        */
/* ------------------------------------------------------------------ */

export async function saveTransaction(input: TransactionInput): Promise<string> {
  const id = input.id ?? randomUUID();
  const fxRate = await resolveFxRate(input.currency, input.date);

  const values = {
    assetId: input.assetId,
    type: input.type,
    date: input.date,
    quantity: input.quantity,
    pricePerUnit: input.pricePerUnit,
    amount: input.amount,
    currency: input.currency,
    fxRateToUsd: fxRate,
    fee: input.fee === "0" ? null : input.fee,
    note: input.note,
    updatedAt: now(),
  };

  if (input.id) {
    db.update(transactions).set(values).where(eq(transactions.id, input.id)).run();
  } else {
    db.insert(transactions).values({ id, ...values, createdAt: now() }).run();
  }
  return id;
}

export function deleteTransaction(id: string): void {
  db.delete(transactions).where(eq(transactions.id, id)).run();
}

/* ------------------------------------------------------------------ */
/* Silme ve durum değişikliği                                          */
/* ------------------------------------------------------------------ */

/** Varlığı ve bağlı tüm kayıtlarını siler (cascade şemada tanımlı). */
export function deleteAsset(id: string): void {
  // Finansman kayıtları da temizlenmeli, yoksa silinen varlığın
  // nakit çıkışı ve kredisi ortada kalır
  clearFundingFor(id);
  db.delete(assets).where(eq(assets.id, id)).run();
}

/**
 * Planlanan bir varlığı gerçek varlığa çevirir.
 *
 * Nakit varsa düşülür: plandaki bir ev satın alındığında hem varlık
 * eklenmeli hem nakit azalmalı, yoksa servet bir anda şişer.
 */
export function markAsPurchased(
  assetId: string,
  opts: { deductFromCashAssetId?: string; amount?: string; currency?: string } = {},
): void {
  db.update(assets)
    .set({ status: "active", updatedAt: now() })
    .where(eq(assets.id, assetId))
    .run();

  if (opts.deductFromCashAssetId && opts.amount && opts.currency) {
    db.insert(transactions)
      .values({
        id: randomUUID(),
        assetId: opts.deductFromCashAssetId,
        type: "withdraw",
        date: new Date().toISOString().slice(0, 10),
        quantity: null,
        pricePerUnit: null,
        amount: opts.amount,
        currency: opts.currency,
        fxRateToUsd: opts.currency === "USD" ? "1" : null,
        fee: null,
        note: "Planlanan alım gerçekleşti",
        createdAt: now(),
        updatedAt: now(),
      })
      .run();
  }
}

/* ------------------------------------------------------------------ */
/* Ortak varlık satırı                                                 */
/* ------------------------------------------------------------------ */

function upsertAsset(
  id: string,
  v: {
    kind: typeof assets.$inferInsert.kind;
    name: string;
    symbol: string | null;
    accountId: string | null;
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
    symbol: v.symbol,
    accountId: v.accountId,
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
