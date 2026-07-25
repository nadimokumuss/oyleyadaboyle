import Decimal from "decimal.js";
import { Money, toDecimal } from "@/lib/money";

/**
 * Kredi ve ipotek hesapları.
 *
 * Standart anüite (eşit taksitli) kredi modeli: her ay aynı tutar
 * ödenir, başta faiz payı büyüktür, zamanla anapara payı artar.
 * Türkiye'de konut ve taşıt kredileri bu şekilde işler.
 *
 * Kalan borç DB'de saklanmaz; ödenen taksit sayısından hesaplanır.
 * İki ayrı kayıt tutmak (hem taksit sayısı hem bakiye) er ya da geç
 * birbirinden sapar.
 */

export interface LoanTerms {
  principal: Money;
  /** Yıllık nominal faiz oranı (0.35 = %35). */
  annualRate: Decimal;
  termMonths: number;
  startDate: Date;
}

/** Aylık faiz oranı. */
function monthlyRate(annual: Decimal): Decimal {
  return annual.dividedBy(12);
}

/**
 * Aylık eşit taksit tutarı (anüite formülü):
 *
 *   A = P · r / (1 − (1+r)^(−n))
 *
 * Faiz sıfırsa formül tanımsız olur (0/0), o durumda anapara vadeye
 * eşit bölünür.
 */
export function monthlyPayment(terms: LoanTerms): Money {
  const r = monthlyRate(terms.annualRate);
  const n = terms.termMonths;

  if (n <= 0) return terms.principal;
  if (r.isZero()) return terms.principal.dividedBy(n);

  const factor = new Decimal(1).plus(r).pow(-n);
  const denominator = new Decimal(1).minus(factor);
  if (denominator.isZero()) return terms.principal.dividedBy(n);

  return terms.principal.times(r).dividedBy(denominator);
}

/**
 * `paymentsMade` taksit ödendikten sonra kalan anapara borcu:
 *
 *   B_k = P·(1+r)^k − A·((1+r)^k − 1)/r
 */
export function remainingBalance(terms: LoanTerms, paymentsMade: number): Money {
  const n = terms.termMonths;
  const k = Math.max(0, Math.min(paymentsMade, n));

  if (k >= n) return Money.zero(terms.principal.currency);
  if (k === 0) return terms.principal;

  const r = monthlyRate(terms.annualRate);
  if (r.isZero()) {
    const perPayment = terms.principal.dividedBy(n);
    return terms.principal.minus(perPayment.times(k));
  }

  const growth = new Decimal(1).plus(r).pow(k);
  const payment = monthlyPayment(terms);

  const balance = terms.principal
    .times(growth)
    .minus(payment.times(growth.minus(1).dividedBy(r)));

  // Yuvarlama artıkları yüzünden küçük negatife düşebilir
  return balance.isNegative() ? Money.zero(terms.principal.currency) : balance;
}

export interface AmortizationRow {
  month: number;
  payment: Money;
  interest: Money;
  principal: Money;
  balance: Money;
}

/** Tam ödeme planı — anapara/faiz ayrımıyla. */
export function amortizationSchedule(terms: LoanTerms): AmortizationRow[] {
  const rows: AmortizationRow[] = [];
  const r = monthlyRate(terms.annualRate);
  const payment = monthlyPayment(terms);

  let balance = terms.principal;

  for (let month = 1; month <= terms.termMonths; month++) {
    const interest = balance.times(r);
    let principalPart = payment.minus(interest);

    // Son taksitte yuvarlama farkını kapat
    if (month === terms.termMonths || principalPart.gt(balance)) {
      principalPart = balance;
    }

    balance = balance.minus(principalPart);
    if (balance.isNegative()) balance = Money.zero(terms.principal.currency);

    rows.push({
      month,
      payment: principalPart.plus(interest),
      interest,
      principal: principalPart,
      balance,
    });
  }

  return rows;
}

export interface LoanSummary {
  monthlyPayment: Money;
  /** Vade boyunca ödenecek toplam. */
  totalPayment: Money;
  /** Toplam faiz maliyeti — kredinin gerçek fiyatı. */
  totalInterest: Money;
  /** Şu anki kalan borç. */
  remaining: Money;
  /** Bugüne kadar ödenmiş anapara. */
  principalPaid: Money;
  /** Bugüne kadar ödenmiş faiz. */
  interestPaid: Money;
  paymentsMade: number;
  paymentsRemaining: number;
  /** Son taksit tarihi. */
  endsAt: Date;
  /** Kredi bitti mi? */
  settled: boolean;
}

export function summarizeLoan(
  terms: LoanTerms,
  paymentsMade: number,
): LoanSummary {
  const payment = monthlyPayment(terms);
  const k = Math.max(0, Math.min(paymentsMade, terms.termMonths));
  const remaining = remainingBalance(terms, k);

  const totalPayment = payment.times(terms.termMonths);
  const totalInterest = totalPayment.minus(terms.principal);

  const principalPaid = terms.principal.minus(remaining);
  const interestPaid = payment.times(k).minus(principalPaid);

  const endsAt = new Date(terms.startDate);
  endsAt.setMonth(endsAt.getMonth() + terms.termMonths);

  return {
    monthlyPayment: payment,
    totalPayment,
    totalInterest,
    remaining,
    principalPaid,
    interestPaid: interestPaid.isNegative()
      ? Money.zero(terms.principal.currency)
      : interestPaid,
    paymentsMade: k,
    paymentsRemaining: terms.termMonths - k,
    endsAt,
    settled: k >= terms.termMonths || remaining.isZero(),
  };
}

/**
 * Başlangıç tarihine göre bugüne kadar geçmesi gereken taksit sayısı.
 *
 * Kullanıcı her ay elle "ödedim" işaretlemek zorunda kalmasın diye
 * takvimden türetilir. Elle düzeltme yine mümkün.
 */
export function expectedPaymentsByNow(
  startDate: Date,
  termMonths: number,
  now: Date = new Date(),
): number {
  const months =
    (now.getFullYear() - startDate.getFullYear()) * 12 +
    (now.getMonth() - startDate.getMonth()) -
    (now.getDate() < startDate.getDate() ? 1 : 0);

  return Math.max(0, Math.min(months, termMonths));
}

/**
 * Erken kapatma tutarı.
 *
 * Kalan anapara + varsa erken kapatma komisyonu. Türkiye'de konut
 * kredilerinde kalan anaparanın %2'sini geçemez (mevzuat), o yüzden
 * varsayılan %2 ama sıfırlanabilir.
 */
export function earlySettlementAmount(
  terms: LoanTerms,
  paymentsMade: number,
  penaltyRate: Decimal | string | number = "0.02",
): { balance: Money; penalty: Money; total: Money; interestSaved: Money } {
  const balance = remainingBalance(terms, paymentsMade);
  const penalty = balance.times(toDecimal(penaltyRate));

  // Krediyi sürdürseydik ödeyeceğimiz kalan faiz
  const summary = summarizeLoan(terms, paymentsMade);
  const futurePayments = summary.monthlyPayment.times(summary.paymentsRemaining);
  const interestSaved = futurePayments.minus(balance).minus(penalty);

  return {
    balance,
    penalty,
    total: balance.plus(penalty),
    interestSaved: interestSaved.isNegative()
      ? Money.zero(terms.principal.currency)
      : interestSaved,
  };
}
