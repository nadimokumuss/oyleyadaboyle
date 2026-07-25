import Decimal from "decimal.js";
import { toDecimal } from "@/lib/money";

/**
 * Performans ve risk metrikleri.
 *
 * Neden hem TWR hem XIRR var: ikisi farklı soruyu cevaplar.
 *  - TWR: "seçtiğim varlıklar ne kadar iyiydi?" (para giriş-çıkışından arındırılmış)
 *  - XIRR: "benim param ne kadar kazandı?" (zamanlama dahil)
 * Doğru soruya doğru metrik gerekir, o yüzden ikisi de hesaplanır.
 */

const MS_PER_YEAR = 365.2425 * 86_400_000;

export interface CashFlow {
  date: Date;
  /** Negatif = yatırım (para çıkışı), pozitif = geri dönüş. */
  amount: Decimal;
}

/* ------------------------------------------------------------------ */
/* XIRR — düzensiz nakit akışlarında yıllık getiri                     */
/* ------------------------------------------------------------------ */

/** NPV(r) = Σ CF_i / (1+r)^((t_i − t_0)/yıl) */
function npv(flows: CashFlow[], rate: Decimal): Decimal {
  const t0 = flows[0].date.getTime();
  const base = rate.plus(1);
  return flows.reduce((acc, f) => {
    const years = new Decimal(f.date.getTime() - t0).dividedBy(MS_PER_YEAR);
    return acc.plus(f.amount.dividedBy(base.pow(years)));
  }, new Decimal(0));
}

/**
 * XIRR — Newton-Raphson, başarısız olursa ikiye bölme (bisection).
 *
 * Newton hızlıdır ama uç durumlarda ıraksar; bisection yavaş ama
 * garantilidir. İkisini birleştirmek finans kütüphanelerinde standarttır.
 *
 * @returns yıllık getiri oranı, veya çözüm yoksa null
 */
export function xirr(flows: CashFlow[], guess = 0.1): Decimal | null {
  if (flows.length < 2) return null;

  const sorted = [...flows].sort((a, b) => a.date.getTime() - b.date.getTime());

  // İşaret değişimi yoksa çözüm yoktur (hep pozitif veya hep negatif)
  const hasPositive = sorted.some((f) => f.amount.greaterThan(0));
  const hasNegative = sorted.some((f) => f.amount.lessThan(0));
  if (!hasPositive || !hasNegative) return null;

  // --- Newton-Raphson ---
  let rate = new Decimal(guess);
  for (let i = 0; i < 50; i++) {
    const value = npv(sorted, rate);
    if (value.abs().lessThan("1e-9")) return rate;

    // Sayısal türev
    const h = new Decimal("1e-7");
    const derivative = npv(sorted, rate.plus(h)).minus(value).dividedBy(h);
    if (derivative.isZero()) break;

    const next = rate.minus(value.dividedBy(derivative));
    // -100%'ün altına inemez (tüm para kaybı sınırı)
    if (next.lessThanOrEqualTo(-1)) {
      rate = new Decimal("-0.9999");
      continue;
    }
    if (next.minus(rate).abs().lessThan("1e-12")) return next;
    rate = next;
  }

  // --- Bisection yedeği ---
  let low = new Decimal("-0.9999");
  let high = new Decimal(100);
  let fLow = npv(sorted, low);
  if (fLow.times(npv(sorted, high)).greaterThan(0)) return null;

  for (let i = 0; i < 200; i++) {
    const mid = low.plus(high).dividedBy(2);
    const fMid = npv(sorted, mid);
    if (fMid.abs().lessThan("1e-9")) return mid;
    if (fLow.times(fMid).lessThan(0)) {
      high = mid;
    } else {
      low = mid;
      fLow = fMid;
    }
  }
  return low.plus(high).dividedBy(2);
}

/* ------------------------------------------------------------------ */
/* TWR — zaman ağırlıklı getiri                                        */
/* ------------------------------------------------------------------ */

export interface ValuationPoint {
  date: Date;
  /** Dönem sonu portföy değeri. */
  value: Decimal;
  /** Bu noktada gerçekleşen net nakit girişi (pozitif) / çıkışı (negatif). */
  netFlow: Decimal;
}

/**
 * TWR: her nakit akışında dönem kesilir, dönem getirileri zincirlenir.
 *
 *   r_i = (V_i − F_i) / V_{i−1} − 1
 *   TWR = Π(1 + r_i) − 1
 *
 * Böylece "ne zaman para yatırdım" kararı sonucu etkilemez; sadece
 * varlık seçiminin performansı ölçülür.
 */
