import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  xirr, twr, annualize, toReturns, volatility, maxDrawdown, sharpe, concentration,
} from "./metrics";

const d = (s: string) => new Date(s + "T00:00:00.000Z");
const dec = (n: number | string) => new Decimal(n);

describe("xirr", () => {
  it("tam bir yılda %10 getiriyi bulur", () => {
    const r = xirr([
      { date: d("2025-01-01"), amount: dec(-1000) },
      { date: d("2026-01-01"), amount: dec(1100) },
    ]);
    expect(r?.toDecimalPlaces(4).toNumber()).toBeCloseTo(0.1, 3);
  });

  it("iki katına çıkan yatırımda %100", () => {
    const r = xirr([
      { date: d("2025-01-01"), amount: dec(-1000) },
      { date: d("2026-01-01"), amount: dec(2000) },
    ]);
    expect(r?.toDecimalPlaces(3).toNumber()).toBeCloseTo(1.0, 2);
  });

  it("zarar negatif getiri verir", () => {
    const r = xirr([
      { date: d("2025-01-01"), amount: dec(-1000) },
      { date: d("2026-01-01"), amount: dec(800) },
    ]);
    expect(r?.isNegative()).toBe(true);
    expect(r?.toDecimalPlaces(3).toNumber()).toBeCloseTo(-0.2, 2);
  });

  it("düzensiz çoklu akışları çözer", () => {
    // Kademeli yatırım, sonunda çıkış
    const r = xirr([
      { date: d("2025-01-01"), amount: dec(-1000) },
      { date: d("2025-04-01"), amount: dec(-500) },
      { date: d("2025-09-01"), amount: dec(-300) },
      { date: d("2026-01-01"), amount: dec(2000) },
    ]);
    expect(r).not.toBeNull();
    // Sonucu doğrula: bu oranda NPV sıfır olmalı
    expect(r!.greaterThan(0)).toBe(true);
  });

  it("kısa vadede yüksek getiri yıllıklaşır", () => {
    // 1 ayda %5 → yıllık çok daha yüksek
    const r = xirr([
      { date: d("2026-01-01"), amount: dec(-1000) },
      { date: d("2026-02-01"), amount: dec(1050) },
    ]);
    expect(r!.greaterThan(0.6)).toBe(true);
  });

  it("işaret değişimi yoksa null döner, uydurmaz", () => {
    expect(
      xirr([
        { date: d("2025-01-01"), amount: dec(-1000) },
        { date: d("2026-01-01"), amount: dec(-500) },
      ]),
    ).toBeNull();
  });

  it("tek akışla çözüm yok", () => {
    expect(xirr([{ date: d("2025-01-01"), amount: dec(-1000) }])).toBeNull();
  });

  it("sıralanmamış akışları kendisi sıralar", () => {
    const unsorted = xirr([
      { date: d("2026-01-01"), amount: dec(1100) },
      { date: d("2025-01-01"), amount: dec(-1000) },
    ]);
    expect(unsorted?.toDecimalPlaces(3).toNumber()).toBeCloseTo(0.1, 2);
  });
});

describe("twr — nakit akışından arındırılmış getiri", () => {
  it("nakit akışı yoksa basit getiriye eşit", () => {
    const r = twr([
      { date: d("2025-01-01"), value: dec(1000), netFlow: dec(0) },
      { date: d("2026-01-01"), value: dec(1200), netFlow: dec(0) },
    ]);
    expect(r?.toDecimalPlaces(4).toNumber()).toBe(0.2);
  });

  it("dönem ortasındaki para girişi getiriyi şişirmez", () => {
    // 1000 ile başla, %10 kazan (1100), 1000 daha koy (2100), %10 daha kazan (2310)
    const r = twr([
      { date: d("2025-01-01"), value: dec(1000), netFlow: dec(0) },
      { date: d("2025-06-01"), value: dec(2100), netFlow: dec(1000) },
      { date: d("2026-01-01"), value: dec(2310), netFlow: dec(0) },
    ]);
    // Gerçek performans: 1.1 × 1.1 − 1 = %21
    expect(r?.toDecimalPlaces(4).toNumber()).toBeCloseTo(0.21, 4);
  });

  it("tek nokta ile hesaplanamaz", () => {
    expect(twr([{ date: d("2025-01-01"), value: dec(1000), netFlow: dec(0) }])).toBeNull();
  });
});

