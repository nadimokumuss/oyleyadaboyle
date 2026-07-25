import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { Money } from "@/lib/money";
import { computeVentureMetrics, dilutedOwnership, cashProjection, type VentureInput } from "./venture";
import { summarize, projectCash, type FlowItem } from "./cashflow";

const usd = (n: string | number) => Money.of(n, "USD");

function venture(over: Partial<VentureInput> = {}): VentureInput {
  return {
    ownershipPct: new Decimal("0.65"),
    committedCapital: usd(1_200_000),
    calledCapital: usd(450_000),
    valuation: usd(4_000_000),
    monthlyRevenue: usd(38_000),
    monthlyBurn: usd(95_000),
    cashOnHand: usd(380_000),
    ...over,
  };
}

describe("computeVentureMetrics — runway", () => {
  it("net yakım gelirden düşülür", () => {
    const m = computeVentureMetrics(venture());
    // 95.000 − 38.000 = 57.000
    expect(m.netMonthlyBurn.toDb()).toBe("57000");
  });

  it("runway nakit / net yakım", () => {
    const m = computeVentureMetrics(venture());
    // 380.000 / 57.000 = 6,666 ay
    expect(m.runwayMonths!.toDecimalPlaces(2).toNumber()).toBe(6.67);
    expect(m.alert).toBe("ok");
  });

  it("6 aydan az runway uyarı verir", () => {
    const m = computeVentureMetrics(venture({ cashOnHand: usd(250_000) }));
    expect(m.runwayMonths!.lessThan(6)).toBe(true);
    expect(m.alert).toBe("warning");
  });

  it("3 aydan az runway kritik", () => {
    const m = computeVentureMetrics(venture({ cashOnHand: usd(100_000) }));
    expect(m.alert).toBe("critical");
  });

  it("kâr eden girişimde runway sonsuz", () => {
    const m = computeVentureMetrics(venture({ monthlyRevenue: usd(120_000) }));
    expect(m.profitable).toBe(true);
    expect(m.runwayMonths).toBeNull();
    expect(m.runwayEndsAt).toBeNull();
    expect(m.alert).toBe("ok");
  });

  it("runway bitiş tarihi hesaplanır", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const m = computeVentureMetrics(venture(), now);
    expect(m.runwayEndsAt!.getTime()).toBeGreaterThan(now.getTime());
    // ~6,7 ay sonrası
    const months = (m.runwayEndsAt!.getTime() - now.getTime()) / (30.436875 * 86400000);
    expect(months).toBeCloseTo(6.67, 1);
  });
});

describe("computeVentureMetrics — değerleme", () => {
  it("pozisyon değeri sahiplik payı kadar", () => {
    const m = computeVentureMetrics(venture());
    // 4.000.000 × 0,65 = 2.600.000
    expect(m.positionValue.toDb()).toBe("2600000");
  });

  it("MOIC ödenen sermayeye göre", () => {
    const m = computeVentureMetrics(venture());
    // 2.600.000 / 450.000 = 5,78x
    expect(m.moic!.toDecimalPlaces(2).toNumber()).toBe(5.78);
  });

  it("değerleme yoksa ödenen sermaye gösterilir", () => {
    const m = computeVentureMetrics(venture({ valuation: null }));
    expect(m.positionValue.toDb()).toBe("450000");
    expect(m.moic!.toNumber()).toBe(1);
  });

  it("ödenmemiş taahhüt hesaplanır", () => {
    const m = computeVentureMetrics(venture());
    expect(m.uncalledCapital.toDb()).toBe("750000");
  });

  it("sermaye ödenmemişse MOIC null — sıfıra bölmez", () => {
    const m = computeVentureMetrics(venture({ calledCapital: usd(0) }));
    expect(m.moic).toBeNull();
  });
});

describe("computeVentureMetrics — başabaş", () => {
  it("başabaş ilerlemesi gelir/gider oranı", () => {
    const m = computeVentureMetrics(venture());
    // 38.000 / 95.000 = %40
    expect(m.breakevenProgress!.toDecimalPlaces(3).toNumber()).toBe(0.4);
    expect(m.breakevenRevenue.toDb()).toBe("95000");
  });

  it("başabaşa ulaşıldığında oran 1'i geçer", () => {
    const m = computeVentureMetrics(venture({ monthlyRevenue: usd(100_000) }));
    expect(m.breakevenProgress!.greaterThan(1)).toBe(true);
  });
});

describe("computeVentureMetrics — IRR", () => {
  it("nakit akışlarından IRR hesaplar", () => {
    const m = computeVentureMetrics(
      venture({
        cashFlows: [
          { date: new Date("2025-01-01"), amount: new Decimal(-450_000) },
        ],
      }),
      new Date("2026-01-01"),
    );
    // 450K → 2,6M bir yılda, çok yüksek IRR
    expect(m.irr!.greaterThan(4)).toBe(true);
  });

  it("nakit akışı verilmezse IRR null", () => {
    expect(computeVentureMetrics(venture()).irr).toBeNull();
  });
});

