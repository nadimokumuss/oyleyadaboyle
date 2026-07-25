import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import {
  assets, transactions, deposits, liabilities, properties, vehicles, ventures,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { Money } from "@/lib/money";
import { getFx } from "@/lib/market/fxStore";
import { computePosition } from "@/lib/finance/costbasis";
import { accrue } from "@/lib/finance/deposit";
import { buildTerms, loadWithholdingRules } from "@/lib/finance/depositService";
import { summarizeLoan } from "@/lib/finance/loan";
import { paymentsFor } from "./liabilities";

/**
 * Satış, kapatma ve çıkış işlemleri.
 *
 * Ortak kural: bir varlıktan çıkmak nakit girişi doğurur. Varlık
 * silinmez, `sold`/`closed` olarak işaretlenir — geçmiş performansınız
 * ve gerçekleşen kâr-zararınız kayıtta kalır. Sattığınız evi silmek,
 * o evi hiç almamış gibi yapmak olurdu.
 *
 * Bağlı kredi varsa satıştan **önce** kapatılır; hasılatın kalanı
 * nakde geçer. Aksi halde ev gider, borç kalır.
 */

const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

export interface DisposeResult {
  /** Nakde geçen net tutar (varlığın para biriminde). */
  netProceeds: Money;
  /** Kapatılan kredi tutarı. */
  loanSettled: Money;
  /** Gerçekleşen kâr/zarar. */
  realizedPnl: Money | null;
  warnings: string[];
}

/** Hasılatı nakit hesabına yazar; gerekirse para birimi çevirir. */
async function creditCash(
  cashAssetId: string | null | undefined,
  amount: Money,
  date: string,
  note: string,
): Promise<string[]> {
  const warnings: string[] = [];
  if (!amount.isPositive()) return warnings;

  if (!cashAssetId) {
    warnings.push(
      "Hasılatın gideceği hesap seçilmedi — para hiçbir hesaba işlenmedi.",
    );
    return warnings;
  }

  const cashAsset = db.select().from(assets).where(eq(assets.id, cashAssetId)).get();
  if (!cashAsset) {
    warnings.push("Seçilen nakit hesabı bulunamadı.");
    return warnings;
  }

  let credited = amount;
  if (cashAsset.currency !== amount.currency) {
    const fx = await getFx();
    if (fx.converter.has(amount.currency) && fx.converter.has(cashAsset.currency)) {
      credited = fx.converter.convert(amount, cashAsset.currency);
    } else {
      warnings.push(
        `${amount.currency} → ${cashAsset.currency} kuru yok; hasılat işlenmedi.`,
      );
      return warnings;
    }
  }

  db.insert(transactions)
    .values({
      id: randomUUID(),
      assetId: cashAssetId,
      type: "deposit_in",
      date,
      quantity: null,
      pricePerUnit: null,
      amount: credited.toDb(),
      currency: cashAsset.currency,
      fxRateToUsd: cashAsset.currency === "USD" ? "1" : null,
      fee: null,
      note,
      createdAt: now(),
      updatedAt: now(),
    })
    .run();

  return warnings;
}

/**
 * Varlığa bağlı aktif kredileri kapatır.
 * Kalan bakiye hasılattan düşülür — ev gidip borç kalmasın.
 */
function settleLoansFor(assetId: string, currency: string, date: string): Money {
  const rows = db
    .select()
    .from(liabilities)
    .where(eq(liabilities.assetId, assetId))
    .all()
    .filter((r) => r.status === "active");

  let total = Money.zero(currency);

  for (const row of rows) {
    const summary = summarizeLoan(
      {
        principal: Money.of(row.principal, row.currency),
        annualRate: new Decimal(row.annualRate),
        termMonths: row.termMonths,
        startDate: new Date(row.startDate),
      },
      paymentsFor(row),
    );

    if (row.currency === currency) {
      total = total.plus(summary.remaining);
    }

    db.update(liabilities)
      .set({ status: "settled", updatedAt: now() })
      .where(eq(liabilities.id, row.id))
      .run();
  }

  void date;
  return total;
}

/* ------------------------------------------------------------------ */
/* Piyasa pozisyonu                                                    */
/* ------------------------------------------------------------------ */

export interface SellPositionInput {
  assetId: string;
  /** Satılan miktar. Tamamı için elde kalan miktarı verin. */
  quantity: string;
  pricePerUnit: string;
  date: string;
  fee?: string | null;
  proceedsToCashId?: string | null;
}

export async function sellPosition(input: SellPositionInput): Promise<DisposeResult> {
  const asset = db.select().from(assets).where(eq(assets.id, input.assetId)).get();
  if (!asset) throw new Error("Varlık bulunamadı");

  const currency = asset.currency;
  const tx = db.select().from(transactions).where(eq(transactions.assetId, input.assetId)).all();
  const before = computePosition(input.assetId, currency, tx);

  const qty = new Decimal(input.quantity);
  if (qty.lessThanOrEqualTo(0)) throw new Error("Satış miktarı sıfırdan büyük olmalı");
  if (qty.greaterThan(before.quantity)) {
    throw new Error(
      `Elinizde ${before.quantity.toFixed()} adet var, ${qty.toFixed()} satılamaz.`,
    );
  }

  const gross = qty.times(input.pricePerUnit);
  const fee = input.fee && input.fee !== "0" ? input.fee : null;
  const proceeds = Money.of(gross.toFixed(), currency).minus(
    Money.fromDb(fee, currency),
  );

  db.insert(transactions)
    .values({
      id: randomUUID(),
      assetId: input.assetId,
      type: "sell",
      date: input.date,
      quantity: input.quantity,
      pricePerUnit: input.pricePerUnit,
      amount: gross.toFixed(),
      currency,
      fxRateToUsd: null,
      fee,
      note: "Satış",
      createdAt: now(),
      updatedAt: now(),
    })
    .run();

  // Gerçekleşen K/Z mevcut maliyet motorundan gelir
  const after = computePosition(
    input.assetId,
    currency,
    db.select().from(transactions).where(eq(transactions.assetId, input.assetId)).all(),
  );
  const realizedPnl = after.realizedPnl.minus(before.realizedPnl);

  // Pozisyon tamamen kapandıysa varlığı satıldı işaretle
  if (after.quantity.lessThanOrEqualTo(0)) {
    db.update(assets)
      .set({ status: "sold", updatedAt: now() })
      .where(eq(assets.id, input.assetId))
      .run();
  }

  const warnings = await creditCash(
    input.proceedsToCashId,
    proceeds,
    input.date,
    `SALE:${input.assetId}`,
  );

  return {
    netProceeds: proceeds,
    loanSettled: Money.zero(currency),
    realizedPnl,
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Gayrimenkul ve araç                                                 */
/* ------------------------------------------------------------------ */

export interface SellAssetInput {
  assetId: string;
  salePrice: string;
  date: string;
  /** Emlakçı komisyonu, tapu masrafı vb. */
  costs?: string | null;
  proceedsToCashId?: string | null;
}

export async function sellPhysicalAsset(
  input: SellAssetInput,
): Promise<DisposeResult> {
  const asset = db.select().from(assets).where(eq(assets.id, input.assetId)).get();
  if (!asset) throw new Error("Varlık bulunamadı");

  const currency = asset.currency;
  const salePrice = Money.of(input.salePrice, currency);
  const costs = Money.fromDb(input.costs ?? "0", currency);

  // Maliyet: gayrimenkulde tapu ve tadilat dahil, araçta alış fiyatı
  let cost = Money.zero(currency);
  const prop = db.select().from(properties).where(eq(properties.assetId, input.assetId)).get();
  if (prop) {
    cost = Money.of(prop.purchasePrice, currency)
      .plus(Money.fromDb(prop.closingCosts, currency))
      .plus(Money.fromDb(prop.renovationCost, currency));
  } else {
    const veh = db.select().from(vehicles).where(eq(vehicles.assetId, input.assetId)).get();
    if (veh) cost = Money.of(veh.purchasePrice, currency);
  }

  const realizedPnl = salePrice.minus(costs).minus(cost);

  db.insert(transactions)
    .values({
      id: randomUUID(),
      assetId: input.assetId,
      type: "sell",
      date: input.date,
      quantity: null,
      pricePerUnit: null,
      amount: salePrice.toDb(),
      currency,
      fxRateToUsd: null,
      fee: costs.isZero() ? null : costs.toDb(),
      note: "Satış",
      createdAt: now(),
      updatedAt: now(),
    })
    .run();

  // Önce kredi kapanır — ev gidip borç kalmasın
  const loanSettled = settleLoansFor(input.assetId, currency, input.date);
  const netProceeds = salePrice.minus(costs).minus(loanSettled);

  db.update(assets)
    .set({ status: "sold", updatedAt: now() })
    .where(eq(assets.id, input.assetId))
    .run();

  const warnings: string[] = [];
  if (netProceeds.isNegative()) {
    warnings.push(
      `Satış bedeli kalan krediyi karşılamıyor — ${netProceeds.abs().toString()} ` +
        `cebinizden çıkması gerekiyor.`,
    );
  } else {
    warnings.push(...(await creditCash(
      input.proceedsToCashId,
      netProceeds,
      input.date,
      `SALE:${input.assetId}`,
    )));
  }

  return { netProceeds, loanSettled, realizedPnl, warnings };
}

/* ------------------------------------------------------------------ */
/* Mevduat                                                             */
/* ------------------------------------------------------------------ */

export interface CloseDepositInput {
  assetId: string;
  date: string;
  proceedsToCashId?: string | null;
  /**
   * Erken kapatmada faiz kaybı.
   * Türkiye'de vadeden önce bozdurulan mevduata genelde faiz ödenmez;
   * varsayılan tam kayıp ama kullanıcı değiştirebilir.
   */
  interestForfeitRate?: string;
}

export async function closeDeposit(input: CloseDepositInput): Promise<DisposeResult> {
  const asset = db.select().from(assets).where(eq(assets.id, input.assetId)).get();
  if (!asset) throw new Error("Mevduat bulunamadı");

  const row = db.select().from(deposits).where(eq(deposits.assetId, input.assetId)).get();
  if (!row) throw new Error("Mevduat kaydı bulunamadı");

  const currency = asset.currency;
  const closeDate = new Date(input.date);
  const terms = buildTerms(row, currency, loadWithholdingRules());
  const snapshot = accrue(terms, closeDate);

  const matured = Boolean(row.maturityDate && closeDate >= new Date(row.maturityDate));
  const forfeitRate = new Decimal(
    matured ? "0" : (input.interestForfeitRate ?? "1"),
  );

  const forfeited = snapshot.netInterest.times(forfeitRate);
  const earnedInterest = snapshot.netInterest.minus(forfeited);
  const proceeds = terms.principal.plus(earnedInterest);

  db.insert(transactions)
    .values({
      id: randomUUID(),
      assetId: input.assetId,
      type: "withdraw",
      date: input.date,
      quantity: null,
      pricePerUnit: null,
      amount: proceeds.toDb(),
      currency,
      fxRateToUsd: null,
      fee: null,
      note: matured ? "Vade sonu kapanış" : "Erken kapatma",
      createdAt: now(),
      updatedAt: now(),
    })
    .run();

  db.update(assets)
    .set({ status: "closed", updatedAt: now() })
    .where(eq(assets.id, input.assetId))
    .run();

  const warnings: string[] = [];
  if (!matured && forfeited.isPositive()) {
    warnings.push(
      `Vadeden önce kapattığınız için ${forfeited.toString()} faiz kaybediliyor.`,
    );
  }
  warnings.push(...(await creditCash(
    input.proceedsToCashId,
    proceeds,
    input.date,
    `SALE:${input.assetId}`,
  )));

  return {
    netProceeds: proceeds,
    loanSettled: Money.zero(currency),
    realizedPnl: earnedInterest,
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Girişim                                                             */
/* ------------------------------------------------------------------ */

export interface ExitVentureInput {
  assetId: string;
  /** Çıkış tutarı. Tamamen değersizleştiyse "0". */
  proceeds: string;
  date: string;
  proceedsToCashId?: string | null;
}

export async function exitVenture(input: ExitVentureInput): Promise<DisposeResult> {
  const asset = db.select().from(assets).where(eq(assets.id, input.assetId)).get();
  if (!asset) throw new Error("Girişim bulunamadı");

  const row = db.select().from(ventures).where(eq(ventures.assetId, input.assetId)).get();
  const currency = asset.currency;
  const proceeds = Money.of(input.proceeds, currency);
  const invested = row ? Money.fromDb(row.calledCapital, currency) : Money.zero(currency);
  const realizedPnl = proceeds.minus(invested);

  db.insert(transactions)
    .values({
      id: randomUUID(),
      assetId: input.assetId,
      type: "distribution",
      date: input.date,
      quantity: null,
      pricePerUnit: null,
      amount: proceeds.toDb(),
      currency,
      fxRateToUsd: null,
      fee: null,
      note: proceeds.isZero() ? "Değersizleşme" : "Çıkış",
      createdAt: now(),
      updatedAt: now(),
    })
    .run();

  db.update(assets)
    .set({ status: "sold", updatedAt: now() })
    .where(eq(assets.id, input.assetId))
    .run();

  const warnings = await creditCash(
    input.proceedsToCashId,
    proceeds,
    input.date,
    `SALE:${input.assetId}`,
  );

  if (proceeds.isZero()) {
    warnings.push(
      `Girişim değersizleşti — ${invested.toString()} yatırım tamamen kaybedildi.`,
    );
  }

  return {
    netProceeds: proceeds,
    loanSettled: Money.zero(currency),
    realizedPnl,
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Geri alma                                                           */
/* ------------------------------------------------------------------ */

/**
 * Satış işlemini geri alır: varlık tekrar aktif olur, hasılat kaydı
 * silinir, kapatılan krediler yeniden açılır.
 */
export function undoSale(assetId: string): void {
  db.delete(transactions)
    .where(eq(transactions.note, `SALE:${assetId}`))
    .run();

  const own = db
    .select()
    .from(transactions)
    .where(eq(transactions.assetId, assetId))
    .all()
    .filter((t) => t.type === "sell" || t.type === "distribution" || t.note?.includes("kapanış") || t.note?.includes("kapatma"));

  for (const t of own) {
    db.delete(transactions).where(eq(transactions.id, t.id)).run();
  }

  db.update(liabilities)
    .set({ status: "active", updatedAt: now() })
    .where(eq(liabilities.assetId, assetId))
    .run();

  db.update(assets)
    .set({ status: "active", updatedAt: now() })
    .where(eq(assets.id, assetId))
    .run();
}

/** Planlanan kaydı iptal eder — henüz hiçbir şey olmadığı için silinir. */
export function cancelPlanned(assetId: string): void {
  const asset = db.select().from(assets).where(eq(assets.id, assetId)).get();
  if (asset?.status !== "planned") {
    throw new Error("Yalnızca planlanan kayıtlar iptal edilebilir");
  }
  db.delete(assets).where(eq(assets.id, assetId)).run();
}

export { today };
