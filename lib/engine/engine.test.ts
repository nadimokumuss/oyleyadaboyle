import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { Money } from "@/lib/money";
import { simulate, runStressTest, STRESS_SCENARIOS, type StressAsset } from "./montecarlo";

const usd = (n: number | string) => Money.of(n, "USD");

describe("simulate — Monte Carlo", () => {
  const base = {
    initialValue: 10_000_000,
    assumptions: [
      { key: "equity", label: "Hisse", weight: 0.6, expectedReturn: 0.07, volatility: 0.16 },
      { key: "deposit", label: "Mevduat", weight: 0.4, expectedReturn: 0.005, volatility: 0.01 },
    ],
    years: 10,
    paths: 2000,
    seed: 7,
  };

  it("persentil bantları sıralı olur", () => {
    const r = simulate(base);
    for (const p of r.percentiles) {
      expect(Number(p.p10)).toBeLessThanOrEqual(Number(p.p25));
      expect(Number(p.p25)).toBeLessThanOrEqual(Number(p.p50));
      expect(Number(p.p50)).toBeLessThanOrEqual(Number(p.p75));
      expect(Number(p.p75)).toBeLessThanOrEqual(Number(p.p90));
    }
  });

  it("başlangıç yılında tüm persentiller başlangıç değerine eşit", () => {
    const r = simulate(base);
    expect(Number(r.percentiles[0].p50)).toBe(10_000_000);
    expect(Number(r.percentiles[0].p10)).toBe(10_000_000);
  });

  it("yıl sayısı kadar nokta üretir", () => {
    const r = simulate(base);
    expect(r.percentiles).toHaveLength(11); // 0..10
  });

  it("aynı seed aynı sonucu verir", () => {
    const a = simulate(base);
    const b = simulate(base);
    expect(a.finalP50).toBe(b.finalP50);
    expect(a.probabilityOfLoss).toBe(b.probabilityOfLoss);
  });

  it("farklı seed farklı sonuç verir", () => {
    const a = simulate(base);
    const b = simulate({ ...base, seed: 999 });
    expect(a.finalP50).not.toBe(b.finalP50);
  });

  it("pozitif beklenen getiride medyan büyür", () => {
    const r = simulate(base);
    expect(Number(r.finalP50)).toBeGreaterThan(10_000_000);
  });

  it("yüksek volatilite bandı genişletir", () => {
    const calm = simulate(base);
    const wild = simulate({
      ...base,
      assumptions: [
        { key: "crypto", label: "Kripto", weight: 1, expectedReturn: 0.07, volatility: 0.65 },
      ],
    });
    const calmSpread = Number(calm.finalP90) - Number(calm.finalP10);
    const wildSpread = Number(wild.finalP90) - Number(wild.finalP10);
    expect(wildSpread).toBeGreaterThan(calmSpread);
  });

  it("değer hiçbir zaman negatife inmez", () => {
    const r = simulate({
      ...base,
      assumptions: [
        { key: "x", label: "X", weight: 1, expectedReturn: -0.5, volatility: 0.9 },
      ],
      years: 30,
    });
    for (const p of r.percentiles) {
      expect(Number(p.p10)).toBeGreaterThanOrEqual(0);
    }
  });

  it("kayıp olasılığı 0-1 aralığında", () => {
    const r = simulate(base);
    const pol = Number(r.probabilityOfLoss);
    expect(pol).toBeGreaterThanOrEqual(0);
    expect(pol).toBeLessThanOrEqual(1);
  });

  it("yıllık katkı birikimi artırır", () => {
    const without = simulate(base);
    const with_ = simulate({ ...base, annualContribution: 500_000 });
    expect(Number(with_.finalP50)).toBeGreaterThan(Number(without.finalP50));
  });

  it("ağırlıklı portföy getirisi bileşenler arasında kalır", () => {
    const r = simulate(base);
    const mu = Number(r.portfolioReturn);
    expect(mu).toBeGreaterThan(0.005);
    expect(mu).toBeLessThan(0.07);
  });
});

/* ------------------------------------------------------------------ */

