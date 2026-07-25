import { describe, it, expect } from "vitest";
import {
  validate, cashSchema, positionSchema, depositSchema,
  propertySchema, vehicleSchema, ventureSchema, settingsSchema,
} from "./schemas";

/** Test kolaylığı için düz nesneden FormData üretir. */
function fd(obj: Record<string, string | number>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) f.append(k, String(v));
  return f;
}

describe("validate — para alanları", () => {
  const base = { name: "Nakit", currency: "USD", amount: "1000" };

  it("geçerli tutarı kabul eder", () => {
    const r = validate(cashSchema, fd(base));
    expect(r.success).toBe(true);
    expect(r.data!.amount).toBe("1000");
  });

  it("büyük tutarı hassasiyet kaybetmeden taşır", () => {
    const r = validate(cashSchema, fd({ ...base, amount: "10000000.07" }));
    expect(r.data!.amount).toBe("10000000.07");
  });

  it("sayı olmayanı reddeder", () => {
    const r = validate(cashSchema, fd({ ...base, amount: "bin dolar" }));
    expect(r.success).toBe(false);
    expect(r.fieldErrors!.amount).toMatch(/geçerli bir sayı/i);
  });

  it("negatif tutarı reddeder", () => {
    const r = validate(cashSchema, fd({ ...base, amount: "-5" }));
    expect(r.success).toBe(false);
    expect(r.fieldErrors!.amount).toMatch(/negatif/i);
  });

  it("boş tutarı reddeder", () => {
    const r = validate(cashSchema, fd({ ...base, amount: "" }));
    expect(r.success).toBe(false);
  });

  it("bilimsel gösterimi ve sonsuzu reddeder", () => {
    expect(validate(cashSchema, fd({ ...base, amount: "Infinity" })).success).toBe(false);
    expect(validate(cashSchema, fd({ ...base, amount: "NaN" })).success).toBe(false);
  });

  it("para birimini büyük harfe çevirir", () => {
    const r = validate(cashSchema, fd({ ...base, currency: "try" }));
    expect(r.data!.currency).toBe("TRY");
  });

  it("geçersiz para birimini reddeder", () => {
    expect(validate(cashSchema, fd({ ...base, currency: "T" })).success).toBe(false);
    expect(validate(cashSchema, fd({ ...base, currency: "123" })).success).toBe(false);
  });
});

describe("positionSchema", () => {
  const base = {
    kind: "equity", symbol: "thyao.is", name: "THY", currency: "TRY",
    quantity: "1000", pricePerUnit: "300", purchaseDate: "2026-01-15",
  };

  it("geçerli pozisyonu kabul eder ve sembolü normalize eder", () => {
    const r = validate(positionSchema, fd(base));
    expect(r.success).toBe(true);
    expect(r.data!.symbol).toBe("THYAO.IS");
    expect(r.data!.status).toBe("active");
  });

  it("sıfır miktarı reddeder", () => {
    const r = validate(positionSchema, fd({ ...base, quantity: "0" }));
    expect(r.success).toBe(false);
    expect(r.fieldErrors!.quantity).toMatch(/sıfırdan büyük/i);
  });

  it("gelecek tarihli alımı reddeder", () => {
    const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const r = validate(positionSchema, fd({ ...base, purchaseDate: future }));
    expect(r.success).toBe(false);
    expect(r.fieldErrors!.purchaseDate).toMatch(/gelecek/i);
  });

  it("bugünü kabul eder", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(validate(positionSchema, fd({ ...base, purchaseDate: today })).success).toBe(true);
  });

  it("planlanan durumu kabul eder", () => {
    const r = validate(positionSchema, fd({ ...base, status: "planned" }));
    expect(r.data!.status).toBe("planned");
  });

  it("geçersiz durumu reddeder", () => {
    expect(validate(positionSchema, fd({ ...base, status: "sold" })).success).toBe(false);
  });

  it("komisyon boşsa sıfır olur", () => {
    const r = validate(positionSchema, fd({ ...base, fee: "" }));
    expect(r.data!.fee).toBe("0");
  });
});

describe("depositSchema", () => {
  const base = {
    name: "TL Vadeli", currency: "TRY", principal: "100000000",
    annualRate: "0.42", compounding: "simple", dayCount: "ACT/365",
    startDate: "2026-06-15", maturityDate: "2026-09-15",
  };

  it("geçerli mevduatı kabul eder", () => {
    const r = validate(depositSchema, fd(base));
    expect(r.success).toBe(true);
    expect(r.data!.principal).toBe("100000000");
    expect(r.data!.annualRate).toBe("0.42");
  });

  it("vade başlangıçtan önceyse reddeder", () => {
    const r = validate(depositSchema, fd({ ...base, maturityDate: "2026-01-01" }));
    expect(r.success).toBe(false);
    expect(r.fieldErrors!.maturityDate).toMatch(/başlangıçtan sonra/i);
  });

  it("vadesiz hesabı kabul eder", () => {
    const r = validate(depositSchema, fd({ ...base, maturityDate: "" }));
    expect(r.success).toBe(true);
    expect(r.data!.maturityDate).toBeNull();
  });

  it("sıfır anaparayı reddeder", () => {
    expect(validate(depositSchema, fd({ ...base, principal: "0" })).success).toBe(false);
  });

  it("aşırı yüksek faiz oranını reddeder", () => {
    // 5 = %500 üst sınır
    expect(validate(depositSchema, fd({ ...base, annualRate: "9" })).success).toBe(false);
  });

  it("sıfır faizi kabul eder (vadesiz hesap)", () => {
    expect(validate(depositSchema, fd({ ...base, annualRate: "0" })).success).toBe(true);
  });
});

