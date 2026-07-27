import Decimal from "decimal.js";
import { Money, toDecimal, type CurrencyCode } from "@/lib/money";
import { yearFraction, type DayCount } from "./deposit";

/**
 * Tahvil ve bono matematiği.
 *
 * Tahvilin mevduattan ayrıldığı yer şu: **iki fiyatı vardır.**
 *
 *  - **Temiz fiyat**: piyasada kote edilen, işlemiş faizi içermeyen fiyat
 *  - **Kirli fiyat**: temiz fiyat + son kupondan bu yana biriken faiz
 *
 * Alıcı kirli fiyatı öder, çünkü satıcının hak ettiği ama henüz almadığı
 * kupon payı ona aittir. Panelin gösterdiği değer kirli fiyattır — elinizde
 * gerçekte ne kadar varlık olduğu budur.
 *
 * `yearFraction` mevduat motorundan yeniden kullanılıyor; gün sayım
 * konvansiyonu iki enstrümanda da aynı anlama gelir.
 */

export interface BondTerms {
  /** Nominal (par) değer — vadede geri ödenecek tutar. */
  faceValue: Money;
  /** Yıllık kupon oranı. 0 ise iskontolu (kuponsuz) tahvil. */
  couponRate: Decimal;
  /** Yılda kaç kupon ödemesi. 0 = kuponsuz. */
  couponsPerYear: number;
  purchasePrice: Money;
  purchaseDate: Date;
  maturityDate: Date;
  dayCount: DayCount;
}

/** Tek bir kupon ödemesinin tutarı. */
export function couponPayment(terms: BondTerms): Money {
  if (terms.couponsPerYear <= 0 || terms.couponRate.isZero()) {
    return Money.zero(terms.faceValue.currency);
  }
  return terms.faceValue.times(terms.couponRate).dividedBy(terms.couponsPerYear);
}

/**
 * Kupon ödeme tarihlerini üretir.
 *
 * Vadeden geriye doğru sayılır, alış tarihinden ileriye değil: kupon
 * takvimi ihraççının belirlediği vadeye bağlıdır ve sizin ne zaman
 * aldığınız onu kaydırmaz.
 */
export function couponDates(terms: BondTerms): Date[] {
  if (terms.couponsPerYear <= 0 || terms.couponRate.isZero()) return [];

  const monthsBetween = 12 / terms.couponsPerYear;
  const dates: Date[] = [];
  const maturity = terms.maturityDate;

  // Vadeden geriye, alış tarihinin gerisine düşene kadar.
  for (let i = 0; i < 400; i++) {
    const d = new Date(maturity);
    d.setMonth(d.getMonth() - Math.round(monthsBetween * i));
    if (d <= terms.purchaseDate) break;
    dates.push(d);
  }

  return dates.reverse();
}

/** `now` anından önceki son kupon tarihi (yoksa alış tarihi). */
export function lastCouponDate(terms: BondTerms, now: Date): Date {
  const dates = couponDates(terms);
  let last = terms.purchaseDate;
  for (const d of dates) {
    if (d <= now) last = d;
    else break;
  }
  return last;
}

/** `now` anından sonraki ilk kupon tarihi (yoksa null). */
export function nextCouponDate(terms: BondTerms, now: Date): Date | null {
  for (const d of couponDates(terms)) {
    if (d > now) return d;
  }
  return null;
}

/**
 * İşlemiş faiz: son kupondan bu yana biriken, henüz ödenmemiş kupon payı.
 *
 * Vade dolduysa sıfır — geri ödeme yapılmış, biriken bir şey kalmamıştır.
 */
export function accruedInterest(terms: BondTerms, now: Date): Money {
  const currency = terms.faceValue.currency;
  if (terms.couponsPerYear <= 0 || terms.couponRate.isZero()) {
    return Money.zero(currency);
  }
  if (now >= terms.maturityDate) return Money.zero(currency);

  const last = lastCouponDate(terms, now);
  const next = nextCouponDate(terms, now);
  if (!next) return Money.zero(currency);

  const elapsed = yearFraction(last, now, terms.dayCount);
  const period = yearFraction(last, next, terms.dayCount);
  if (period.isZero()) return Money.zero(currency);

  const fraction = Decimal.min(new Decimal(1), elapsed.dividedBy(period));
  return couponPayment(terms).times(fraction);
}

/**
 * Kuponsuz (iskontolu) tahvilde itfa edilmiş maliyet.
 *
 * Alış ile nominal arasındaki fark vadeye kadar doğrusal dağıtılır. Gerçek
 * muhasebe efektif faiz yöntemini kullanır; doğrusal yaklaşım kısa vadede
 * yeterince yakın ve okunabilir.
 */
export function amortizedCost(terms: BondTerms, now: Date): Money {
  const total = yearFraction(terms.purchaseDate, terms.maturityDate, terms.dayCount);
  if (total.isZero()) return terms.faceValue;

  const elapsed = Decimal.min(
    total,
    yearFraction(terms.purchaseDate, now, terms.dayCount),
  );
  const progress = elapsed.dividedBy(total);
  const discount = terms.faceValue.minus(terms.purchasePrice);
  return terms.purchasePrice.plus(discount.times(progress));
}

