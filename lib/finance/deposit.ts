import Decimal from "decimal.js";
import { Money, toDecimal, type CurrencyCode } from "@/lib/money";
import { realReturn } from "@/lib/fx";

/**
 * Mevduat faiz motoru.
 *
 * TASARIM KARARI: kazanç veritabanına tik tik yazılmaz. `t` anındaki
 * değer saf bir fonksiyonla hesaplanır: A(t). Bunun üç faydası var:
 *
 *  1. Panel kapalıyken de doğru — açtığınızda 3 gün önceki değil,
 *     tam o anki tutarı görürsünüz.
 *  2. Saniyede birkaç kez tazelenebilir; DB yazma maliyeti yok.
 *  3. Geçmişe dönük düzeltme mümkün — faiz oranı yanlış girildiyse
 *     düzeltilir ve tüm geçmiş anında tutarlı hale gelir.
 */

export type Compounding =
  | "simple" | "daily" | "monthly" | "quarterly" | "annual" | "continuous";
export type DayCount = "ACT/365" | "ACT/360" | "30/360";

export interface DepositTerms {
  principal: Money;
  /** Brüt yıllık oran: 0.45 = %45 */
  annualRate: Decimal;
  compounding: Compounding;
  dayCount: DayCount;
  startDate: Date;
  maturityDate: Date | null;
  /** Stopaj oranı: 0.15 = %15. */
  withholdingRate: Decimal;
}

const PERIODS_PER_YEAR: Record<Exclude<Compounding, "simple" | "continuous">, number> = {
  daily: 365,
  monthly: 12,
  quarterly: 4,
  annual: 1,
};

const MS_PER_DAY = 86_400_000;

/**
 * İki tarih arasındaki yıl kesri.
 *
 * Gün sayımı yöntemi önemlidir: 100M TL'de ACT/365 ile ACT/360 arasındaki
 * fark yıllık yüz binlerce lira eder. Banka hangi yöntemi kullanıyorsa
 * o seçilmeli.
 */
export function yearFraction(start: Date, end: Date, dayCount: DayCount): Decimal {
  if (end <= start) return new Decimal(0);

  if (dayCount === "30/360") {
    // Her ay 30 gün, her yıl 360 gün sayılır (tahvil piyasası geleneği)
    const y1 = start.getUTCFullYear(), m1 = start.getUTCMonth() + 1;
    const y2 = end.getUTCFullYear(), m2 = end.getUTCMonth() + 1;
    const d1 = Math.min(start.getUTCDate(), 30);
    const d2 = d1 === 30 ? Math.min(end.getUTCDate(), 30) : end.getUTCDate();
    const days = (y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1);
    return new Decimal(days).dividedBy(360);
  }

  // ACT/*: gerçek geçen gün sayısı (kesirli — saatlik sayaç için şart)
  const actualDays = new Decimal(end.getTime() - start.getTime()).dividedBy(MS_PER_DAY);
  return actualDays.dividedBy(dayCount === "ACT/360" ? 360 : 365);
}

/**
 * `t` anındaki hesap bakiyesi A(t).
 *
 *   Basit:    A = P · (1 + r·τ)
 *   Bileşik:  A = P · (1 + r/n)^(n·τ)
 *   Sürekli:  A = P · e^(r·τ)
 */
export function balanceAt(terms: DepositTerms, t: Date): Money {
  const { principal, annualRate: r, compounding, startDate } = terms;

  // Vade dolduysa faiz durur — vade sonrası bakiye sabit kalır.
  // (autoRenew davranışı ayrı ele alınır; burada varsayılan durdurmak.)
  const effectiveEnd =
    terms.maturityDate && t > terms.maturityDate ? terms.maturityDate : t;

  const tau = yearFraction(startDate, effectiveEnd, terms.dayCount);
  if (tau.lessThanOrEqualTo(0)) return principal;

  switch (compounding) {
    case "simple":
      return principal.times(r.times(tau).plus(1));

    case "continuous": {
      // e^(r·τ) — Decimal.exp yeterli hassasiyette
      const growth = r.times(tau).exp();
      return principal.times(growth);
    }

    default: {
      const n = new Decimal(PERIODS_PER_YEAR[compounding]);
      // (1 + r/n)^(n·τ)
      const base = r.dividedBy(n).plus(1);
      const exponent = n.times(tau);
      return principal.times(base.pow(exponent));
    }
  }
}

