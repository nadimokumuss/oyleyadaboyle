import { describe, it, expect } from "vitest";
import { sma, rsi, rangePosition, analyzeSignals, scoreToPercent } from "./signals";

/** Doğrusal artan seri. */
const rising = Array.from({ length: 250 }, (_, i) => 100 + i);
/** Doğrusal azalan seri. */
const falling = Array.from({ length: 250 }, (_, i) => 350 - i);
/** Yatay seri. */
const flat = Array.from({ length: 250 }, () => 100);

describe("sma", () => {
  it("son N değerin ortalamasını alır", () => {
    expect(sma([1, 2, 3, 4, 5], 5)).toBe(3);
    expect(sma([1, 2, 3, 4, 5], 2)).toBe(4.5);
  });

  it("yeterli veri yoksa null", () => {
    expect(sma([1, 2], 5)).toBeNull();
  });

  it("yükselen seride kısa ortalama uzun ortalamanın üstünde", () => {
    expect(sma(rising, 50)!).toBeGreaterThan(sma(rising, 200)!);
  });

  it("düşen seride tersi", () => {
    expect(sma(falling, 50)!).toBeLessThan(sma(falling, 200)!);
  });
});

describe("rsi", () => {
  it("sürekli yükselişte 100'e yaklaşır", () => {
    expect(rsi(rising, 14)!).toBeGreaterThan(95);
  });

  it("sürekli düşüşte 0'a yaklaşır", () => {
    expect(rsi(falling, 14)!).toBeLessThan(5);
  });

  it("yatay seride 50 döner", () => {
    expect(rsi(flat, 14)).toBe(50);
  });

  it("0-100 aralığında kalır", () => {
    const noisy = Array.from({ length: 100 }, (_, i) => 100 + Math.sin(i) * 20);
    const v = rsi(noisy, 14)!;
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(100);
  });

  it("yeterli veri yoksa null", () => {
    expect(rsi([1, 2, 3], 14)).toBeNull();
  });
});

describe("rangePosition", () => {
  it("zirvede 1", () => {
    expect(rangePosition([10, 20, 30])).toBe(1);
  });

  it("dipte 0", () => {
    expect(rangePosition([30, 20, 10])).toBe(0);
  });

  it("ortada 0,5", () => {
    expect(rangePosition([0, 100, 50])).toBe(0.5);
  });

  it("sabit fiyatta 0,5 — sıfıra bölmez", () => {
    expect(rangePosition([100, 100, 100])).toBe(0.5);
  });
});

describe("analyzeSignals", () => {
  it("yetersiz veride açıkça belirtir, skor uydurmaz", () => {
    const r = analyzeSignals("TEST", [100, 101, 102]);
    expect(r.sufficient).toBe(false);
    expect(r.score).toBe(0);
    expect(r.components).toHaveLength(0);
    expect(r.label).toBe("Yetersiz veri");
  });

  it("yükselen seride trend olumlu", () => {
    const r = analyzeSignals("UP", rising);
    expect(r.sufficient).toBe(true);
    expect(r.components.find((c) => c.key === "trend")?.direction).toBe("positive");
  });

  it("düşen seride olumsuz skor üretir", () => {
    const r = analyzeSignals("DOWN", falling);
    expect(r.score).toBeLessThan(0);
    expect(r.components.find((c) => c.key === "trend")?.direction).toBe("negative");
  });

  it("skor -1 ile +1 arasında kalır", () => {
    for (const series of [rising, falling, flat]) {
      const r = analyzeSignals("X", series);
      expect(r.score).toBeGreaterThanOrEqual(-1);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it("her bileşen gerekçesini taşır — kara kutu yok", () => {
    const r = analyzeSignals("UP", rising);
    expect(r.components.length).toBeGreaterThan(2);
    for (const c of r.components) {
      expect(c.explanation.length).toBeGreaterThan(10);
      expect(c.label).toBeTruthy();
      expect(c.value).toBeTruthy();
    }
  });

  it("bileşen katkılarının toplamı skoru verir", () => {
    const r = analyzeSignals("UP", rising);
    const sum = r.components.reduce((a, c) => a + c.contribution, 0);
    expect(r.score).toBeCloseTo(Math.max(-1, Math.min(1, sum)), 10);
  });

  it("geçersiz fiyatları eler", () => {
    const dirty = [...rising, NaN, 0, -5];
    const r = analyzeSignals("X", dirty);
    expect(r.dataPoints).toBe(rising.length);
  });

  it("aşırı yükselişte RSI 'pahalı' uyarısı verir", () => {
    const r = analyzeSignals("UP", rising);
    const rsiComp = r.components.find((c) => c.key === "rsi");
    expect(rsiComp?.direction).toBe("negative");
    expect(rsiComp?.contribution).toBeLessThan(0);
  });

  it("yatay seride skor nötr bölgede kalır", () => {
    const r = analyzeSignals("FLAT", flat);
    expect(Math.abs(r.score)).toBeLessThan(0.5);
  });
});

describe("scoreToPercent", () => {
  it("-1 → 0, 0 → 50, +1 → 100", () => {
    expect(scoreToPercent(-1)).toBe(0);
    expect(scoreToPercent(0)).toBe(50);
    expect(scoreToPercent(1)).toBe(100);
  });
});
