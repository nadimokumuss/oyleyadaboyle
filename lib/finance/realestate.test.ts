import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { Money } from "@/lib/money";
import { indexValueAt, valueProperty, estimateForegoneRent, type PropertyInput } from "./realestate";
import { valueVehicle, depreciationCurve, idleVehicleCost, DEFAULT_MILEAGE, type VehicleInput } from "./vehicle";

const d = (s: string) => new Date(s + "T00:00:00.000Z");

const series = { "2025-01": 1000, "2026-01": 1200, "2026-07": 1300 };

describe("indexValueAt", () => {
  it("tam eşleşmede noktayı döner", () => {
    expect(indexValueAt(series, d("2026-01-01"))!.toNumber()).toBe(1200);
  });

  it("ara tarihlerde doğrusal interpolasyon", () => {
    // 2025-07 tam ortada: (1000+1200)/2 = 1100
    const v = indexValueAt(series, d("2025-07-02"));
    expect(v!.toDecimalPlaces(0).toNumber()).toBe(1100);
  });

  it("seri başından önce ilk değere sabitlenir", () => {
    expect(indexValueAt(series, d("2020-01-01"))!.toNumber()).toBe(1000);
  });

  it("seri sonrasında son değere sabitlenir — trend uydurmaz", () => {
    expect(indexValueAt(series, d("2030-01-01"))!.toNumber()).toBe(1300);
  });

  it("boş seri null döner", () => {
    expect(indexValueAt({}, d("2026-01-01"))).toBeNull();
  });
});

function property(over: Partial<PropertyInput> = {}): PropertyInput {
  return {
    purchasePrice: Money.of("1000000", "TRY"),
    purchaseDate: d("2025-01-01"),
    closingCosts: Money.of("40000", "TRY"),
    renovationCost: Money.zero("TRY"),
    manualValue: null,
    manualValueDate: null,
    monthlyRent: Money.of("5000", "TRY"),
    occupancyRate: new Decimal("1"),
    monthlyCosts: Money.of("1000", "TRY"),
    indexSeries: series,
    ...over,
  };
}

describe("valueProperty — endeks değerleme", () => {
  it("endeks oranında değerlenir", () => {
    const v = valueProperty(property(), d("2026-01-01"));
    // Endeks 1000 → 1200, yani +%20
    expect(v.currentValue.toDb()).toBe("1200000");
    expect(v.basis).toBe("model");
    expect(v.indexGrowth!.toDecimalPlaces(4).toNumber()).toBe(0.2);
  });

  it("gerçek maliyet tapu ve tadilatı içerir", () => {
    const v = valueProperty(
      property({ renovationCost: Money.of("60000", "TRY") }),
      d("2026-01-01"),
    );
    expect(v.totalCost.toDb()).toBe("1100000");
    // Kazanç maliyete göre ölçülür, alış fiyatına göre değil
    expect(v.capitalGain.toDb()).toBe("100000");
  });

  it("elle girilen ekspertiz çapa olur", () => {
    const v = valueProperty(
      property({
        manualValue: Money.of("1500000", "TRY"),
        manualValueDate: d("2026-01-01"),
      }),
      d("2026-07-01"),
    );
    // Ekspertiz 1.5M, endeks 1200→1300 (+%8,33) → 1.625.000
    expect(v.basis).toBe("manual");
    expect(v.currentValue.round(0).toDb()).toBe("1625000");
  });

  it("endeks yoksa maliyet değeri gösterilir", () => {
    const v = valueProperty(property({ indexSeries: null }), d("2026-01-01"));
    expect(v.basis).toBe("cost");
    expect(v.currentValue.toDb()).toBe("1000000");
  });
});

