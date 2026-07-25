import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { transactions, liabilities, assets } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Money } from "@/lib/money";
import { getFx } from "@/lib/market/fxStore";

/**
 * Ödeme kaynağı — bir varlık edinildiğinde para nereden çıktı?
 *
 * Panelin temel muhasebe kuralı burada uygulanıyor: bir varlık
 * kazanmak, karşılığında ya nakit çıkışı ya borç doğurur. İkisi de
 * olmuyorsa varlık dışarıdan gelmiştir (miras, hediye, zaten sahip
 * olunan) ve bunu kullanıcı açıkça belirtmelidir.
 *
 * Aksi halde panel yoktan servet üretir.
 */

export type FundingMode = "cash" | "external" | "loan";

export interface FundingInput {
  mode: FundingMode;
  /** cash ve loan modunda: peşinatın çıkacağı nakit varlığı. */
  cashAssetId?: string | null;
  /** loan modunda: peşinat tutarı (yerel para). Boşsa 0. */
  downPayment?: string | null;
  /** loan modunda kredi koşulları. */
  loan?: {
    name?: string;
    lender?: string | null;
    annualRate: string;
    termMonths: number;
    startDate: string;
  } | null;
}

export interface FundingResult {
  /** Nakitten düşülen tutar (yerel para). */
  cashPaid: Money;
  /** Açılan kredi anaparası. */
  loanPrincipal: Money;
  liabilityId: string | null;
  /** Kullanıcıya gösterilecek uyarılar — engelleyici değil. */
  warnings: string[];
}

const now = () => new Date().toISOString();

/**
 * Varlık edinimini finanse eder.
 *
 * @param assetId   Edinilen varlık
 * @param cost      Toplam maliyet, varlığın yerel para biriminde
 * @param date      Edinim tarihi
 */
export async function applyFunding(
  assetId: string,
  cost: Money,
  date: string,
  funding: FundingInput,
): Promise<FundingResult> {
  const currency = cost.currency;
  const warnings: string[] = [];

  // Önce bu varlığa ait eski finansman kayıtlarını temizle —
  // düzenleme sırasında ikinci kez para düşülmesin.
  clearFundingFor(assetId);

  if (funding.mode === "external" || cost.isZero()) {
    return {
      cashPaid: Money.zero(currency),
      loanPrincipal: Money.zero(currency),
      liabilityId: null,
      warnings,
    };
  }

  let cashPart = cost;
  let loanPart = Money.zero(currency);
  let liabilityId: string | null = null;

  if (funding.mode === "loan") {
    const down = funding.downPayment
      ? Money.of(funding.downPayment, currency)
      : Money.zero(currency);

    cashPart = down.gt(cost) ? cost : down;
    loanPart = cost.minus(cashPart);

    if (loanPart.isPositive() && funding.loan) {
      liabilityId = randomUUID();
      const assetName =
        db.select().from(assets).where(eq(assets.id, assetId)).get()?.name ?? "Varlık";

      db.insert(liabilities)
        .values({
          id: liabilityId,
          assetId,
          name: funding.loan.name?.trim() || `${assetName} kredisi`,
          lender: funding.loan.lender ?? null,
          currency,
          principal: loanPart.toDb(),
          annualRate: funding.loan.annualRate,
          termMonths: funding.loan.termMonths,
          startDate: funding.loan.startDate || date,
          paymentsMade: 0,
          status: "active",
          note: null,
          createdAt: now(),
          updatedAt: now(),
        })
        .run();
    }
  }

  // --- Nakit çıkışı ---
  if (cashPart.isPositive() && funding.cashAssetId) {
    const cashAsset = db
      .select()
      .from(assets)
      .where(eq(assets.id, funding.cashAssetId))
      .get();

    if (!cashAsset) {
      warnings.push("Seçilen nakit hesabı bulunamadı — nakit düşülmedi.");
    } else {
      // Nakit hesabı farklı para birimindeyse çevir
      let amountToDeduct = cashPart;
      if (cashAsset.currency !== currency) {
        const fx = await getFx();
        if (fx.converter.has(currency) && fx.converter.has(cashAsset.currency)) {
          amountToDeduct = fx.converter.convert(cashPart, cashAsset.currency);
        } else {
          warnings.push(
            `${currency} → ${cashAsset.currency} kuru bulunamadı; nakit düşülmedi.`,
          );
          amountToDeduct = Money.zero(cashAsset.currency);
        }
      }

      if (amountToDeduct.isPositive()) {
        db.insert(transactions)
          .values({
            id: randomUUID(),
            assetId: funding.cashAssetId,
            type: "withdraw",
            date,
            quantity: null,
            pricePerUnit: null,
            amount: amountToDeduct.toDb(),
            currency: cashAsset.currency,
            fxRateToUsd: null,
            fee: null,
            // Kaynak varlığı nota gömüyoruz ki geri alırken izlenebilsin
            note: `FUNDING:${assetId}`,
            createdAt: now(),
            updatedAt: now(),
          })
          .run();
      }
    }
  } else if (cashPart.isPositive() && !funding.cashAssetId) {
    warnings.push(
      "Ödeme hesabı seçilmedi — bu varlık için nakit düşülmedi. " +
        "Denetim bunu 'kaynağı belirsiz' olarak işaretleyecek.",
    );
  }

  return { cashPaid: cashPart, loanPrincipal: loanPart, liabilityId, warnings };
}

/**
 * Bir varlığın finansman kayıtlarını siler.
 *
 * Düzenleme sırasında çağrılır: kullanıcı maliyeti değiştirdiğinde
 * eski nakit çıkışı geçersizdir, yenisi yazılır. Aksi halde her
 * düzenleme parayı bir kez daha düşerdi.
 */
export function clearFundingFor(assetId: string): void {
  db.delete(transactions)
    .where(eq(transactions.note, `FUNDING:${assetId}`))
    .run();

  db.delete(liabilities).where(eq(liabilities.assetId, assetId)).run();
}

/** Bir varlığın finanse edilip edilmediğini söyler — denetim için. */
export function hasFunding(assetId: string): boolean {
  const cash = db
    .select()
    .from(transactions)
    .where(eq(transactions.note, `FUNDING:${assetId}`))
    .all();
  if (cash.length > 0) return true;

  const loan = db
    .select()
    .from(liabilities)
    .where(eq(liabilities.assetId, assetId))
    .all();
  return loan.length > 0;
}

/** Nakit varlıkları — ödeme kaynağı seçici için. */
export function listCashAccounts(): Array<{
  id: string;
  name: string;
  currency: string;
  balance: string;
}> {
  const rows = db
    .select()
    .from(assets)
    .where(eq(assets.kind, "cash"))
    .all()
    .filter((a) => a.status === "active");

  const allTx = db.select().from(transactions).all();

  return rows.map((a) => {
    const tx = allTx.filter((t) => t.assetId === a.id);
    const balance = tx.reduce((acc, t) => {
      const amount = new Decimal(t.amount || 0);
      if (t.type === "deposit_in" || t.type === "dividend" || t.type === "interest") {
        return acc.plus(amount);
      }
      if (t.type === "withdraw" || t.type === "expense" || t.type === "fee") {
        return acc.minus(amount);
      }
      return acc;
    }, new Decimal(0));

    return {
      id: a.id,
      name: a.name,
      currency: a.currency,
      balance: balance.toFixed(),
    };
  });
}