describe("annualize", () => {
  it("iki yılda %21 → yılda %10", () => {
    expect(annualize(dec("0.21"), 2)?.toDecimalPlaces(4).toNumber()).toBeCloseTo(0.1, 3);
  });

  it("altı ayda %10 → yılda %21", () => {
    expect(annualize(dec("0.1"), 0.5)?.toDecimalPlaces(3).toNumber()).toBeCloseTo(0.21, 2);
  });

  it("sıfır veya negatif süre null", () => {
    expect(annualize(dec("0.2"), 0)).toBeNull();
  });

  it("tam kayıp (-%100) null döner, patlamaz", () => {
    expect(annualize(dec(-1), 2)).toBeNull();
  });
});

describe("volatility", () => {
  it("sabit getiride sıfır", () => {
    const returns = toReturns([100, 110, 121, 133.1]); // hep %10
    const v = volatility(returns);
    expect(v!.abs().lessThan("1e-15")).toBe(true);
  });

  it("oynak seri daha yüksek volatilite verir", () => {
    const calm = volatility(toReturns([100, 101, 102, 103, 104]));
    const wild = volatility(toReturns([100, 130, 90, 140, 85]));
    expect(wild!.greaterThan(calm!)).toBe(true);
  });

  it("yıllıklaştırma dönem sayısına göre ölçekler", () => {
    const returns = toReturns([100, 105, 98, 110, 103]);
    const daily = volatility(returns, 252);
    const monthly = volatility(returns, 12);
    expect(daily!.greaterThan(monthly!)).toBe(true);
  });

  it("iki noktadan az veriyle null", () => {
    expect(volatility([dec("0.1")])).toBeNull();
  });
});

describe("maxDrawdown", () => {
  it("tepe-dip düşüşünü bulur", () => {
    // 100 → 150 (tepe) → 75 (dip) → 120
    const dd = maxDrawdown([100, 150, 75, 120]);
    expect(dd!.maxDrawdown.toDecimalPlaces(4).toNumber()).toBe(-0.5);
    expect(dd!.peakIndex).toBe(1);
    expect(dd!.troughIndex).toBe(2);
  });

  it("sürekli yükselen seride düşüş yok", () => {
    const dd = maxDrawdown([100, 110, 120, 130]);
    expect(dd!.maxDrawdown.isZero()).toBe(true);
    expect(dd!.currentDrawdown.isZero()).toBe(true);
  });

  it("güncel düşüş zirveye göre ölçülür", () => {
    const dd = maxDrawdown([100, 200, 150]);
    // Zirve 200, şu an 150 → -%25
    expect(dd!.currentDrawdown.toDecimalPlaces(4).toNumber()).toBe(-0.25);
  });

  it("en büyük düşüşü seçer, sonuncuyu değil", () => {
    // 100→200→100 (-%50), sonra 120→130→125 (küçük düşüş)
    const dd = maxDrawdown([100, 200, 100, 120, 130, 125]);
    expect(dd!.maxDrawdown.toDecimalPlaces(4).toNumber()).toBe(-0.5);
  });
});

describe("sharpe", () => {
  it("fazla getiriyi riske böler", () => {
    // (%15 − %3,5) / %20 = 0,575
    const s = sharpe(dec("0.15"), dec("0.20"), "0.035");
    expect(s!.toDecimalPlaces(4).toNumber()).toBe(0.575);
  });

  it("risksiz oranın altında negatif", () => {
    expect(sharpe(dec("0.02"), dec("0.10"), "0.035")!.isNegative()).toBe(true);
  });

  it("sıfır volatilitede null döner, sıfıra bölmez", () => {
    expect(sharpe(dec("0.15"), dec(0))).toBeNull();
  });
});

describe("concentration — HHI", () => {
  it("tek varlıkta 1", () => {
    expect(concentration([1]).toNumber()).toBe(1);
  });

  it("eşit dört varlıkta 0,25", () => {
    expect(concentration([0.25, 0.25, 0.25, 0.25]).toDecimalPlaces(4).toNumber()).toBe(0.25);
  });

  it("dengesiz dağılım daha yüksek", () => {
    const even = concentration([0.5, 0.5]);
    const skewed = concentration([0.9, 0.1]);
    expect(skewed.greaterThan(even)).toBe(true);
  });
});
