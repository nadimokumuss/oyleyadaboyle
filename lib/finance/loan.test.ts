import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { Money } from "@/lib/money";
import {
  monthlyPayment, remainingBalance, amortizationSchedule,
  summarizeLoan, expectedPaymentsByNow, earlySettlementAmount,
  type LoanTerms,
} from "./loan";

const d = (s: string) => new Date(s + "T00:00:00.000Z");

function terms(over: Partial<LoanTerms> = {}): LoanTerms {
  return {
    principal: Money.of(2_000_000, "TRY"),
    annualRate: new Decimal("0.36"), // aylık %3
    termMonths: 120,
    startDate: d("2026-01-01"),
    ...over,
  };
}

describe("monthlyPayment — anüite formülü", () => {
  it("elle hesapla birebir tutar", () => {
    // 100.000 kredi, yıllık %12 (aylık %1), 12 ay
    // A = 100000 × 0.01 / (1 − 1.01^−12) = 8.884,88
    const p = monthlyPayment(
      terms({
        principal: Money.of(100_000, "TRY"),
        annualRate: new Decimal("0.12"),
        termMonths: 12,
      }),
    );
    expect(p.round(2).toNumber()).toBeCloseTo(8884.88, 1);
  });

  it("faiz sıfırsa anapara vadeye bölünür", () => {
    const p = monthlyPayment(
      terms({
        principal: Money.of(120_000, "TRY"),
        annualRate: new Decimal(0),
        termMonths: 12,
      }),
    );
    expect(p.toDb()).toBe("10000");
  });

  it("vade uzadıkça taksit düşer", () => {
    const short = monthlyPayment(terms({ termMonths: 60 }));
    const long = monthlyPayment(terms({ termMonths: 180 }));
    expect(long.lt(short)).toBe(true);
  });

  it("faiz arttıkça taksit yükselir", () => {
    const low = monthlyPayment(terms({ annualRate: new Decimal("0.10") }));
    const high = monthlyPayment(terms({ annualRate: new Decimal("0.50") }));
    expect(high.gt(low)).toBe(true);
  });

  it("taksit her zaman anaparanın vadeye bölümünden büyük", () => {
    const t = terms();
    const p = monthlyPayment(t);
    expect(p.gt(t.principal.dividedBy(t.termMonths))).toBe(true);
  });
});

describe("remainingBalance", () => {
  it("hiç ödeme yapılmadıysa anaparaya eşit", () => {
    expect(remainingBalance(terms(), 0).toDb()).toBe("2000000");
  });

  it("vade dolduğunda sıfır", () => {
    expect(remainingBalance(terms(), 120).isZero()).toBe(true);
  });

  it("vadeden fazla ödeme yapılsa da sıfırın altına inmez", () => {
    expect(remainingBalance(terms(), 999).isZero()).toBe(true);
  });

  it("ödeme ilerledikçe azalır", () => {
    const t = terms();
    const b12 = remainingBalance(t, 12);
    const b60 = remainingBalance(t, 60);
    const b100 = remainingBalance(t, 100);
    expect(b60.lt(b12)).toBe(true);
    expect(b100.lt(b60)).toBe(true);
  });

  it("başta anapara çok yavaş azalır (faiz ağırlıklı)", () => {
    const t = terms();
    // 120 ayın 12'si ödendi = %10; ama anapara %10'dan çok daha az düşmeli
    const paid = t.principal.minus(remainingBalance(t, 12));
    const ratio = paid.ratioTo(t.principal).toNumber();
    expect(ratio).toBeLessThan(0.05);
  });

  it("faizsiz kredide doğrusal azalır", () => {
    const t = terms({ annualRate: new Decimal(0), termMonths: 10, principal: Money.of(10_000, "TRY") });
    expect(remainingBalance(t, 5).toDb()).toBe("5000");
  });
});

describe("amortizationSchedule", () => {
  const t = terms({ termMonths: 12, principal: Money.of(100_000, "TRY"), annualRate: new Decimal("0.12") });

  it("vade kadar satır üretir", () => {
    expect(amortizationSchedule(t)).toHaveLength(12);
  });

  it("son satırda bakiye tam sıfır", () => {
    const rows = amortizationSchedule(t);
    expect(rows[rows.length - 1].balance.isZero()).toBe(true);
  });

  it("anapara payı zamanla artar, faiz payı azalır", () => {
    const rows = amortizationSchedule(t);
    expect(rows[11].principal.gt(rows[0].principal)).toBe(true);
    expect(rows[11].interest.lt(rows[0].interest)).toBe(true);
  });

  it("her satırda anapara + faiz = taksit", () => {
    for (const r of amortizationSchedule(t)) {
      expect(r.principal.plus(r.interest).round(6).toDb()).toBe(
        r.payment.round(6).toDb(),
      );
    }
  });

  it("anapara ödemeleri toplamı krediyi verir", () => {
    const total = amortizationSchedule(t).reduce(
      (a, r) => a.plus(r.principal),
      Money.zero("TRY"),
    );
    expect(total.round(2).toDb()).toBe("100000");
  });
});