export interface AccrualSnapshot {
  /** O andaki toplam bakiye (anapara + brüt faiz). */
  balance: Money;
  /** Brüt kazanç: A(t) − P */
  grossInterest: Money;
  /** Kesilen stopaj. */
  withholding: Money;
  /** Elde kalan net kazanç. */
  netInterest: Money;
  /** Anapara + net kazanç — cebe girecek tutar. */
  netBalance: Money;
  /** Başlangıçtan bu yana geçen yıl kesri. */
  elapsedYears: Decimal;
  /** Vadeye kalan gün. Vadesiz veya vade geçmişse null. */
  daysToMaturity: number | null;
  matured: boolean;
}

export function accrue(terms: DepositTerms, t: Date = new Date()): AccrualSnapshot {
  const balance = balanceAt(terms, t);
  const grossInterest = balance.minus(terms.principal);
  const withholding = grossInterest.times(terms.withholdingRate);
  const netInterest = grossInterest.minus(withholding);

  const matured = Boolean(terms.maturityDate && t >= terms.maturityDate);
  const daysToMaturity =
    terms.maturityDate && !matured
      ? Math.ceil((terms.maturityDate.getTime() - t.getTime()) / MS_PER_DAY)
      : null;

  return {
    balance,
    grossInterest,
    withholding,
    netInterest,
    netBalance: terms.principal.plus(netInterest),
    elapsedYears: yearFraction(terms.startDate, t, terms.dayCount),
    daysToMaturity,
    matured,
  };
}

/* ------------------------------------------------------------------ */
/* Çoklu ölçekli kazanç oranı                                          */
/* ------------------------------------------------------------------ */

export interface EarningsRate {
  perSecond: Money;
  perMinute: Money;
  perHour: Money;
  perDay: Money;
  perWeek: Money;
  perMonth: Money;
  perYear: Money;
}

/**
 * "100 milyon TL saatte bana ne kazandırıyor?" sorusunun cevabı.
 *
 * Anlık kazanç hızı dA/dt'den değil, ileri farkla hesaplanır:
 * A(t+Δ) − A(t). Sebep: bileşik faizde oran zamanla değişir ve
 * kullanıcının görmek istediği "önümüzdeki bir saatte ne kazanacağım"
 * sorusunun cevabı tam olarak budur — türevin anlık değeri değil.
 *
 * Vade dolduysa tüm hızlar sıfırdır (faiz işlemiyor).
 */
export function earningsRate(
  terms: DepositTerms,
  t: Date = new Date(),
  net = true,
): EarningsRate {
  const factor = net ? new Decimal(1).minus(terms.withholdingRate) : new Decimal(1);

  const forward = (seconds: number): Money => {
    const future = new Date(t.getTime() + seconds * 1000);
    // Vade sonrası kazanç yok
    if (terms.maturityDate && t >= terms.maturityDate) {
      return Money.zero(terms.principal.currency);
    }
    const delta = balanceAt(terms, future).minus(balanceAt(terms, t));
    return delta.times(factor);
  };

  return {
    perSecond: forward(1),
    perMinute: forward(60),
    perHour: forward(3600),
    perDay: forward(86_400),
    perWeek: forward(604_800),
    perMonth: forward(2_629_746), // ortalama ay (365.2425/12 gün)
    perYear: forward(31_556_952),
  };
}

/* ------------------------------------------------------------------ */
/* Stopaj                                                              */
/* ------------------------------------------------------------------ */