export function twr(points: ValuationPoint[]): Decimal | null {
  if (points.length < 2) return null;

  const sorted = [...points].sort((a, b) => a.date.getTime() - b.date.getTime());
  let compounded = new Decimal(1);

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].value;
    if (prev.lessThanOrEqualTo(0)) continue; // dönem atlanır
    const periodReturn = sorted[i].value
      .minus(sorted[i].netFlow)
      .dividedBy(prev);
    compounded = compounded.times(periodReturn);
  }

  return compounded.minus(1);
}

/** Toplam getiriyi yıllıklaştırır. */
export function annualize(totalReturn: Decimal, years: Decimal | number): Decimal | null {
  const y = toDecimal(years);
  if (y.lessThanOrEqualTo(0)) return null;
  const growth = totalReturn.plus(1);
  if (growth.lessThanOrEqualTo(0)) return null;
  return growth.pow(new Decimal(1).dividedBy(y)).minus(1);
}

/* ------------------------------------------------------------------ */
/* Risk                                                                */
/* ------------------------------------------------------------------ */

/** Ardışık değerlerden dönemsel getiri serisi üretir. */
export function toReturns(values: Array<Decimal | string | number>): Decimal[] {
  const out: Decimal[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = toDecimal(values[i - 1]);
    if (prev.lessThanOrEqualTo(0)) continue;
    out.push(toDecimal(values[i]).dividedBy(prev).minus(1));
  }
  return out;
}

/**
 * Yıllıklaştırılmış standart sapma (volatilite).
 *
 * Örneklem standart sapması (n−1) kullanılır — popülasyon değil.
 * Elimizdeki getiri serisi tüm olasılıkların değil, gerçekleşmiş bir
 * örneklemin kaydıdır.
 */
export function volatility(returns: Decimal[], periodsPerYear = 252): Decimal | null {
  if (returns.length < 2) return null;

  const n = new Decimal(returns.length);
  const mean = returns.reduce((a, r) => a.plus(r), new Decimal(0)).dividedBy(n);
  const variance = returns
    .reduce((a, r) => a.plus(r.minus(mean).pow(2)), new Decimal(0))
    .dividedBy(n.minus(1));

  return variance.sqrt().times(new Decimal(periodsPerYear).sqrt());
}

export interface Drawdown {
  /** En büyük tepe-dip düşüşü (negatif oran). */
  maxDrawdown: Decimal;
  peakIndex: number;
  troughIndex: number;
  /** Şu anki zirveden uzaklık. */
  currentDrawdown: Decimal;
}

/**
 * Maksimum düşüş: "en kötü anda ne kadar kaybetmiştim?"
 *
 * Volatiliteden daha sezgisel bir risk ölçüsüdür — insanlar standart
 * sapmayı değil, portföyün yarıya inmesini hisseder.
 */
export function maxDrawdown(values: Array<Decimal | string | number>): Drawdown | null {
  if (values.length < 2) return null;

  const v = values.map(toDecimal);
  let peak = v[0];
  let peakIdx = 0;
  let maxDd = new Decimal(0);
  let bestPeak = 0;
  let bestTrough = 0;

  for (let i = 1; i < v.length; i++) {
    if (v[i].greaterThan(peak)) {
      peak = v[i];
      peakIdx = i;
      continue;
    }
    if (peak.lessThanOrEqualTo(0)) continue;
    const dd = v[i].dividedBy(peak).minus(1);
    if (dd.lessThan(maxDd)) {
      maxDd = dd;
      bestPeak = peakIdx;
      bestTrough = i;
    }
  }

  const runningPeak = v.reduce((a, b) => (b.greaterThan(a) ? b : a), v[0]);
  const currentDrawdown = runningPeak.greaterThan(0)
    ? v[v.length - 1].dividedBy(runningPeak).minus(1)
    : new Decimal(0);

  return {
    maxDrawdown: maxDd,
    peakIndex: bestPeak,
    troughIndex: bestTrough,
    currentDrawdown,
  };
}

/**
 * Sharpe oranı: birim risk başına fazla getiri.
 * Risksiz oran olarak USD mevduat faizi kullanılır.
 */
export function sharpe(
  annualReturn: Decimal,
  annualVolatility: Decimal,
  riskFreeRate: Decimal | string | number = "0.035",
): Decimal | null {
  if (annualVolatility.lessThanOrEqualTo(0)) return null;
  return annualReturn.minus(toDecimal(riskFreeRate)).dividedBy(annualVolatility);
}

/**
 * Yoğunlaşma: Herfindahl-Hirschman endeksi.
 * 1 = tek varlıkta toplanmış, 1/n = eşit dağılmış.
 */
export function concentration(weights: Array<Decimal | string | number>): Decimal {
  return weights.reduce<Decimal>((acc, w) => acc.plus(toDecimal(w).pow(2)), new Decimal(0));
}