describe("summarizeLoan", () => {
  it("toplam faiz kredinin gerçek maliyetini gösterir", () => {
    const t = terms({ termMonths: 12, principal: Money.of(100_000, "TRY"), annualRate: new Decimal("0.12") });
    const s = summarizeLoan(t, 0);
    // 12 × 8.884,88 = 106.618,55 → faiz ~6.618
    expect(s.totalInterest.round(0).toNumber()).toBeCloseTo(6619, -1);
    expect(s.totalPayment.gt(t.principal)).toBe(true);
  });

  it("uzun vadede toplam faiz anaparayı aşabilir", () => {
    const s = summarizeLoan(terms({ termMonths: 120 }), 0);
    expect(s.totalInterest.gt(s.remaining)).toBe(true);
  });

  it("ödenen anapara + kalan = toplam anapara", () => {
    const t = terms();
    const s = summarizeLoan(t, 40);
    expect(s.principalPaid.plus(s.remaining).round(2).toDb()).toBe("2000000");
  });

  it("kredi bittiğinde settled true", () => {
    expect(summarizeLoan(terms(), 120).settled).toBe(true);
    expect(summarizeLoan(terms(), 60).settled).toBe(false);
  });

  it("kalan taksit sayısı doğru", () => {
    const s = summarizeLoan(terms(), 40);
    expect(s.paymentsMade).toBe(40);
    expect(s.paymentsRemaining).toBe(80);
  });

  it("bitiş tarihi vade kadar sonra", () => {
    const s = summarizeLoan(terms({ termMonths: 12 }), 0);
    expect(s.endsAt.getUTCFullYear()).toBe(2027);
  });

  it("ödenen faiz negatif olmaz", () => {
    expect(summarizeLoan(terms(), 0).interestPaid.isNegative()).toBe(false);
  });
});

describe("expectedPaymentsByNow", () => {
  it("başlangıçta sıfır", () => {
    expect(expectedPaymentsByNow(d("2026-01-01"), 120, d("2026-01-01"))).toBe(0);
  });

  it("altı ay sonra altı taksit", () => {
    expect(expectedPaymentsByNow(d("2026-01-15"), 120, d("2026-07-15"))).toBe(6);
  });

  it("ay dolmadan sayılmaz", () => {
    expect(expectedPaymentsByNow(d("2026-01-15"), 120, d("2026-07-10"))).toBe(5);
  });

  it("vadeyi aşmaz", () => {
    expect(expectedPaymentsByNow(d("2020-01-01"), 12, d("2026-01-01"))).toBe(12);
  });

  it("başlangıçtan önce negatif dönmez", () => {
    expect(expectedPaymentsByNow(d("2026-06-01"), 12, d("2026-01-01"))).toBe(0);
  });
});

describe("earlySettlementAmount", () => {
  it("kalan anapara + komisyon", () => {
    const t = terms();
    const e = earlySettlementAmount(t, 60, "0.02");
    const balance = remainingBalance(t, 60);
    expect(e.balance.toDb()).toBe(balance.toDb());
    expect(e.penalty.round(2).toDb()).toBe(balance.times("0.02").round(2).toDb());
    expect(e.total.round(2).toDb()).toBe(balance.times("1.02").round(2).toDb());
  });

  it("erken kapatma faiz tasarrufu sağlar", () => {
    const e = earlySettlementAmount(terms(), 12);
    expect(e.interestSaved.isPositive()).toBe(true);
  });

  it("vade sonuna yakın tasarruf küçülür", () => {
    const early = earlySettlementAmount(terms(), 12);
    const late = earlySettlementAmount(terms(), 110);
    expect(late.interestSaved.lt(early.interestSaved)).toBe(true);
  });

  it("komisyonsuz kapatma desteklenir", () => {
    const e = earlySettlementAmount(terms(), 60, 0);
    expect(e.penalty.isZero()).toBe(true);
    expect(e.total.toDb()).toBe(e.balance.toDb());
  });

  it("kredi bitmişse kapatma tutarı sıfır", () => {
    const e = earlySettlementAmount(terms(), 120);
    expect(e.total.isZero()).toBe(true);
  });
});