export interface WithholdingRule {
  currency: string;
  maxTermDays: number | null;
  rate: string;
}

/**
 * Vade ve para birimine göre stopaj oranını seçer.
 *
 * Oranlar koda gömülmez, DB'den gelir — mevzuat sık değişir ve
 * kullanıcı kendi güncel oranını girebilmeli.
 */
export function resolveWithholdingRate(
  rules: WithholdingRule[],
  currency: CurrencyCode,
  termDays: number | null,
): Decimal {
  const cur = currency.toUpperCase();
  const applicable = rules
    .filter((r) => r.currency.toUpperCase() === cur || r.currency === "*")
    // Para birimi tam eşleşmesi joker'e tercih edilir
    .sort((a, b) => (a.currency === "*" ? 1 : 0) - (b.currency === "*" ? 1 : 0));

  if (applicable.length === 0) return new Decimal(0);

  // Vadesiz hesap: üst sınırı olmayan kuralı kullan
  if (termDays === null) {
    const open = applicable.find((r) => r.maxTermDays === null);
    return toDecimal((open ?? applicable[0]).rate);
  }

  // Vadeyi kapsayan en dar kademeyi bul
  const tiered = applicable
    .filter((r) => r.maxTermDays === null || termDays <= r.maxTermDays)
    .sort((a, b) => (a.maxTermDays ?? Infinity) - (b.maxTermDays ?? Infinity));

  return toDecimal((tiered[0] ?? applicable[0]).rate);
}

/* ------------------------------------------------------------------ */
/* Reel getiri ve karşı-olgusal karşılaştırma                          */
/* ------------------------------------------------------------------ */

export interface RealReturnAnalysis {
  /** Vade sonuna kadar yıllıklaştırılmış net nominal getiri. */
  netNominalAnnual: Decimal;
  /** Enflasyondan arındırılmış yıllık getiri. */
  realAnnual: Decimal;
  /** Reel olarak kaybediliyor mu? */
  losingToInflation: boolean;
  /** Bir yılda satın alma gücü cinsinden kayıp/kazanç. */
  purchasingPowerChange: Money;
}

/**
 * "Bu mevduat beni gerçekten zengin ediyor mu?" sorusu.
 *
 * %42 faiz kulağa harika gelir; enflasyon %55 ise reel getiri
 * negatiftir ve her ay fakirleşiyorsunuzdur. Panel bunu gizlemez.
 */
export function analyzeRealReturn(
  terms: DepositTerms,
  annualInflation: Decimal | string | number,
): RealReturnAnalysis {
  const netNominalAnnual = effectiveAnnualRate(terms).times(
    new Decimal(1).minus(terms.withholdingRate),
  );
  const realAnnual = realReturn(netNominalAnnual, annualInflation);

  return {
    netNominalAnnual,
    realAnnual,
    losingToInflation: realAnnual.isNegative(),
    purchasingPowerChange: terms.principal.times(realAnnual),
  };
}

/** Yıllık efektif getiri oranı — bileşik etkisi dahil (APY). */
export function effectiveAnnualRate(terms: DepositTerms): Decimal {
  const { annualRate: r, compounding } = terms;
  switch (compounding) {
    case "simple":
      return r;
    case "continuous":
      return r.exp().minus(1);
    default: {
      const n = new Decimal(PERIODS_PER_YEAR[compounding]);
      return r.dividedBy(n).plus(1).pow(n).minus(1);
    }
  }
}

/**
 * Karşı-olgusal: "aynı para başka bir enstrümanda olsaydı ne olurdu?"
 * Basit bileşik büyüme ile karşılaştırma değeri üretir.
 */
export function counterfactualValue(
  principal: Money,
  annualReturn: Decimal | string | number,
  elapsedYears: Decimal,
): Money {
  const r = toDecimal(annualReturn);
  return principal.times(r.plus(1).pow(elapsedYears));
}