describe("valueProperty — kira verimi", () => {
  it("net verim giderleri düşer", () => {
    const v = valueProperty(property(), d("2026-01-01"));
    // Brüt yıllık kira 60.000, gider 12.000 → net 48.000
    expect(v.annualGrossRent.toDb()).toBe("60000");
    expect(v.annualNetRent.toDb()).toBe("48000");
    // Değer 1.2M → net verim %4
    expect(v.netYield!.toDecimalPlaces(4).toNumber()).toBe(0.04);
    expect(v.grossYield!.toDecimalPlaces(4).toNumber()).toBe(0.05);
  });

  it("doluluk oranı brüt kirayı azaltır", () => {
    const v = valueProperty(
      property({ occupancyRate: new Decimal("0.5") }),
      d("2026-01-01"),
    );
    expect(v.annualGrossRent.toDb()).toBe("30000");
  });

  it("maliyete göre verim güncel değerden farklıdır", () => {
    const v = valueProperty(property(), d("2026-01-01"));
    // Değer yükseldiği için maliyete göre verim daha yüksek
    expect(v.yieldOnCost!.greaterThan(v.netYield!)).toBe(true);
  });

  it("gider kirayı aşarsa net verim negatif", () => {
    const v = valueProperty(
      property({ monthlyCosts: Money.of("9000", "TRY") }),
      d("2026-01-01"),
    );
    expect(v.netYield!.isNegative()).toBe(true);
  });
});

describe("estimateForegoneRent", () => {
  it("boş konutun kaçırdığı aylık geliri tahmin eder", () => {
    const r = estimateForegoneRent(Money.of("1200000", "TRY"), "0.05");
    // 1.2M × %5 / 12 = 5000
    expect(r.toDb()).toBe("5000");
  });
});

/* ------------------------------------------------------------------ */

const luxury = { label: "Lüks", lambda: 0.22, residualFloor: 0.18 };
const classic = { label: "Klasik", lambda: -0.03, residualFloor: 1.0 };

function vehicle(over: Partial<VehicleInput> = {}): VehicleInput {
  return {
    purchasePrice: Money.of("1000000", "TRY"),
    purchaseDate: d("2025-01-01"),
    modelYear: 2025,
    odometer: 15000,
    curve: luxury,
    mileage: DEFAULT_MILEAGE,
    manualValue: null,
    manualValueDate: null,
    annualCosts: Money.of("50000", "TRY"),
    ...over,
  };
}

describe("valueVehicle — amortisman", () => {
  it("bir yılda üstel eğriye göre düşer", () => {
    const v = valueVehicle(vehicle(), d("2026-01-01"));
    // e^(-0.22 × ~1) ≈ 0.8026 → yaklaşık 802.600
    expect(v.currentValue.toNumber()).toBeCloseTo(802_600, -2);
    expect(v.basis).toBe("model");
  });

  it("lüks araç ekonomikten hızlı düşer", () => {
    const lux = valueVehicle(vehicle({ curve: luxury }), d("2026-01-01"));
    const eco = valueVehicle(
      vehicle({ curve: { label: "Ekonomik", lambda: 0.12, residualFloor: 0.12 } }),
      d("2026-01-01"),
    );
    expect(eco.currentValue.gt(lux.currentValue)).toBe(true);
  });

  it("klasik araç değer kazanır", () => {
    const v = valueVehicle(vehicle({ curve: classic }), d("2026-01-01"));
    expect(v.currentValue.gt(Money.of("1000000", "TRY"))).toBe(true);
    expect(v.depreciation.isNegative()).toBe(true);
  });

  it("değer taban oranın altına inmez", () => {
    const v = valueVehicle(vehicle(), d("2060-01-01"));
    // 35 yıl sonra bile taban %18
    expect(v.currentValue.toDb()).toBe("180000");
  });

  it("fazla km değeri düşürür", () => {
    const normal = valueVehicle(vehicle({ odometer: 15000 }), d("2026-01-01"));
    const highKm = valueVehicle(vehicle({ odometer: 75000 }), d("2026-01-01"));
    expect(highKm.currentValue.lt(normal.currentValue)).toBe(true);
    expect(highKm.mileagePenalty.greaterThan(0)).toBe(true);
  });

  it("km cezası tavanı aşmaz", () => {
    const v = valueVehicle(vehicle({ odometer: 5_000_000 }), d("2026-01-01"));
    expect(v.mileagePenalty.toNumber()).toBe(0.35);
  });

  it("elle girilen değer modeli ezer", () => {
    const v = valueVehicle(
      vehicle({ manualValue: Money.of("900000", "TRY") }),
      d("2026-01-01"),
    );
    expect(v.basis).toBe("manual");
    expect(v.currentValue.toDb()).toBe("900000");
  });

  it("satın alma anında değer kaybı yok", () => {
    const v = valueVehicle(vehicle(), d("2025-01-01"));
    expect(v.currentValue.round(0).toDb()).toBe("1000000");
    expect(v.ageYears.toNumber()).toBeCloseTo(0, 5);
  });

  it("ikinci el alınan araç alış anında cezalandırılmaz", () => {
    // 2020 model, 2026'da 90.000 km'de alınmış bir araç
    const used = vehicle({
      modelYear: 2020,
      purchaseDate: d("2026-01-01"),
      odometer: 90000,
      purchasePrice: Money.of("400000", "TRY"),
    });
    const v = valueVehicle(used, d("2026-01-01"));
    // Alış anında değer tam olarak alış fiyatına eşit olmalı
    expect(v.currentValue.round(0).toDb()).toBe("400000");
    expect(v.depreciation.round(0).toDb()).toBe("0");
  });

  it("aracın kendi yaşı sahip olma süresinden ayrı takip edilir", () => {
    const used = vehicle({ modelYear: 2020, purchaseDate: d("2026-01-01") });
    const v = valueVehicle(used, d("2026-07-01"));
    expect(v.ageYears.toNumber()).toBeLessThan(1);
    expect(v.vehicleAgeYears.toNumber()).toBeGreaterThan(6);
  });
});