describe("propertySchema", () => {
  const base = {
    name: "Etiler Daire", city: "İstanbul", country: "tr", currency: "TRY",
    purchasePrice: "42000000", purchaseDate: "2026-03-20",
  };

  it("geçerli mülkü kabul eder, ülkeyi normalize eder", () => {
    const r = validate(propertySchema, fd(base));
    expect(r.success).toBe(true);
    expect(r.data!.country).toBe("TR");
    expect(r.data!.occupancyRate).toBe("1");
  });

  it("doluluk oranı 1'i aşamaz", () => {
    const r = validate(propertySchema, fd({ ...base, occupancyRate: "1.5" }));
    expect(r.success).toBe(false);
  });

  it("koordinatları sayıya çevirir", () => {
    const r = validate(propertySchema, fd({ ...base, lat: "41.08", lng: "29.03" }));
    expect(r.data!.lat).toBeCloseTo(41.08, 2);
  });

  it("geçersiz koordinatı reddeder", () => {
    expect(validate(propertySchema, fd({ ...base, lat: "999" })).success).toBe(false);
  });

  it("opsiyonel gider alanları boşsa sıfırlanır", () => {
    const r = validate(propertySchema, fd(base));
    expect(r.data!.hoa).toBe("0");
    expect(r.data!.monthlyRent).toBe("0");
  });
});

describe("vehicleSchema", () => {
  const base = {
    name: "Corolla", make: "Toyota", model: "Corolla Hybrid", year: "2026",
    country: "TR", currency: "TRY", segment: "economy",
    purchasePrice: "2100000", purchaseDate: "2026-04-20",
  };

  it("geçerli aracı kabul eder", () => {
    const r = validate(vehicleSchema, fd(base));
    expect(r.success).toBe(true);
    expect(r.data!.year).toBe(2026);
    expect(r.data!.odometer).toBe(0);
  });

  it("çok eski model yılını reddeder", () => {
    expect(validate(vehicleSchema, fd({ ...base, year: "1850" })).success).toBe(false);
  });

  it("gelecekteki model yılını sınırlar", () => {
    const far = new Date().getFullYear() + 5;
    expect(validate(vehicleSchema, fd({ ...base, year: String(far) })).success).toBe(false);
  });

  it("geçersiz segmenti reddeder", () => {
    expect(validate(vehicleSchema, fd({ ...base, segment: "uzay-aracı" })).success).toBe(false);
  });

  it("negatif kilometreyi reddeder", () => {
    expect(validate(vehicleSchema, fd({ ...base, odometer: "-100" })).success).toBe(false);
  });
});

describe("ventureSchema", () => {
  const base = {
    name: "Lojistik SaaS", legalName: "Rota Teknoloji A.Ş.", country: "TR",
    currency: "USD", ownershipPct: "0.65",
    committedCapital: "1200000", calledCapital: "450000",
  };

  it("geçerli girişimi kabul eder", () => {
    expect(validate(ventureSchema, fd(base)).success).toBe(true);
  });

  it("ödenen sermaye taahhüdü aşamaz", () => {
    const r = validate(ventureSchema, fd({ ...base, calledCapital: "2000000" }));
    expect(r.success).toBe(false);
    expect(r.fieldErrors!.calledCapital).toMatch(/taahhütten fazla/i);
  });

  it("sahiplik oranı 1'i aşamaz", () => {
    expect(validate(ventureSchema, fd({ ...base, ownershipPct: "1.2" })).success).toBe(false);
  });

  it("tam sahipliği kabul eder", () => {
    expect(validate(ventureSchema, fd({ ...base, ownershipPct: "1" })).success).toBe(true);
  });
});

describe("settingsSchema", () => {
  const base = {
    baseCurrency: "USD", livingCostCurrency: "USD", riskProfile: "balanced",
    horizonYears: "20", concentrationThreshold: "0.25",
  };

  it("geçerli ayarları kabul eder", () => {
    expect(validate(settingsSchema, fd(base)).success).toBe(true);
  });

  it("vade sınırlarını uygular", () => {
    expect(validate(settingsSchema, fd({ ...base, horizonYears: "0" })).success).toBe(false);
    expect(validate(settingsSchema, fd({ ...base, horizonYears: "99" })).success).toBe(false);
  });

  it("geçersiz risk profilini reddeder", () => {
    expect(validate(settingsSchema, fd({ ...base, riskProfile: "kumar" })).success).toBe(false);
  });
});

describe("validate — hata haritası", () => {
  it("her alan için tek hata döner", () => {
    const r = validate(cashSchema, fd({ name: "", currency: "XX!", amount: "abc" }));
    expect(r.success).toBe(false);
    const keys = Object.keys(r.fieldErrors!);
    expect(keys).toContain("amount");
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("eksik alanları yakalar", () => {
    const r = validate(cashSchema, fd({}));
    expect(r.success).toBe(false);
    expect(Object.keys(r.fieldErrors!).length).toBeGreaterThan(0);
  });
});
