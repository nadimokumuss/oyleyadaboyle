import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { Money } from "@/lib/money";
import {
  yearFraction,
  balanceAt,
  accrue,
  earningsRate,
  resolveWithholdingRate,
  effectiveAnnualRate,
  analyzeRealReturn,
  counterfactualValue,
  type DepositTerms,
} from "./deposit";

const d = (s: string) => new Date(s + "T00:00:00.000Z");

function terms(over: Partial<DepositTerms> = {}): DepositTerms {
  return {
    principal: Money.of("100000000", "TRY"),
    annualRate: new Decimal("0.45"),
    compounding: "simple",
    dayCount: "ACT/365",
    startDate: d("2026-01-01"),
    maturityDate: null,
    withholdingRate: new Decimal("0.15"),
    ...over,
  };
}

describe("yearFraction — gün sayımı", () => {
  it("ACT/365: 32 gün = 32/365 yıl", () => {
    const tau = yearFraction(d("2026-01-01"), d("2026-02-02"), "ACT/365");
    expect(tau.toFixed(10)).toBe(new Decimal(32).dividedBy(365).toFixed(10));
  });

  it("ACT/360 aynı sürede daha büyük kesir verir", () => {
    const a365 = yearFraction(d("2026-01-01"), d("2026-02-02"), "ACT/365");
    const a360 = yearFraction(d("2026-01-01"), d("2026-02-02"), "ACT/360");
    expect(a360.greaterThan(a365)).toBe(true);
    // 100M TL'de bu fark ciddi para eder — yöntem doğru seçilmeli
    expect(a360.dividedBy(a365).toDecimalPlaces(6).toNumber()).toBeCloseTo(365 / 360, 5);
  });

  it("30/360: tam bir ay = 1/12 yıl", () => {
    const tau = yearFraction(d("2026-01-15"), d("2026-02-15"), "30/360");
    expect(tau.toFixed(10)).toBe(new Decimal(30).dividedBy(360).toFixed(10));
  });

  it("kesirli gün taşır — saatlik sayaç buna bağlı", () => {
    const half = yearFraction(
      new Date("2026-01-01T00:00:00Z"),
      new Date("2026-01-01T12:00:00Z"),
      "ACT/365",
    );
    expect(half.toFixed(12)).toBe(new Decimal(0.5).dividedBy(365).toFixed(12));
  });

  it("geçmiş tarih sıfır döner, negatif faiz üretmez", () => {
    expect(yearFraction(d("2026-02-01"), d("2026-01-01"), "ACT/365").toFixed()).toBe("0");
  });
});

describe("balanceAt — 100M TL / %45 / 32 gün (elle doğrulanmış)", () => {
  const t = terms();
  const at = d("2026-02-02"); // 32 gün

  it("basit faiz banka formülüyle birebir", () => {
    // Faiz = 100.000.000 × 0.45 × 32/365 = 3.945.205,479452...
    const expected = new Decimal(100_000_000).times("0.45").times(32).dividedBy(365);
    const balance = balanceAt(t, at);
    const interest = balance.minus(t.principal);
    expect(interest.amount.toFixed(6)).toBe(expected.toFixed(6));
    // Elle: 3.945.205,48 TL
    expect(interest.round(2).toDb()).toBe("3945205.48");
  });

  it("stopaj sonrası net doğru", () => {
    const a = accrue(t, at);
    // Brüt 3.945.205,479 × %15 = 591.780,82 stopaj
    expect(a.withholding.round(2).toDb()).toBe("591780.82");
    // Net = 3.945.205,48 − 591.780,82 = 3.353.424,66
    expect(a.netInterest.round(2).toDb()).toBe("3353424.66");
    expect(a.netBalance.round(2).toDb()).toBe("103353424.66");
  });

  it("bileşik faiz basit faizden fazla getirir", () => {
    const simple = balanceAt(terms({ compounding: "simple" }), at);
    const monthly = balanceAt(terms({ compounding: "monthly" }), at);
    const daily = balanceAt(terms({ compounding: "daily" }), at);
    const continuous = balanceAt(terms({ compounding: "continuous" }), at);

    expect(monthly.gt(simple)).toBe(true);
    expect(daily.gt(monthly)).toBe(true);
    expect(continuous.gt(daily)).toBe(true);
  });

  it("sürekli bileşik e^(rτ) formülüne uyar", () => {
    const t2 = terms({ compounding: "continuous" });
    const tau = new Decimal(32).dividedBy(365);
    const expected = new Decimal(100_000_000).times(new Decimal("0.45").times(tau).exp());
    expect(balanceAt(t2, at).amount.toFixed(4)).toBe(expected.toFixed(4));
  });

  it("başlangıçta bakiye anaparaya eşit", () => {
    expect(balanceAt(t, d("2026-01-01")).toDb()).toBe("100000000");
  });
});

