import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { Money } from "@/lib/money";
import {
  couponPayment,
  couponDates,
  accruedInterest,
  amortizedCost,
  valueBond,
  approximateYtm,
  currentYield,
  nextCouponDate,
  type BondTerms,
} from "./bond";

const try_ = (n: string | number) => Money.of(n, "TRY");

/** 1.000 nominal, %20 kupon, yılda 2 ödeme, 2 yıl vade, başabaş alınmış. */
const base: BondTerms = {
  faceValue: try_(1000),
  couponRate: new Decimal("0.20"),
  couponsPerYear: 2,
  purchasePrice: try_(1000),
  purchaseDate: new Date("2026-01-01"),
  maturityDate: new Date("2028-01-01"),
  dayCount: "ACT/365",
};

describe("couponPayment", () => {
  it("yıllık kuponu ödeme sayısına böler", () => {
    // 1000 × %20 = 200/yıl, yılda 2 ödeme → 100
    expect(couponPayment(base).toDb()).toBe("100");
  });

  it("kuponsuz tahvilde sıfır", () => {
    expect(couponPayment({ ...base, couponRate: new Decimal(0) }).toDb()).toBe("0");
    expect(couponPayment({ ...base, couponsPerYear: 0 }).toDb()).toBe("0");
  });

  it("yıllık tek ödemede kuponun tamamı", () => {
    expect(couponPayment({ ...base, couponsPerYear: 1 }).toDb()).toBe("200");
  });
});

describe("couponDates", () => {
  it("vadeden geriye doğru üretir", () => {
    const dates = couponDates(base).map((d) => d.toISOString().slice(0, 10));
    // 2 yıl × yılda 2 = 4 kupon
    expect(dates).toHaveLength(4);
    expect(dates[dates.length - 1]).toBe("2028-01-01");
  });

  it("alış tarihinden önceki kuponları içermez", () => {
    // Vadenin ortasında alınmış tahvil: geçmiş kuponlar bize ait değil.
    const mid = { ...base, purchaseDate: new Date("2027-01-01") };
    const dates = couponDates(mid);
    expect(dates.every((d) => d > mid.purchaseDate)).toBe(true);
    expect(dates).toHaveLength(2);
  });

  it("kuponsuz tahvilde boş", () => {
    expect(couponDates({ ...base, couponRate: new Decimal(0) })).toHaveLength(0);
  });

  it("kronolojik sırada döner", () => {
    const dates = couponDates(base);
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i].getTime()).toBeGreaterThan(dates[i - 1].getTime());
    }
  });
});

describe("accruedInterest", () => {
  it("kupon gününün hemen ardından ~sıfır", () => {
    const a = accruedInterest(base, new Date("2026-07-01"));
    expect(Number(a.toDb())).toBeLessThan(1);
  });

  it("dönem ortasında kuponun yaklaşık yarısı", () => {
    // 2026-07-01 ile 2027-01-01 arasının ortası ≈ 2026-10-01
    const a = accruedInterest(base, new Date("2026-10-01"));
    expect(Number(a.toDb())).toBeGreaterThan(45);
    expect(Number(a.toDb())).toBeLessThan(55);
  });

  it("dönem boyunca artar", () => {
    const early = Number(accruedInterest(base, new Date("2026-08-01")).toDb());
    const late = Number(accruedInterest(base, new Date("2026-12-01")).toDb());
    expect(late).toBeGreaterThan(early);
  });

  it("kupon tutarını aşmaz", () => {
    const a = accruedInterest(base, new Date("2026-12-31"));
    expect(Number(a.toDb())).toBeLessThanOrEqual(100);
  });

  it("vade dolduysa sıfır", () => {
    expect(accruedInterest(base, new Date("2028-06-01")).toDb()).toBe("0");
  });

  it("kuponsuz tahvilde sıfır", () => {
    const zero = { ...base, couponRate: new Decimal(0) };
    expect(accruedInterest(zero, new Date("2026-10-01")).toDb()).toBe("0");
  });
});

describe("amortizedCost", () => {
  const discount: BondTerms = {
    ...base,
    couponRate: new Decimal(0),
    couponsPerYear: 0,
    purchasePrice: try_(800), // 1000 nominal, iskontolu alınmış
  };

  it("alışta alış fiyatına eşit", () => {
    expect(Number(amortizedCost(discount, new Date("2026-01-01")).toDb())).toBeCloseTo(800, 6);
  });

  it("vadede nominale ulaşır", () => {
    expect(Number(amortizedCost(discount, new Date("2028-01-01")).toDb())).toBeCloseTo(1000, 6);
  });

  it("ortada yaklaşık yarı yolda", () => {
    const v = Number(amortizedCost(discount, new Date("2027-01-01")).toDb());
    expect(v).toBeGreaterThan(890);
    expect(v).toBeLessThan(910);
  });

  it("vadeden sonra nominali aşmaz", () => {
    expect(Number(amortizedCost(discount, new Date("2030-01-01")).toDb())).toBeCloseTo(1000, 6);
  });

  it("primli alımda aşağı iner", () => {
    // 1100'e alınmış tahvil vadede 1000 öder — değer düşer.
    const premium = { ...discount, purchasePrice: try_(1100) };
    expect(Number(amortizedCost(premium, new Date("2028-01-01")).toDb())).toBeCloseTo(1000, 6);
  });
});