describe("valueVehicle — sahip olma maliyeti", () => {
  it("değer kaybı ve taşıma gideri ayrı ayrı toplanır", () => {
    const v = valueVehicle(vehicle(), d("2026-01-01"));
    // Değer kaybı ~197.400 + yaklaşık bir yıllık gider (~50.000)
    expect(v.depreciation.toNumber()).toBeCloseTo(197_400, -2);
    expect(v.carryingCostToDate.toNumber()).toBeCloseTo(49_970, -2);
    // İkisinin toplamı aracın gerçek maliyetidir
    expect(v.totalCostOfOwnership.toNumber()).toBeCloseTo(
      v.depreciation.toNumber() + v.carryingCostToDate.toNumber(),
      6,
    );
  });

  it("aylık gerçek maliyet hesaplanır", () => {
    const v = valueVehicle(vehicle(), d("2026-01-01"));
    // ~247.400 / ~12 ay ≈ 20.620
    expect(v.monthlyCostOfOwnership!.toNumber()).toBeCloseTo(20_620, -2);
  });

  it("çok yeni araçta aylık maliyet null — sıfıra bölmez", () => {
    const v = valueVehicle(vehicle(), d("2025-01-02"));
    expect(v.monthlyCostOfOwnership).toBeNull();
  });
});

describe("depreciationCurve", () => {
  it("her yıl için nokta üretir", () => {
    const curve = depreciationCurve(vehicle(), 5);
    expect(curve).toHaveLength(6); // 0..5
    expect(curve[0].value).toBe("1000000");
  });

  it("eğri monoton azalır", () => {
    const curve = depreciationCurve(vehicle(), 5);
    for (let i = 1; i < curve.length; i++) {
      expect(Number(curve[i].value)).toBeLessThan(Number(curve[i - 1].value));
    }
  });
});

describe("idleVehicleCost", () => {
  it("kullanılmayan aracın aylık yükünü verir", () => {
    const cost = idleVehicleCost(vehicle(), d("2026-01-01"));
    // Bir sonraki yıl değer kaybı + yıllık gider, 12'ye bölünmüş
    expect(cost.isPositive()).toBe(true);
    expect(cost.round(0).toNumber()).toBeGreaterThan(4000);
  });
});
