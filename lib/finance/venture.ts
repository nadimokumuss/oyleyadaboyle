import Decimal from "decimal.js";
import { Money, toDecimal } from "@/lib/money";
import { xirr, type CashFlow } from "./metrics";

/**
 * Girişim portföyü metrikleri.
 *
 * Girişimlerde asıl soru "kaç para kazandım" değil, "ne kadar zamanım
 * kaldı" sorusudur. Runway bu yüzden en öne çıkan metriktir.
 */

export interface VentureInput {
  ownershipPct: Decimal;
  committedCapital: Money;
  calledCapital: Money;
  valuation: Money | null;
  monthlyRevenue: Money;
  monthlyBurn: Money;
  cashOnHand: Money;
  /** Sermaye çağrıları ve dağıtımlar — IRR için. */
  cashFlows?: CashFlow[];
}

export interface VentureMetrics {
  /** Sahiplik payına düşen güncel değer. */
  positionValue: Money;
  /** Henüz ödenmemiş taahhüt. */
  uncalledCapital: Money;
  /** Net aylık yakım: gider − gelir. Negatifse kâr ediyor. */
  netMonthlyBurn: Money;
  /** Kaç ay yakıt kaldı. Kâr ediyorsa null (sonsuz). */
  runwayMonths: Decimal | null;
  /** Runway'in bittiği tahmini tarih. */
  runwayEndsAt: Date | null;
  /** Katlanma: güncel değer / ödenen sermaye. */
  moic: Decimal | null;
  /** Yıllık iç verim oranı. */
  irr: Decimal | null;
  /** Başabaş için gereken aylık gelir. */
  breakevenRevenue: Money;
  /** Başabaşa ne kadar kaldı (oran). 1 = ulaşıldı. */
  breakevenProgress: Decimal | null;
  profitable: boolean;
  /** Uyarı seviyesi. */
  alert: "critical" | "warning" | "ok";
}

const DAYS_PER_MONTH = 30.436875;

export function computeVentureMetrics(
  input: VentureInput,
  now: Date = new Date(),
): VentureMetrics {
  const positionValue = input.valuation
    ? input.valuation.times(input.ownershipPct)
    : input.calledCapital;

  const uncalledCapital = input.committedCapital.minus(input.calledCapital);

  // Net yakım: giderden geliri düş
  const netMonthlyBurn = input.monthlyBurn.minus(input.monthlyRevenue);
  const profitable = !netMonthlyBurn.isPositive();

  // Runway: kâr ediyorsa sonsuz (null)
  const runwayMonths = profitable
    ? null
    : input.cashOnHand.ratioTo(netMonthlyBurn);

  const runwayEndsAt =
    runwayMonths && runwayMonths.isFinite()
      ? new Date(
          now.getTime() + runwayMonths.times(DAYS_PER_MONTH).times(86_400_000).toNumber(),
        )
      : null;

  const moic = input.calledCapital.isZero()
    ? null
    : positionValue.ratioTo(input.calledCapital);

  // IRR: nakit akışları verilmişse hesapla, güncel değeri son akış say
  let irr: Decimal | null = null;
  if (input.cashFlows && input.cashFlows.length > 0) {
    const flows = [...input.cashFlows];
    if (positionValue.isPositive()) {
      flows.push({ date: now, amount: positionValue.amount });
    }
    irr = xirr(flows);
  }

  const breakevenRevenue = input.monthlyBurn;
  const breakevenProgress = input.monthlyBurn.isZero()
    ? null
    : input.monthlyRevenue.ratioTo(input.monthlyBurn);

  let alert: VentureMetrics["alert"] = "ok";
  if (!profitable && runwayMonths) {
    if (runwayMonths.lessThan(3)) alert = "critical";
    else if (runwayMonths.lessThan(6)) alert = "warning";
  }

  return {
    positionValue,
    uncalledCapital,
    netMonthlyBurn,
    runwayMonths,
    runwayEndsAt,
    moic,
    irr,
    breakevenRevenue,
    breakevenProgress,
    profitable,
    alert,
  };
}

/**
 * Sermaye artırımında seyrelme.
 *
 * yeniPay = eskiPay × (öncekiDeğerleme / (öncekiDeğerleme + yeniYatırım))
 */
export function dilutedOwnership(
  currentPct: Decimal | string | number,
  preMoneyValuation: Money,
  newInvestment: Money,
): Decimal {
  const post = preMoneyValuation.plus(newInvestment);
  if (post.isZero()) return toDecimal(currentPct);
  return toDecimal(currentPct).times(preMoneyValuation.ratioTo(post));
}

/** Aylık nakit projeksiyonu — runway grafiği için. */
export function cashProjection(
  cashOnHand: Money,
  netMonthlyBurn: Money,
  months = 18,
): Array<{ month: number; cash: string }> {
  const out: Array<{ month: number; cash: string }> = [];
  let cash = cashOnHand;
  for (let m = 0; m <= months; m++) {
    out.push({ month: m, cash: cash.toDb() });
    cash = cash.minus(netMonthlyBurn);
    // Nakit tükendikten sonra negatife inmeyi göstermeye gerek yok
    if (cash.isNegative()) {
      out.push({ month: m + 1, cash: "0" });
      break;
    }
  }
  return out;
}