export interface BondValuation {
  /** İşlemiş faiz hariç değer. */
  cleanValue: Money;
  accruedInterest: Money;
  /** Panelin gösterdiği değer: temiz + işlemiş. */
  dirtyValue: Money;
  /** Değer nereden geldi? */
  basis: "market" | "amortized";
  matured: boolean;
  daysToMaturity: number | null;
  nextCoupon: { date: string; amount: string } | null;
  /** Alış maliyetine göre gerçekleşmemiş K/Z. */
  unrealizedPnl: Money;
}

const MS_PER_DAY = 86_400_000;

/**
 * Tahvilin güncel değeri.
 *
 * Piyasa temiz fiyatı girilmişse o kullanılır; girilmemişse itfa maliyeti.
 * İkincisi bir tahmindir ama uydurma değil: elinizde tuttuğunuz sürece
 * vadede nominali alacaksınız, ara değer o yolun neresinde olduğunuzdur.
 */
export function valueBond(
  terms: BondTerms,
  now: Date,
  marketPricePct: Decimal | string | null,
): BondValuation {
  const currency = terms.faceValue.currency;
  const matured = now >= terms.maturityDate;

  let cleanValue: Money;
  let basis: "market" | "amortized";

  if (matured) {
    // Vade doldu: nominal geri ödenir.
    cleanValue = terms.faceValue;
    basis = "amortized";
  } else if (marketPricePct !== null && marketPricePct !== undefined) {
    cleanValue = terms.faceValue.times(toDecimal(marketPricePct));
    basis = "market";
  } else {
    cleanValue = amortizedCost(terms, now);
    basis = "amortized";
  }

  const accrued = accruedInterest(terms, now);
  const dirtyValue = cleanValue.plus(accrued);

  const next = nextCouponDate(terms, now);

  return {
    cleanValue,
    accruedInterest: accrued,
    dirtyValue,
    basis,
    matured,
    daysToMaturity: matured
      ? null
      : Math.ceil((terms.maturityDate.getTime() - now.getTime()) / MS_PER_DAY),
    nextCoupon: next
      ? { date: next.toISOString().slice(0, 10), amount: couponPayment(terms).toDb() }
      : null,
    unrealizedPnl: dirtyValue.minus(terms.purchasePrice),
  };
}

/**
 * Vadeye kadar getiri (YTM) — yaklaşık formül.
 *
 * YTM = (yıllık kupon + (nominal − fiyat) / kalan yıl) / ((nominal + fiyat) / 2)
 *
 * Kesin YTM, nakit akışlarını bugüne indirgeyen denklemin kökünü bulmayı
 * gerektirir (`metrics.ts` içindeki XIRR bunu yapar). Bu yaklaşım standart
 * bir el hesabıdır ve tipik vadelerde kesin değere yakındır; arayüzde
 * "yaklaşık" olduğu belirtilmelidir.
 *
 * Vade dolmuşsa veya fiyat sıfırsa null.
 */
export function approximateYtm(
  terms: BondTerms,
  now: Date,
  price: Money,
): Decimal | null {
  if (now >= terms.maturityDate) return null;
  if (price.isZero()) return null;

  const yearsLeft = yearFraction(now, terms.maturityDate, terms.dayCount);
  if (yearsLeft.isZero()) return null;

  const annualCoupon = terms.faceValue.times(terms.couponRate);
  const capitalGainPerYear = terms.faceValue.minus(price).dividedBy(yearsLeft);
  const averagePrice = terms.faceValue.plus(price).dividedBy(2);

  if (averagePrice.isZero()) return null;

  return annualCoupon.plus(capitalGainPerYear).ratioTo(averagePrice);
}

/** Cari verim: yıllık kupon / güncel fiyat. Kuponsuzda null. */
export function currentYield(terms: BondTerms, price: Money): Decimal | null {
  if (terms.couponRate.isZero() || price.isZero()) return null;
  return terms.faceValue.times(terms.couponRate).ratioTo(price);
}

/** Yardımcı: DB satırından `BondTerms` kurar. */
export function toBondTerms(
  row: {
    faceValue: string;
    couponRate: string;
    couponsPerYear: number;
    purchasePrice: string;
    purchaseDate: string;
    maturityDate: string;
    dayCount: string;
  },
  currency: CurrencyCode,
): BondTerms {
  return {
    faceValue: Money.of(row.faceValue, currency),
    couponRate: new Decimal(row.couponRate),
    couponsPerYear: row.couponsPerYear,
    purchasePrice: Money.of(row.purchasePrice, currency),
    purchaseDate: new Date(row.purchaseDate),
    maturityDate: new Date(row.maturityDate),
    dayCount: row.dayCount as DayCount,
  };
}