const assets: StressAsset[] = [
  { name: "VOO", kind: "equity", currency: "USD", valueUsd: usd(1_200_000) },
  { name: "Bitcoin", kind: "crypto", currency: "USD", valueUsd: usd(1_150_000) },
  { name: "THYAO", kind: "equity", currency: "TRY", valueUsd: usd(260_000) },
  { name: "İstanbul Daire", kind: "realestate", currency: "TRY", valueUsd: usd(930_000) },
  { name: "TL Mevduat", kind: "deposit", currency: "TRY", valueUsd: usd(2_200_000) },
  { name: "Girişim", kind: "venture", currency: "USD", valueUsd: usd(2_600_000) },
];

describe("runStressTest", () => {
  const byKey = (k: string) => STRESS_SCENARIOS.find((s) => s.key === k)!;

  it("borsa çöküşü hisse ve kriptoyu vurur, mevduatı vurmaz", () => {
    const r = runStressTest(assets, byKey("equityCrash"));
    // VOO 1.2M × 0.6 = 720K, kayıp 480K
    expect(r.impacts.some((i) => i.name === "VOO")).toBe(true);
    expect(r.impacts.some((i) => i.name === "TL Mevduat")).toBe(false);
    expect(Number(r.loss)).toBeGreaterThan(0);
  });

  it("kur şoku sadece TL varlıkları vurur", () => {
    const r = runStressTest(assets, byKey("fxShock"));
    expect(r.impacts.some((i) => i.name === "TL Mevduat")).toBe(true);
    expect(r.impacts.some((i) => i.name === "Bitcoin")).toBe(false);
  });

  it("girişim sıfırlanması pozisyonu tamamen siler", () => {
    const r = runStressTest(assets, byKey("ventureWipeout"));
    const impact = r.impacts.find((i) => i.name === "Girişim");
    expect(Number(impact!.loss)).toBe(2_600_000);
  });

  it("mükemmel fırtına en büyük kaybı verir", () => {
    const storm = runStressTest(assets, byKey("perfectStorm"));
    const crash = runStressTest(assets, byKey("equityCrash"));
    expect(Number(storm.loss)).toBeGreaterThan(Number(crash.loss));
  });

  it("çoklu şok çarpımsal birleşir, toplamsal değil", () => {
    // Tek varlıkla izole test: TL cinsinden bir hisse
    const single: StressAsset[] = [
      { name: "THYAO", kind: "equity", currency: "TRY", valueUsd: usd(1_000_000) },
    ];
    const r = runStressTest(single, byKey("perfectStorm"));
    // Hisse -%40 VE TL -%33,33 → kalan (0,60)(0,6667) = 0,40
    // Toplamsal olsaydı 1 − 0,40 − 0,3333 = 0,2667 kalırdı — farklı sonuç
    expect(Number(r.after)).toBeCloseTo(400_000, -3);
    expect(Number(r.loss)).toBeCloseTo(600_000, -3);
    // Toplamsal birleştirmenin vereceği yanlış sonuçtan farklı olmalı
    expect(Number(r.after)).not.toBeCloseTo(266_700, -3);
  });

  it("değer sıfırın altına inmez", () => {
    const r = runStressTest(assets, byKey("perfectStorm"));
    expect(Number(r.after)).toBeGreaterThanOrEqual(0);
  });

  it("kayıp oranı öncesine göre hesaplanır", () => {
    const r = runStressTest(assets, byKey("equityCrash"));
    const ratio = new Decimal(r.loss).dividedBy(r.before);
    expect(new Decimal(r.lossRatio).minus(ratio).abs().lessThan("1e-10")).toBe(true);
  });

  it("boş portföyde patlamaz", () => {
    const r = runStressTest([], byKey("perfectStorm"));
    expect(r.before).toBe("0");
    expect(r.lossRatio).toBe("0");
  });

  it("en çok etkilenen 5 varlıkla sınırlanır", () => {
    const r = runStressTest(assets, byKey("perfectStorm"));
    expect(r.impacts.length).toBeLessThanOrEqual(5);
    // Büyükten küçüğe sıralı
    for (let i = 1; i < r.impacts.length; i++) {
      expect(Number(r.impacts[i - 1].loss)).toBeGreaterThanOrEqual(Number(r.impacts[i].loss));
    }
  });
});
