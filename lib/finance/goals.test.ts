import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { analyzeGoal, probabilityOfReaching, analyzeIndependence } from "./goals";

const d = (n: string | number) => new Decimal(n);

describe("analyzeGoal", () => {
  it("hedefe ulaşıldıysa açık eksik sıfır", () => {
    const g = analyzeGoal({
      targetAmount: d(100_000),
      currentValue: d(120_000),
      yearsRemaining: 5,
    });
    expect(g.achieved).toBe(true);
    expect(g.shortfall.toFixed()).toBe("0");
    expect(g.requiredAnnualReturn).toBeNull();
  });

  it("ilerleme oranı doğru", () => {
    const g = analyzeGoal({
      targetAmount: d(100_000),
      currentValue: d(25_000),
      yearsRemaining: 10,
    });
    expect(g.progress.toFixed(2)).toBe("0.25");
    expect(g.shortfall.toFixed()).toBe("75000");
  });

  it("gereken yıllık getiriyi hesaplar", () => {
    // 100k → 200k, 10 yıl: 2^(1/10) − 1 ≈ %7,18
    const g = analyzeGoal({
      targetAmount: d(200_000),
      currentValue: d(100_000),
      yearsRemaining: 10,
    });
    expect(g.requiredAnnualReturn!.toNumber()).toBeCloseTo(0.0718, 3);
  });

  it("bugünkü değer sıfırsa getiri oranı hesaplanamaz", () => {
    // Hiç paranız yoksa hiçbir getiri oranı yetmez — birikim şart.
    const g = analyzeGoal({
      targetAmount: d(100_000),
      currentValue: d(0),
      yearsRemaining: 10,
    });
    expect(g.requiredAnnualReturn).toBeNull();
    expect(g.requiredMonthlySaving!.toFixed(2)).toBe("833.33");
  });

  it("gereken aylık tasarrufu hesaplar", () => {
    const g = analyzeGoal({
      targetAmount: d(120_000),
      currentValue: d(0),
      yearsRemaining: 10,
    });
    expect(g.requiredMonthlySaving!.toFixed()).toBe("1000");
  });

  it("tarihi geçmiş hedefi işaretler", () => {
    const g = analyzeGoal({
      targetAmount: d(100_000),
      currentValue: d(50_000),
      yearsRemaining: -1,
    });
    expect(g.overdue).toBe(true);
    expect(g.requiredAnnualReturn).toBeNull();
    expect(g.requiredMonthlySaving).toBeNull();
  });

  it("sıfır hedefte bölme hatası vermez", () => {
    const g = analyzeGoal({
      targetAmount: d(0),
      currentValue: d(1000),
      yearsRemaining: 5,
    });
    expect(g.progress.toFixed()).toBe("0");
    expect(g.achieved).toBe(true);
  });
});

describe("probabilityOfReaching", () => {
  it("hedefi tutturan yol oranını verir", () => {
    const finals = [50, 150, 200, 250];
    expect(probabilityOfReaching(finals, d(150)).toFixed(2)).toBe("0.75");
  });

  it("hiçbiri tutmuyorsa sıfır", () => {
    expect(probabilityOfReaching([10, 20], d(1000)).toFixed()).toBe("0");
  });

  it("hepsi tutuyorsa bir", () => {
    expect(probabilityOfReaching([1000, 2000], d(100)).toFixed()).toBe("1");
  });

  it("boş listede sıfır — çökmez", () => {
    expect(probabilityOfReaching([], d(100)).toFixed()).toBe("0");
  });

  it("tam eşit değer hedefe ulaşmış sayılır", () => {
    expect(probabilityOfReaching([100], d(100)).toFixed()).toBe("1");
  });
});

describe("analyzeIndependence", () => {
  const base = {
    currentNetWorth: d(100_000),
    monthlyLivingCost: d(3_000),
    monthlySaving: d(2_000),
    annualReturn: d("0.05"),
    withdrawalRate: d("0.04"),
  };

  it("hedef portföy = yıllık gider / çekim oranı", () => {
    const r = analyzeIndependence(base);
    // 36.000 / 0,04 = 900.000
    expect(r.targetNetWorth.toFixed()).toBe("900000");
  });

  it("zaten bağımsızsa sıfır yıl", () => {
    const r = analyzeIndependence({ ...base, currentNetWorth: d(1_000_000) });
    expect(r.alreadyIndependent).toBe(true);
    expect(r.yearsToIndependence).toBe(0);
  });

  it("tasarruf oranını hesaplar", () => {
    // 2000 / (2000 + 3000) = %40
    expect(analyzeIndependence(base).savingsRate!.toFixed(2)).toBe("0.40");
  });

  it("makul bir yıl sayısı üretir", () => {
    const r = analyzeIndependence(base);
    expect(r.yearsToIndependence).toBeGreaterThan(0);
    expect(r.yearsToIndependence).toBeLessThan(100);
  });

  it("daha çok tasarruf süreyi kısaltır", () => {
    const slow = analyzeIndependence(base);
    const fast = analyzeIndependence({ ...base, monthlySaving: d(6_000) });
    expect(fast.yearsToIndependence!).toBeLessThan(slow.yearsToIndependence!);
  });

  it("ne birikim ne getiri varsa ulaşılamaz", () => {
    const r = analyzeIndependence({
      ...base,
      monthlySaving: d(0),
      annualReturn: d(0),
    });
    expect(r.yearsToIndependence).toBeNull();
  });

  it("çok uzak hedef için null döner, sonsuz döngüye girmez", () => {
    const r = analyzeIndependence({
      ...base,
      currentNetWorth: d(1),
      monthlySaving: d(1),
      annualReturn: d(0),
      monthlyLivingCost: d(100_000),
    });
    expect(r.yearsToIndependence).toBeNull();
  });

  it("sıfır çekim oranında bölme hatası vermez", () => {
    const r = analyzeIndependence({ ...base, withdrawalRate: d(0) });
    expect(r.targetNetWorth.toFixed()).toBe("0");
  });
});
