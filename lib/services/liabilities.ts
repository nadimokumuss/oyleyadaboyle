import Decimal from "decimal.js";
import { db } from "@/db/client";
import { liabilities, assets } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Money } from "@/lib/money";
import { getFx } from "@/lib/market/fxStore";
import {
  summarizeLoan, amortizationSchedule, earlySettlementAmount,
  expectedPaymentsByNow, type LoanTerms,
} from "@/lib/finance/loan";

/**
 * Borç okuma katmanı.
 *
 * Ödenen taksit sayısı takvimden türetilir — kullanıcı her ay elle
 * "ödedim" işaretlemek zorunda kalmasın. `paymentsMade` alanı elle
 * düzeltme yapıldığında devreye girer (0'dan büyükse o kullanılır).
 */

export interface LiabilityView {
  id: string;
  assetId: string | null;
  assetName: string | null;
  name: string;
  lender: string | null;
  currency: string;

  principal: string;
  annualRate: string;
  termMonths: number;
  startDate: string;

  monthlyPayment: string;
  monthlyPaymentUsd: string;
  remaining: string;
  remainingUsd: string;
  totalInterest: string;
  totalPayment: string;
  principalPaid: string;
  interestPaid: string;
  paymentsMade: number;
  paymentsRemaining: number;
  endsAt: string;
  settled: boolean;

  /** Taksitleri zamanlayıcı ilerletsin mi, ilerletiyorsa hangi hesaptan. */
  autoPay: boolean;
  paymentAssetId: string | null;

  /** Erken kapatma tutarı ve tasarruf. */
  earlySettlement: {
    balance: string;
    penalty: string;
    total: string;
    interestSaved: string;
  };
}

function toTerms(row: typeof liabilities.$inferSelect): LoanTerms {
  return {
    principal: Money.of(row.principal, row.currency),
    annualRate: new Decimal(row.annualRate),
    termMonths: row.termMonths,
    startDate: new Date(row.startDate),
  };
}

/** Bu borçta bugüne kadar kaç taksit ödendi. */
export function paymentsFor(
  row: typeof liabilities.$inferSelect,
  now = new Date(),
): number {
  if (row.paymentsMade > 0) return row.paymentsMade;
  return expectedPaymentsByNow(new Date(row.startDate), row.termMonths, now);
}

export async function loadLiabilities(now = new Date()): Promise<LiabilityView[]> {
  const fx = await getFx();
  const rows = db.select().from(liabilities).all().filter((r) => r.status === "active");

  const assetNames = new Map(
    db.select().from(assets).all().map((a) => [a.id, a.name]),
  );

  const toUsd = (m: Money): Money =>
    fx.converter.has(m.currency) ? fx.converter.toBase(m) : Money.zero("USD");

  return rows.map((row) => {
    const terms = toTerms(row);
    const made = paymentsFor(row, now);
    const s = summarizeLoan(terms, made);
    const early = earlySettlementAmount(terms, made);

    return {
      id: row.id,
      assetId: row.assetId,
      assetName: row.assetId ? (assetNames.get(row.assetId) ?? null) : null,
      name: row.name,
      lender: row.lender,
      currency: row.currency,
      principal: row.principal,
      annualRate: row.annualRate,
      termMonths: row.termMonths,
      startDate: row.startDate,
      monthlyPayment: s.monthlyPayment.toDb(),
      monthlyPaymentUsd: toUsd(s.monthlyPayment).toDb(),
      remaining: s.remaining.toDb(),
      remainingUsd: toUsd(s.remaining).toDb(),
      totalInterest: s.totalInterest.toDb(),
      totalPayment: s.totalPayment.toDb(),
      principalPaid: s.principalPaid.toDb(),
      interestPaid: s.interestPaid.toDb(),
      paymentsMade: s.paymentsMade,
      paymentsRemaining: s.paymentsRemaining,
      endsAt: s.endsAt.toISOString(),
      settled: s.settled,
      autoPay: row.autoPay,
      paymentAssetId: row.paymentAssetId,
      earlySettlement: {
        balance: early.balance.toDb(),
        penalty: early.penalty.toDb(),
        total: early.total.toDb(),
        interestSaved: early.interestSaved.toDb(),
      },
    };
  });
}

/** Toplam kalan borç, USD. `computeNetWorth` bunu düşer. */
export async function totalOutstandingUsd(now = new Date()): Promise<Money> {
  const fx = await getFx();
  const rows = db.select().from(liabilities).all().filter((r) => r.status === "active");

  return rows.reduce((acc, row) => {
    const terms = toTerms(row);
    const remaining = summarizeLoan(terms, paymentsFor(row, now)).remaining;
    return acc.plus(
      fx.converter.has(remaining.currency)
        ? fx.converter.toBase(remaining)
        : Money.zero("USD"),
    );
  }, Money.zero("USD"));
}

/** Bir varlığa bağlı aktif borçlar — satış sırasında kapatılmalı. */
export function liabilitiesForAsset(assetId: string) {
  return db
    .select()
    .from(liabilities)
    .where(eq(liabilities.assetId, assetId))
    .all()
    .filter((r) => r.status === "active");
}

/** Ödeme planı — borç detay sayfası için. */
export function scheduleFor(id: string) {
  const row = db.select().from(liabilities).where(eq(liabilities.id, id)).get();
  if (!row) return null;

  return amortizationSchedule(toTerms(row)).map((r) => ({
    month: r.month,
    payment: r.payment.toDb(),
    interest: r.interest.toDb(),
    principal: r.principal.toDb(),
    balance: r.balance.toDb(),
  }));
}
