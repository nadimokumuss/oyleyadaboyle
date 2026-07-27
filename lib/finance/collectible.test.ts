import { describe, it, expect } from "vitest";
import { Money } from "@/lib/money";
import { valueCollectible, type CollectibleTerms } from "./collectible";

const usd = (n: string | number) => Money.of(n, "USD");

const base: CollectibleTerms = {
  purchasePrice: usd(100_000),
  purchaseDate: new Date("2020-01-01"),
  appraisalValue: null,
  appraisalDate: null,
  annualCosts: usd(0),
};

const NOW = new Date("2026-01-01");

describe("valueCollectible", () => {
  it("ekspertiz yoksa alış fiyatı kullanılır ve defter işaretlenir", () => {
    const v = valueCollectible(base, NOW);
    expect(v.currentValue.toDb()).toBe("100000");
    expect(v.basis).toBe("book");
    expect(v.unrealizedPnl.toDb()).toBe("0");
  });

  it("ekspertiz varsa o kullanılır", () => {
    const v = valueCollectible(
      { ...base, appraisalValue: usd(150_000), appraisalDate: new Date("2025-06-01") },
      NOW,
    );
    expect(v.currentValue.toDb()).toBe("150000");
    expect(v.basis).toBe("appraisal");
    expect(v.unrealizedPnl.toDb()).toBe("50000");
  });

  it("değer kaybını negatif gösterir", () => {
    const v = valueCollectible({ ...base, appraisalValue: usd(70_000) }, NOW);
    expect(v.unrealizedPnl.toDb()).toBe("-30000");
  });

  it("elde tutma süresini hesaplar", () => {
    expect(valueCollectible(base, NOW).holdingYears.toNumber()).toBeCloseTo(6, 1);
  });

  it("taşıma maliyeti süreyle birikir", () => {
    const v = valueCollectible({ ...base, annualCosts: usd(2_000) }, NOW);
    // 6 yıl × 2.000 ≈ 12.000
    expect(Number(v.cumulativeCosts.toDb())).toBeCloseTo(12_000, -2);
  });

  it("net sonuç taşıma maliyetini düşer", () => {
    // %20 değerlenmiş ama sigortası yemiş
    const v = valueCollectible(
      { ...base, appraisalValue: usd(120_000), annualCosts: usd(2_000) },
      NOW,
    );
    expect(Number(v.unrealizedPnl.toDb())).toBe(20_000);
    expect(Number(v.netResult.toDb())).toBeCloseTo(8_000, -2);
  });

  it("taşıma maliyeti kazancı aşarsa net sonuç negatif", () => {
    const v = valueCollectible(
      { ...base, appraisalValue: usd(105_000), annualCosts: usd(5_000) },
      NOW,
    );
    expect(Number(v.netResult.toDb())).toBeLessThan(0);
  });

  it("yıllık bileşik getiriyi hesaplar", () => {
    // 100k → 200k, 6 yıl: 2^(1/6) − 1 ≈ %12,25
    const v = valueCollectible({ ...base, appraisalValue: usd(200_000) }, NOW);
    expect(v.annualizedReturn!.toNumber()).toBeCloseTo(0.1225, 2);
  });

  it("aynı gün alınmışsa yıllık getiri null — bölme hatası vermez", () => {
    const v = valueCollectible(base, new Date("2020-01-01"));
    expect(v.annualizedReturn).toBeNull();
    expect(v.holdingYears.toFixed()).toBe("0");
  });

  it("alış fiyatı sıfırsa yıllık getiri null", () => {
    const v = valueCollectible({ ...base, purchasePrice: usd(0) }, NOW);
    expect(v.annualizedReturn).toBeNull();
  });

  it("gelecek tarihli alışta süre negatif olmaz", () => {
    const v = valueCollectible({ ...base, purchaseDate: new Date("2030-01-01") }, NOW);
    expect(v.holdingYears.toFixed()).toBe("0");
    expect(v.cumulativeCosts.toDb()).toBe("0");
  });

  it("ekspertiz yaşını gün olarak bildirir", () => {
    const v = valueCollectible(
      { ...base, appraisalValue: usd(120_000), appraisalDate: new Date("2025-01-01") },
      NOW,
    );
    expect(v.appraisalAgeDays).toBe(365);
  });

  it("ekspertiz yoksa yaş null", () => {
    expect(valueCollectible(base, NOW).appraisalAgeDays).toBeNull();
  });

  it("model rozetini asla üretmez", () => {
    // Kıymetli eşyada endeks/model yoktur — yalnızca iki kaynak olabilir.
    for (const appraisal of [null, usd(150_000)]) {
      const v = valueCollectible({ ...base, appraisalValue: appraisal }, NOW);
      expect(["appraisal", "book"]).toContain(v.basis);
    }
  });
});
