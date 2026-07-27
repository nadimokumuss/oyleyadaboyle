import { describe, it, expect } from "vitest";
import {
  alignSeries,
  normalize,
  compareToBenchmark,
  type SeriesPoint,
} from "./benchmark";

const s = (pairs: Array<[string, number]>): SeriesPoint[] =>
  pairs.map(([date, value]) => ({ date, value }));

describe("alignSeries", () => {
  it("yalnızca ortak tarihleri tutar", () => {
    const a = s([["2026-01-01", 1], ["2026-01-02", 2], ["2026-01-03", 3]]);
    const b = s([["2026-01-02", 20], ["2026-01-03", 30], ["2026-01-04", 40]]);
    const out = alignSeries(a, b);

    expect(out.a.map((p) => p.date)).toEqual(["2026-01-02", "2026-01-03"]);
    expect(out.b.map((p) => p.value)).toEqual([20, 30]);
  });

  it("hafta sonu boşlukları hizalamayı kaydırmaz", () => {
    // Servet eğrisi her gün, endeks yalnızca iş günleri.
    const wealth = s([
      ["2026-01-02", 100], ["2026-01-03", 101], ["2026-01-04", 102], ["2026-01-05", 103],
    ]);
    const index = s([["2026-01-02", 50], ["2026-01-05", 55]]);
    const out = alignSeries(wealth, index);

    expect(out.a).toHaveLength(2);
    expect(out.a[1].value).toBe(103);
    expect(out.b[1].value).toBe(55);
  });

  it("kesişim yoksa boş döner", () => {
    const out = alignSeries(s([["2026-01-01", 1]]), s([["2026-02-01", 2]]));
    expect(out.a).toHaveLength(0);
  });
});

describe("normalize", () => {
  it("başlangıcı 100 yapar", () => {
    const out = normalize(s([["2026-01-01", 50], ["2026-01-02", 75]]));
    expect(out[0].value).toBe(100);
    expect(out[1].value).toBe(150);
  });

  it("düşüşü doğru ölçekler", () => {
    const out = normalize(s([["2026-01-01", 200], ["2026-01-02", 150]]));
    expect(out[1].value).toBe(75);
  });

  it("boş seride çökmez", () => {
    expect(normalize([])).toEqual([]);
  });

  it("sıfır başlangıçta bölme hatası vermez", () => {
    const out = normalize(s([["2026-01-01", 0], ["2026-01-02", 10]]));
    expect(out.every((p) => p.value === 0)).toBe(true);
  });
});

describe("compareToBenchmark", () => {
  it("iki noktadan az veride null döner", () => {
    expect(compareToBenchmark(s([["2026-01-01", 100]]), s([["2026-01-01", 50]]))).toBeNull();
    expect(compareToBenchmark([], [])).toBeNull();
  });

  it("getirileri ve farkı hesaplar", () => {
    const portfolio = s([["2026-01-01", 1000], ["2026-12-31", 1200]]); // %20
    const index = s([["2026-01-01", 100], ["2026-12-31", 110]]); // %10
    const c = compareToBenchmark(portfolio, index)!;

    expect(c.portfolioReturn.toFixed(4)).toBe("0.2000");
    expect(c.benchmarkReturn.toFixed(4)).toBe("0.1000");
    expect(c.excessReturn.toFixed(4)).toBe("0.1000");
  });

  it("endeksin altında kalınca fark negatif", () => {
    const c = compareToBenchmark(
      s([["2026-01-01", 1000], ["2026-12-31", 1050]]),
      s([["2026-01-01", 100], ["2026-12-31", 130]]),
    )!;
    expect(c.excessReturn.isNegative()).toBe(true);
  });

  it("karşı-olgusal değer aynı parayı endekse koymayı gösterir", () => {
    const c = compareToBenchmark(
      s([["2026-01-01", 1000], ["2026-12-31", 1200]]),
      s([["2026-01-01", 100], ["2026-12-31", 110]]),
    )!;
    // 1000 endekste %10 yapsaydı 1100 olurdu; gerçekte 1200.
    expect(c.counterfactualValue.toFixed(2)).toBe("1100.00");
    expect(c.actualValue.toFixed(2)).toBe("1200.00");
  });

  it("seriler normalize edilmiş döner", () => {
    const c = compareToBenchmark(
      s([["2026-01-01", 1000], ["2026-12-31", 1200]]),
      s([["2026-01-01", 100], ["2026-12-31", 110]]),
    )!;
    expect(c.portfolio[0].value).toBe(100);
    expect(c.benchmark[0].value).toBe(100);
    expect(c.portfolio[1].value).toBeCloseTo(120, 6);
    expect(c.benchmark[1].value).toBeCloseTo(110, 6);
  });

  it("gün sayısını hesaplar", () => {
    const c = compareToBenchmark(
      s([["2026-01-01", 100], ["2026-01-31", 110]]),
      s([["2026-01-01", 100], ["2026-01-31", 105]]),
    )!;
    expect(c.days).toBe(30);
  });

  it("hizalanmayan tarihler sonucu bozmaz", () => {
    // Endekste olmayan bir gün portföyde varsa yok sayılır.
    const c = compareToBenchmark(
      s([["2026-01-01", 1000], ["2026-06-15", 5000], ["2026-12-31", 1200]]),
      s([["2026-01-01", 100], ["2026-12-31", 110]]),
    )!;
    expect(c.portfolioReturn.toFixed(4)).toBe("0.2000");
  });
});
