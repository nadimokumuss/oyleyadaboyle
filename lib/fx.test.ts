import { describe, it, expect } from "vitest";
import { Money } from "./money";
import { FxConverter, attributeReturn, realReturn } from "./fx";

const rates = { TRY: "42.5", EUR: "0.92", GBP: "0.79", AED: "3.6725" };

describe("FxConverter", () => {
  const fx = new FxConverter(rates);

  it("USD tabanı her zaman 1", () => {
    expect(fx.rate("USD", "USD").toFixed()).toBe("1");
    expect(fx.convert(Money.of(100, "USD"), "USD").toDb()).toBe("100");
  });

  it("USD'den çevirir", () => {
    expect(fx.convert(Money.of(100, "USD"), "TRY").toDb()).toBe("4250");
  });

  it("USD'ye çevirir", () => {
    expect(fx.convert(Money.of(4250, "TRY"), "USD").toDb()).toBe("100");
  });

  it("çapraz kur USD üzerinden köprülenir", () => {
    // 1 EUR = (1/0.92) USD = 42.5/0.92 TRY
    const eurToTry = fx.rate("EUR", "TRY");
    expect(eurToTry.toDecimalPlaces(6).toFixed()).toBe(
      (42.5 / 0.92).toFixed(6),
    );
  });

  it("gidiş dönüş çevirimi başlangıca döner", () => {
    const original = Money.of("1234.56", "TRY");
    const roundTrip = fx.convert(fx.convert(original, "USD"), "TRY");
    expect(roundTrip.round(2).toDb()).toBe("1234.56");
  });

  it("karışık para birimlerini USD'de toplar", () => {
    const total = fx.sumIn([
      Money.of(100, "USD"),
      Money.of(4250, "TRY"), // = 100 USD
      Money.of("0.92", "EUR"), // = 1 USD
    ]);
    expect(total.round(2).toDb()).toBe("201");
  });

  it("bilinmeyen kuru sessizce geçmez, hata verir", () => {
    expect(() => fx.rate("USD", "XYZ")).toThrow(/Kur bulunamadı/);
  });

  it("geçersiz kuru kabul etmez", () => {
    expect(() => new FxConverter({ TRY: "0" })).toThrow(/Geçersiz kur/);
    expect(() => new FxConverter({ TRY: "-1" })).toThrow(/Geçersiz kur/);
  });
});

describe("attributeReturn — kur kârı vs fiyat kârı", () => {
  it("TL'de değerlenen ev USD'de kaybettirebilir", () => {
    // 10M TL'ye alınan ev 13M TL oldu (+%30).
    // Ama USD/TRY 30'dan 45'e çıktı → 1 TL, 1/30 USD'den 1/45 USD'ye düştü.
    const a = attributeReturn(
      Money.of(10_000_000, "TRY"),
      Money.of(13_000_000, "TRY"),
      1 / 30,
      1 / 45,
    );

    expect(a.priceReturn.toDecimalPlaces(4).toNumber()).toBe(0.3);
    // kur getirisi = (1/45)/(1/30) - 1 = 30/45 - 1 = -1/3
    expect(a.fxReturn.toDecimalPlaces(4).toNumber()).toBe(-0.3333);
    // toplam = 1.3 * (2/3) - 1 = -0.1333
    expect(a.totalReturn.toDecimalPlaces(4).toNumber()).toBe(-0.1333);
    // TL'de kazandı, USD'de kaybetti
    expect(a.priceReturn.isPositive()).toBe(true);
    expect(a.totalReturn.isNegative()).toBe(true);
  });

  it("bileşenler toplamı toplam getiriyi verir", () => {
    const a = attributeReturn(Money.of(100, "TRY"), Money.of(130, "TRY"), 0.03, 0.02);
    const recomposed = a.priceReturn.plus(a.fxReturn).plus(a.crossTerm);
    expect(recomposed.minus(a.totalReturn).abs().lessThan("1e-20")).toBe(true);
  });

  it("kur sabitse getiri sadece fiyattan gelir", () => {
    const a = attributeReturn(Money.of(100, "EUR"), Money.of(150, "EUR"), 1.1, 1.1);
    expect(a.fxReturn.isZero()).toBe(true);
    expect(a.crossTerm.isZero()).toBe(true);
    expect(a.totalReturn.toDecimalPlaces(10).toNumber()).toBe(0.5);
  });

  it("çapraz terim büyük hareketlerde ihmal edilemez", () => {
    // +%50 fiyat, +%50 kur → çapraz terim %25, toplamın önemli parçası
    const a = attributeReturn(Money.of(100, "TRY"), Money.of(150, "TRY"), 1, 1.5);
    expect(a.crossTerm.toDecimalPlaces(4).toNumber()).toBe(0.25);
    expect(a.totalReturn.toDecimalPlaces(4).toNumber()).toBe(1.25);
  });

  it("sıfır maliyet ve para birimi çelişkisi hata verir", () => {
    expect(() =>
      attributeReturn(Money.zero("TRY"), Money.of(1, "TRY"), 1, 1),
    ).toThrow(/sıfır maliyet/);
    expect(() =>
      attributeReturn(Money.of(1, "TRY"), Money.of(1, "USD"), 1, 1),
    ).toThrow(/aynı para biriminde/);
  });
});

describe("realReturn — Fisher denklemi", () => {
  it("basit çıkarmadan farklı ve doğru sonuç verir", () => {
    // %45 nominal, %38 enflasyon
    const real = realReturn("0.45", "0.38");
    // (1.45/1.38) - 1 = 0.050724...
    expect(real.toDecimalPlaces(4).toNumber()).toBe(0.0507);
    // Basit çıkarma 0.07 derdi — %38 sapma
    expect(real.toNumber()).not.toBeCloseTo(0.07, 3);
  });

  it("enflasyon nominali geçerse reel getiri negatif", () => {
    expect(realReturn("0.30", "0.50").isNegative()).toBe(true);
  });

  it("enflasyon sıfırsa reel = nominal", () => {
    expect(realReturn("0.12", "0").toDecimalPlaces(10).toNumber()).toBe(0.12);
  });

  it("-%100 enflasyon reddedilir", () => {
    expect(() => realReturn("0.1", "-1")).toThrow(/enflasyon/i);
  });
});