describe("balanceAt — vade davranışı", () => {
  const t = terms({ maturityDate: d("2026-02-02") });

  it("vade sonrası faiz işlemez", () => {
    const atMaturity = balanceAt(t, d("2026-02-02"));
    const wayAfter = balanceAt(t, d("2027-06-01"));
    expect(wayAfter.eq(atMaturity)).toBe(true);
  });

  it("vade öncesi normal işler", () => {
    expect(balanceAt(t, d("2026-01-20")).gt(t.principal)).toBe(true);
  });

  it("accrue vade durumunu bildirir", () => {
    expect(accrue(t, d("2026-01-20")).matured).toBe(false);
    expect(accrue(t, d("2026-01-20")).daysToMaturity).toBe(13);
    expect(accrue(t, d("2026-03-01")).matured).toBe(true);
    expect(accrue(t, d("2026-03-01")).daysToMaturity).toBeNull();
  });
});

describe("earningsRate — çoklu ölçekli canlı kazanç", () => {
  const t = terms();
  const now = d("2026-02-02");

  it("basit faizde saatlik kazanç elle hesapla uyuşur", () => {
    const r = earningsRate(t, now, false); // brüt
    // Yıllık faiz 45.000.000 TL. Saatlik = 45.000.000 / (365×24) = 5136,986...
    const expectedPerHour = new Decimal(45_000_000).dividedBy(365 * 24);
    expect(r.perHour.amount.toFixed(4)).toBe(expectedPerHour.toFixed(4));
    // Saatte ~5.137 TL
    expect(r.perHour.round(2).toDb()).toBe("5136.99");
  });

  it("günlük kazanç 100M TL'de ~123 bin TL", () => {
    const r = earningsRate(t, now, false);
    // 45.000.000 / 365 = 123.287,67
    expect(r.perDay.round(2).toDb()).toBe("123287.67");
  });

  it("net oran stopaj kadar düşük", () => {
    const gross = earningsRate(t, now, false);
    const net = earningsRate(t, now, true);
    // net = brüt × (1 − 0.15)
    expect(net.perDay.amount.toFixed(6)).toBe(
      gross.perDay.amount.times("0.85").toFixed(6),
    );
  });

  it("ölçekler tutarlı: saatlik × 24 ≈ günlük", () => {
    const r = earningsRate(t, now, false);
    expect(r.perHour.times(24).amount.toFixed(4)).toBe(r.perDay.amount.toFixed(4));
    expect(r.perSecond.times(3600).amount.toFixed(4)).toBe(r.perHour.amount.toFixed(4));
  });

  it("vade dolmuşsa tüm hızlar sıfır", () => {
    const matured = terms({ maturityDate: d("2026-01-15") });
    const r = earningsRate(matured, d("2026-03-01"));
    expect(r.perSecond.isZero()).toBe(true);
    expect(r.perDay.isZero()).toBe(true);
    expect(r.perYear.isZero()).toBe(true);
  });

  it("bileşik faizde kazanç hızı zamanla artar", () => {
    const t2 = terms({ compounding: "daily" });
    const early = earningsRate(t2, d("2026-01-05"), false).perDay;
    const late = earningsRate(t2, d("2026-12-01"), false).perDay;
    expect(late.gt(early)).toBe(true);
  });
});

