import Decimal from "decimal.js";
import { Money, type CurrencyCode } from "@/lib/money";
import type { Transaction } from "@/db/schema";

/**
 * Temettü ve dağıtım geliri analizi.
 *
 * `costbasis.ts` temettüleri `incomeReceived` içine topluyordu — doğru ama
 * geriye dönük ve tek sayı. Burada iki şey ekleniyor:
 *
 *  - **Maliyete göre verim** (yield on cost): ödediğiniz paraya göre yıllık
 *    getiri. Piyasa fiyatına göre verimden farklıdır ve uzun vadeli
 *    yatırımcı için daha anlamlıdır — hisse üçe katlandıysa güncel verim
 *    düşük görünür ama sizin paranıza göre yüksektir.
 *  - **İleriye dönük tahmin**: son 12 ayda alınan, önümüzdeki 12 ay için
 *    beklenen kabul edilir.
 *
 * ## Tahminin sınırı
 *
 * Bu bir temettü **takvimi** değil. Ücretsiz-anahtarsız bir kaynaktan
 * ex-date ve ilan edilmiş temettü verisi alınamadığı için tahmin
 * tamamen geçmişe dayanır: şirket temettüyü kesse veya artırsa bunu
 * bilemeyiz. Arayüzde bu açıkça söylenmeli.
 */

const INCOME_TYPES = new Set(["dividend", "staking", "distribution"]);

const MS_PER_DAY = 86_400_000;
const DAYS_PER_YEAR = 365;

export interface DividendPayment {
  date: string;
  amount: string;
  type: string;
}

export interface DividendAnalysis {
  assetId: string;
  currency: CurrencyCode;
  /** Son 12 ayda alınan toplam. */
  trailingTwelveMonths: Money;
  /** Kayıtlardaki tüm zaman toplamı. */
  lifetime: Money;
  /**
   * Maliyete göre yıllık verim. Maliyet sıfırsa (veya pozisyon
   * kapandıysa) null.
   */
  yieldOnCost: Decimal | null;
  /**
   * Önümüzdeki 12 ayın tahmini. Son 12 aya eşittir — geçmişin devam
   * edeceği varsayımı.
   */
  forwardEstimate: Money;
  /** Aylık ortalama, nakit akışına girecek tutar. */
  monthlyAverage: Money;
  /** Kaç ödeme alınmış (son 12 ay). */
  paymentCount: number;
  lastPaymentDate: string | null;
  payments: DividendPayment[];
}

/**
 * Bir varlığın temettü geçmişini analiz eder.
 *
 * `totalCost` pozisyonun güncel maliyeti — `computePosition` üretiyor.
 * Verim bunun üzerinden hesaplanır.
 */
export function analyzeDividends(
  assetId: string,
  currency: CurrencyCode,
  transactions: Transaction[],
  totalCost: Money,
  now = new Date(),
): DividendAnalysis {
  const payments: DividendPayment[] = [];
  let lifetime = Money.zero(currency);
  let trailing = Money.zero(currency);

  const cutoff = new Date(now.getTime() - DAYS_PER_YEAR * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
  const today = now.toISOString().slice(0, 10);

  for (const tx of transactions) {
    if (!INCOME_TYPES.has(tx.type)) continue;

    const amount = Money.fromDb(tx.amount, tx.currency);
    lifetime = lifetime.plus(amount);
    payments.push({ date: tx.date, amount: tx.amount, type: tx.type });

    // Gelecek tarihli kayıt tahmini şişirmemeli.
    if (tx.date >= cutoff && tx.date <= today) {
      trailing = trailing.plus(amount);
    }
  }

  payments.sort((a, b) => a.date.localeCompare(b.date));

  const trailingPayments = payments.filter((p) => p.date >= cutoff && p.date <= today);

  const yieldOnCost = totalCost.isZero() ? null : trailing.ratioTo(totalCost);

  return {
    assetId,
    currency,
    trailingTwelveMonths: trailing,
    lifetime,
    yieldOnCost,
    forwardEstimate: trailing,
    monthlyAverage: trailing.dividedBy(12),
    paymentCount: trailingPayments.length,
    lastPaymentDate: payments.length > 0 ? payments[payments.length - 1].date : null,
    payments,
  };
}

/**
 * Birden çok analizin toplamı.
 *
 * Farklı para birimleri toplanamaz — `toBase` ile ortak birime çevrilir.
 * Çeviremediklerimiz `unconverted` altında bildirilir; sessizce sıfır
 * saymak toplamı olduğundan düşük gösterirdi.
 */
export interface DividendTotals {
  trailingTwelveMonths: Money;
  forwardEstimate: Money;
  monthlyAverage: Money;
  unconverted: string[];
}

export function sumDividends(
  analyses: DividendAnalysis[],
  toBase: (m: Money) => Money | null,
  base: CurrencyCode = "USD",
): DividendTotals {
  let trailing = Money.zero(base);
  const unconverted = new Set<string>();

  for (const a of analyses) {
    if (a.trailingTwelveMonths.isZero()) continue;
    const converted = toBase(a.trailingTwelveMonths);
    if (converted === null) {
      unconverted.add(a.currency);
      continue;
    }
    trailing = trailing.plus(converted);
  }

  return {
    trailingTwelveMonths: trailing,
    forwardEstimate: trailing,
    monthlyAverage: trailing.dividedBy(12),
    unconverted: [...unconverted],
  };
}