describe("dilutedOwnership", () => {
  it("yeni tur payı seyreltir", () => {
    // %65 pay, 4M pre-money, 1M yeni yatırım → 5M post
    const newPct = dilutedOwnership("0.65", usd(4_000_000), usd(1_000_000));
    // 0,65 × 4/5 = 0,52
    expect(newPct.toDecimalPlaces(4).toNumber()).toBe(0.52);
  });

  it("yatırım yoksa seyrelme yok", () => {
    expect(
      dilutedOwnership("0.65", usd(4_000_000), usd(0)).toDecimalPlaces(4).toNumber(),
    ).toBe(0.65);
  });
});

describe("cashProjection", () => {
  it("nakit tükenene kadar projeksiyon üretir", () => {
    const proj = cashProjection(usd(100_000), usd(30_000), 18);
    expect(proj[0].cash).toBe("100000");
    // 4. ayda negatife düşer → sıfırla biter
    expect(proj[proj.length - 1].cash).toBe("0");
    expect(proj.length).toBeLessThan(19);
  });

  it("kâr eden girişimde nakit büyür", () => {
    const proj = cashProjection(usd(100_000), usd(-10_000), 6);
    expect(Number(proj[6].cash)).toBeGreaterThan(100_000);
  });
});

/* ------------------------------------------------------------------ */

describe("cashflow — pasif gelir kapsama oranı", () => {
  const incomes: FlowItem[] = [
    { label: "Mevduat faizi", monthlyUsd: usd(4_000), source: "interest", passive: true },
    { label: "Kira", monthlyUsd: usd(3_000), source: "rent", passive: true },
    { label: "Temettü", monthlyUsd: usd(500), source: "dividend", passive: true },
  ];
  const expenses: FlowItem[] = [
    { label: "Yaşam", monthlyUsd: usd(8_000), category: "living" },
    { label: "Aidat", monthlyUsd: usd(600), category: "property" },
  ];

  it("toplamları doğru hesaplar", () => {
    const s = summarize(incomes, expenses, usd(8_000));
    expect(s.totalMonthlyIncome.toDb()).toBe("7500");
    expect(s.totalMonthlyExpense.toDb()).toBe("8600");
    expect(s.netMonthly.toDb()).toBe("-1100");
  });

  it("kapsama oranı pasif gelir / yaşam gideri", () => {
    const s = summarize(incomes, expenses, usd(8_000));
    // 7.500 / 8.000 = %93,75
    expect(s.coverageRatio!.toDecimalPlaces(4).toNumber()).toBe(0.9375);
    expect(s.financiallyIndependent).toBe(false);
    expect(s.gapToIndependence!.toDb()).toBe("500");
  });

  it("kapsama %100'ü geçince bağımsızlık", () => {
    const s = summarize(incomes, expenses, usd(7_000));
    expect(s.financiallyIndependent).toBe(true);
    expect(s.gapToIndependence).toBeNull();
  });

  it("aktif gelir kapsama oranına sayılmaz", () => {
    const withActive = [
      ...incomes,
      { label: "Danışmanlık", monthlyUsd: usd(5_000), passive: false },
    ];
    const s = summarize(withActive, expenses, usd(8_000));
    expect(s.totalMonthlyIncome.toDb()).toBe("12500");
    // Pasif gelir değişmedi
    expect(s.passiveMonthlyIncome.toDb()).toBe("7500");
    expect(s.financiallyIndependent).toBe(false);
  });

  it("yaşam gideri girilmemişse oran null — sıfıra bölmez", () => {
    const s = summarize(incomes, expenses, usd(0));
    expect(s.coverageRatio).toBeNull();
    expect(s.financiallyIndependent).toBe(false);
  });

  it("gelir kaynağına göre gruplar", () => {
    const s = summarize(incomes, expenses, usd(8_000));
    expect(s.byIncomeSource.interest).toBe("4000");
    expect(s.byIncomeSource.rent).toBe("3000");
    expect(s.byExpenseCategory.living).toBe("8000");
  });

  it("kalemler büyükten küçüğe sıralanır", () => {
    const s = summarize(incomes, expenses, usd(8_000));
    expect(s.incomes[0].label).toBe("Mevduat faizi");
    expect(s.incomes[2].label).toBe("Temettü");
  });
});

describe("projectCash", () => {
  it("net akışı birikimli ekler", () => {
    const proj = projectCash(usd(10_000), usd(2_000), 3);
    expect(proj.map((p) => p.cash)).toEqual(["10000", "12000", "14000", "16000"]);
  });

  it("negatif akışta azalır", () => {
    const proj = projectCash(usd(10_000), usd(-3_000), 2);
    expect(proj[2].cash).toBe("4000");
  });
});
