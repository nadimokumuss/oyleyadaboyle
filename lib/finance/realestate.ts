import Decimal from "decimal.js";
import { Money, toDecimal, type CurrencyCode } from "@/lib/money";

/**
 * Gayrimenkul değerleme ve kira verimi.
 *
 * ÖNEMLİ SINIR: konut için ücretsiz canlı fiyat beslemesi yoktur.
 * Değer, bölgesel konut fiyat endeksine (HPI) göre MODELLENİR:
 *
 *   değer(t) = alışFiyatı × HPI(t) / HPI(alışTarihi)
 *
 * Bu bir tahmindir, ekspertiz değildir — panelde "model" rozetiyle
 * canlı fiyatlardan ayrılır. Kullanıcı gerçek bir ekspertiz girerse
 * o tarihten sonrası ekspertizden endekslenir (daha güvenilir çapa).
 */

export interface IndexSeries {
  /** "2026-07" → endeks değeri */
  [period: string]: number | string;
}

/**
 * Endeks serisinden bir tarihe karşılık gelen değeri okur.
 * Tam eşleşme yoksa komşu noktalar arasında doğrusal interpolasyon
 * yapar; seri dışındaysa en yakın uca sabitlenir (ekstrapolasyon yok —
 * uydurma trend üretmemek için).
 */
export function indexValueAt(series: IndexSeries, date: Date): Decimal | null {
  const points = Object.entries(series)
    .filter(([k]) => /^\d{4}-\d{2}$/.test(k))
    .map(([period, value]) => ({
      t: periodToTime(period),
      v: toDecimal(value),
    }))
    .sort((a, b) => a.t - b.t);

  if (points.length === 0) return null;

  const t = date.getTime();
  if (t <= points[0].t) return points[0].v;
  if (t >= points[points.length - 1].t) return points[points.length - 1].v;

  for (let i = 1; i < points.length; i++) {
    if (t <= points[i].t) {
      const prev = points[i - 1];
      const next = points[i];
      const span = next.t - prev.t;
      if (span === 0) return next.v;
      const ratio = new Decimal(t - prev.t).dividedBy(span);
      return prev.v.plus(next.v.minus(prev.v).times(ratio));
    }
  }
  return points[points.length - 1].v;
}

function periodToTime(period: string): number {
  const [y, m] = period.split("-").map(Number);
  return Date.UTC(y, m - 1, 1);
}

export interface PropertyInput {
  purchasePrice: Money;
  purchaseDate: Date;
  closingCosts: Money;
  renovationCost: Money;
  /** Elle girilen ekspertiz — varsa endeksin çapası olur. */
  manualValue: Money | null;
  manualValueDate: Date | null;
  monthlyRent: Money;
  occupancyRate: Decimal;
  monthlyCosts: Money;
  indexSeries: IndexSeries | null;
}

export interface PropertyValuation {
  /** Modellenen (veya elle girilen) güncel değer. */
  currentValue: Money;
  /** Tapu, komisyon, tadilat dahil gerçek maliyet. */
  totalCost: Money;
  /** Değer − maliyet. */
  capitalGain: Money;
  capitalGainRatio: Decimal | null;
  basis: "model" | "manual" | "cost";
  /** Endeksin ne kadar hareket ettiği. */
  indexGrowth: Decimal | null;

  /** Yıllık brüt kira (doluluk düzeltilmiş). */
  annualGrossRent: Money;
  annualCosts: Money;
  annualNetRent: Money;
  /** Net kira verimi = net kira / güncel değer. */
  netYield: Decimal | null;
  /** Brüt verim = brüt kira / güncel değer. */
  grossYield: Decimal | null;
  /** Maliyete göre verim (satın alma anındaki verim). */
  yieldOnCost: Decimal | null;
  /** Kira ve değer artışı birlikte: toplam yıllık getiri. */
  totalReturn: Money;
}

export function valueProperty(
  input: PropertyInput,
  now: Date = new Date(),
): PropertyValuation {
  const currency = input.purchasePrice.currency;

  const totalCost = input.purchasePrice
    .plus(input.closingCosts)
    .plus(input.renovationCost);

  // --- Güncel değer ---
  let currentValue = input.purchasePrice;
  let basis: PropertyValuation["basis"] = "cost";
  let indexGrowth: Decimal | null = null;

  // Çapa: elle girilen ekspertiz varsa o, yoksa alış
  const anchorValue = input.manualValue ?? input.purchasePrice;
  const anchorDate = input.manualValue
    ? (input.manualValueDate ?? input.purchaseDate)
    : input.purchaseDate;

  if (input.indexSeries) {
    const idxNow = indexValueAt(input.indexSeries, now);
    const idxAnchor = indexValueAt(input.indexSeries, anchorDate);
    if (idxNow && idxAnchor && idxAnchor.greaterThan(0)) {
      indexGrowth = idxNow.dividedBy(idxAnchor).minus(1);
      currentValue = anchorValue.times(idxNow.dividedBy(idxAnchor));
      basis = input.manualValue ? "manual" : "model";
    }
  } else if (input.manualValue) {
    currentValue = input.manualValue;
    basis = "manual";
  }

  const capitalGain = currentValue.minus(totalCost);
  const capitalGainRatio = totalCost.isZero()
    ? null
    : capitalGain.ratioTo(totalCost);

  // --- Kira ---
  const annualGrossRent = input.monthlyRent.times(12).times(input.occupancyRate);
  const annualCosts = input.monthlyCosts.times(12);
  const annualNetRent = annualGrossRent.minus(annualCosts);

  const netYield = currentValue.isZero() ? null : annualNetRent.ratioTo(currentValue);
  const grossYield = currentValue.isZero() ? null : annualGrossRent.ratioTo(currentValue);
  const yieldOnCost = totalCost.isZero() ? null : annualNetRent.ratioTo(totalCost);

  return {
    currentValue,
    totalCost,
    capitalGain,
    capitalGainRatio,
    basis,
    indexGrowth,
    annualGrossRent,
    annualCosts,
    annualNetRent,
    netYield,
    grossYield,
    yieldOnCost,
    totalReturn: annualNetRent.plus(capitalGain),
  };
}

/**
 * Boş (kiraya verilmemiş) konutun kaçırdığı geliri tahmin eder.
 * Fırsat motorunun "uyuyan varlık" kuralı bunu kullanır.
 *
 * Kira bilgisi girilmemişse bölge için tipik brüt verim varsayılır.
 */
export function estimateForegoneRent(
  currentValue: Money,
  assumedGrossYield: Decimal | string | number = "0.05",
): Money {
  return currentValue.times(toDecimal(assumedGrossYield)).dividedBy(12);
}

/** Aylık gider kalemlerini tek tutara indirger. */
export function sumMonthlyCosts(
  costs: Record<string, string | undefined> | null | undefined,
  currency: CurrencyCode,
): Money {
  if (!costs) return Money.zero(currency);
  return Object.values(costs)
    .filter((v): v is string => Boolean(v))
    .reduce((acc, v) => acc.plus(Money.of(v, currency)), Money.zero(currency));
}