describe("resolveWithholdingRate — kademeli stopaj", () => {
  const rules = [
    { currency: "TRY", maxTermDays: 180, rate: "0.15" },
    { currency: "TRY", maxTermDays: 365, rate: "0.12" },
    { currency: "TRY", maxTermDays: null, rate: "0.10" },
    { currency: "USD", maxTermDays: null, rate: "0.25" },
  ];

  it("kısa vadede en yüksek kademe", () => {
    expect(resolveWithholdingRate(rules, "TRY", 32).toFixed()).toBe("0.15");
    expect(resolveWithholdingRate(rules, "TRY", 180).toFixed()).toBe("0.15");
  });

  it("orta vadede bir alt kademe", () => {
    expect(resolveWithholdingRate(rules, "TRY", 200).toFixed()).toBe("0.12");
  });

  it("uzun vadede en düşük kademe", () => {
    expect(resolveWithholdingRate(rules, "TRY", 400).toNumber()).toBe(0.1);
  });

  it("döviz mevduatı farklı oran", () => {
    expect(resolveWithholdingRate(rules, "USD", 32).toFixed()).toBe("0.25");
  });

  it("vadesiz hesap üst sınırsız kuralı kullanır", () => {
    expect(resolveWithholdingRate(rules, "TRY", null).toNumber()).toBe(0.1);
  });

  it("kural yoksa sıfır döner, patlamaz", () => {
    expect(resolveWithholdingRate([], "GBP", 30).toFixed()).toBe("0");
  });
});

describe("effectiveAnnualRate — APY", () => {
  it("basit faizde nominal orana eşit", () => {
    expect(effectiveAnnualRate(terms({ compounding: "simple" })).toFixed()).toBe("0.45");
  });

  it("aylık bileşikte nominalden yüksek", () => {
    const apy = effectiveAnnualRate(terms({ compounding: "monthly" }));
    // (1 + 0.45/12)^12 − 1 = 1.0375^12 − 1 = 0.55545...
    expect(apy.toDecimalPlaces(5).toNumber()).toBe(0.55545);
    expect(apy.greaterThan("0.45")).toBe(true);
  });

  it("sürekli bileşik en yüksek APY", () => {
    const cont = effectiveAnnualRate(terms({ compounding: "continuous" }));
    const daily = effectiveAnnualRate(terms({ compounding: "daily" }));
    expect(cont.greaterThan(daily)).toBe(true);
  });
});

describe("analyzeRealReturn — enflasyon gerçeği", () => {
  it("%45 faiz, %55 enflasyon → reel kayıp", () => {
    const a = analyzeRealReturn(terms(), "0.55");
    // Net nominal = 0.45 × 0.85 = 0.3825
    expect(a.netNominalAnnual.toDecimalPlaces(4).toNumber()).toBe(0.3825);
    // Reel = 1.3825/1.55 − 1 = −0.1081
    expect(a.realAnnual.toDecimalPlaces(4).toNumber()).toBe(-0.1081);
    expect(a.losingToInflation).toBe(true);
    // 100M TL bir yılda ~10,8M TL satın alma gücü kaybeder
    expect(a.purchasingPowerChange.isNegative()).toBe(true);
    expect(a.purchasingPowerChange.round(0).toDb()).toBe("-10806452");
  });

  it("%45 faiz, %20 enflasyon → reel kazanç", () => {
    const a = analyzeRealReturn(terms(), "0.20");
    expect(a.losingToInflation).toBe(false);
    expect(a.realAnnual.isPositive()).toBe(true);
  });

  it("stopaj reel getiriyi negatife çevirebilir", () => {
    // Brüt %45 > enflasyon %40 ama stopaj sonrası net %38,25 < %40
    const a = analyzeRealReturn(terms({ withholdingRate: new Decimal("0.15") }), "0.40");
    expect(a.netNominalAnnual.toDecimalPlaces(4).toNumber()).toBe(0.3825);
    expect(a.losingToInflation).toBe(true);
  });
});

describe("counterfactualValue — karşı-olgusal", () => {
  it("aynı para başka enstrümanda ne olurdu", () => {
    const oneYear = new Decimal(1);
    const v = counterfactualValue(Money.of("1000000", "USD"), "0.08", oneYear);
    expect(v.round(2).toDb()).toBe("1080000");
  });

  it("kesirli yılda bileşik büyür", () => {
    const halfYear = new Decimal("0.5");
    const v = counterfactualValue(Money.of("1000000", "USD"), "0.21", halfYear);
    // 1.21^0.5 = 1.1
    expect(v.round(2).toDb()).toBe("1100000");
  });
});