describe("valueBond", () => {
  it("piyasa fiyatı verilmişse onu kullanır", () => {
    const v = valueBond(base, new Date("2026-07-01"), "0.98");
    expect(v.basis).toBe("market");
    expect(Number(v.cleanValue.toDb())).toBeCloseTo(980, 6);
  });

  it("piyasa fiyatı yoksa itfa maliyetine düşer", () => {
    const v = valueBond(base, new Date("2026-07-01"), null);
    expect(v.basis).toBe("amortized");
  });

  it("kirli değer = temiz + işlemiş faiz", () => {
    const v = valueBond(base, new Date("2026-10-01"), "0.98");
    const sum = Number(v.cleanValue.toDb()) + Number(v.accruedInterest.toDb());
    expect(Number(v.dirtyValue.toDb())).toBeCloseTo(sum, 8);
  });

  it("vadede nominale döner ve işlemiş faiz kalmaz", () => {
    const v = valueBond(base, new Date("2028-06-01"), "0.50");
    expect(v.matured).toBe(true);
    // Piyasa fiyatı ne olursa olsun vade dolunca nominal ödenir.
    expect(Number(v.cleanValue.toDb())).toBeCloseTo(1000, 6);
    expect(v.accruedInterest.toDb()).toBe("0");
    expect(v.daysToMaturity).toBeNull();
  });

  it("kalan gün sayısını hesaplar", () => {
    const v = valueBond(base, new Date("2027-12-31"), null);
    expect(v.daysToMaturity).toBe(1);
  });

  it("sıradaki kuponu bildirir", () => {
    const v = valueBond(base, new Date("2026-08-01"), null);
    expect(v.nextCoupon?.date).toBe("2027-01-01");
    expect(v.nextCoupon?.amount).toBe("100");
  });

  it("vadede sıradaki kupon yok", () => {
    expect(valueBond(base, new Date("2028-06-01"), null).nextCoupon).toBeNull();
  });

  it("gerçekleşmemiş K/Z alış maliyetine göre", () => {
    const v = valueBond(base, new Date("2026-07-01"), "1.05");
    expect(Number(v.unrealizedPnl.toDb())).toBeGreaterThan(0);
  });
});

describe("approximateYtm", () => {
  it("başabaş alınan tahvilde kupon oranına yakın", () => {
    const y = approximateYtm(base, new Date("2026-01-01"), try_(1000))!;
    expect(y.toNumber()).toBeCloseTo(0.20, 2);
  });

  it("iskontolu alımda kupondan yüksek", () => {
    const y = approximateYtm(base, new Date("2026-01-01"), try_(900))!;
    expect(y.toNumber()).toBeGreaterThan(0.20);
  });

  it("primli alımda kupondan düşük", () => {
    const y = approximateYtm(base, new Date("2026-01-01"), try_(1100))!;
    expect(y.toNumber()).toBeLessThan(0.20);
  });

  it("vade dolduysa null", () => {
    expect(approximateYtm(base, new Date("2028-06-01"), try_(1000))).toBeNull();
  });

  it("fiyat sıfırsa null — bölme hatası vermez", () => {
    expect(approximateYtm(base, new Date("2026-01-01"), try_(0))).toBeNull();
  });
});

describe("currentYield", () => {
  it("yıllık kupon / fiyat", () => {
    // 200 / 800 = %25
    expect(currentYield(base, try_(800))!.toFixed(4)).toBe("0.2500");
  });

  it("kuponsuzda null", () => {
    expect(currentYield({ ...base, couponRate: new Decimal(0) }, try_(800))).toBeNull();
  });

  it("fiyat sıfırsa null", () => {
    expect(currentYield(base, try_(0))).toBeNull();
  });
});

describe("nextCouponDate", () => {
  it("gelecekteki ilk kuponu verir", () => {
    expect(nextCouponDate(base, new Date("2026-08-01"))?.toISOString().slice(0, 10))
      .toBe("2027-01-01");
  });

  it("vadeden sonra null", () => {
    expect(nextCouponDate(base, new Date("2028-06-01"))).toBeNull();
  });
});
