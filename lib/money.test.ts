import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  Money,
  sumMoney,
  formatMoney,
  formatPercent,
  formatQuantity,
  toDecimal,
} from "./money";

describe("Money — float tuzakları", () => {
  it("0.1 + 0.2 tam olarak 0.3 eder", () => {
    const a = Money.of("0.1", "USD");
    const b = Money.of("0.2", "USD");
    expect(a.plus(b).toDb()).toBe("0.3");
    // float olsaydı: 0.30000000000000004
    expect(a.plus(b).amount.equals(new Decimal("0.3"))).toBe(true);
  });

  it("10 milyon doları kuruşuna kadar taşır", () => {
    const m = Money.of("10000000.07", "USD");
    expect(m.times(3).toDb()).toBe("30000000.21");
  });

  it("küçük tutarların tekrarlı toplamı sapmaz", () => {
    let acc = Money.zero("USD");
    for (let i = 0; i < 1000; i++) acc = acc.plus(Money.of("0.01", "USD"));
    expect(acc.toDb()).toBe("10");
  });
});

describe("Money — para birimi güvenliği", () => {
  it("farklı para birimleri toplanamaz", () => {
    const usd = Money.of(100, "USD");
    const tryy = Money.of(100, "TRY");
    expect(() => usd.plus(tryy)).toThrow(/farklı para birimleri/);
  });

  it("para birimi büyük harfe normalize edilir", () => {
    expect(Money.of(1, "usd").currency).toBe("USD");
    expect(Money.of(1, "usd").plus(Money.of(1, "USD")).toDb()).toBe("2");
  });

  it("sıfıra bölme engellenir", () => {
    expect(() => Money.of(100, "USD").dividedBy(0)).toThrow(/sıfıra bölme/);
  });
});

describe("Money — dönüşüm ve karşılaştırma", () => {
  it("fromDb boş değerleri sıfır sayar", () => {
    expect(Money.fromDb(null, "USD").isZero()).toBe(true);
    expect(Money.fromDb("", "USD").isZero()).toBe(true);
    expect(Money.fromDb("42.5", "USD").toDb()).toBe("42.5");
  });

  it("toDb → fromDb gidiş dönüşü kayıpsız", () => {
    const original = Money.of("1234567.89012345", "USD");
    expect(Money.fromDb(original.toDb(), "USD").eq(original)).toBe(true);
  });

  it("işaret kontrolleri sıfırı negatif saymaz", () => {
    expect(Money.zero("USD").isNegative()).toBe(false);
    expect(Money.of(-1, "USD").isNegative()).toBe(true);
  });

  it("banker yuvarlaması kullanılır", () => {
    // ROUND_HALF_EVEN: 0.125 → 0.12, 0.135 → 0.14
    expect(Money.of("0.125", "USD").round(2).toDb()).toBe("0.12");
    expect(Money.of("0.135", "USD").round(2).toDb()).toBe("0.14");
  });
});

describe("sumMoney", () => {
  it("listeyi toplar", () => {
    const items = [Money.of(10, "USD"), Money.of(20, "USD"), Money.of(30, "USD")];
    expect(sumMoney(items).toDb()).toBe("60");
  });

  it("boş liste için para birimi ister", () => {
    expect(() => sumMoney([])).toThrow(/para birimi zorunlu/);
    expect(sumMoney([], "USD").isZero()).toBe(true);
  });
});

describe("toDecimal", () => {
  it("float gösterim gürültüsünü taşımaz", () => {
    expect(toDecimal(0.1).plus(toDecimal(0.2)).toFixed()).toBe("0.3");
  });

  it("geçersiz girdileri reddeder", () => {
    expect(() => toDecimal(NaN)).toThrow();
    expect(() => toDecimal(Infinity)).toThrow();
    expect(() => toDecimal("")).toThrow();
  });
});

describe("biçimlendirme (tr-TR)", () => {
  it("binlik ayracı nokta, ondalık virgül", () => {
    expect(formatMoney(Money.of("1234567.89", "USD"))).toBe("1.234.567,89 $");
  });

  it("TL sembolü", () => {
    expect(formatMoney(Money.of("100000000", "TRY"))).toBe("100.000.000,00 ₺");
  });

  it("kısaltılmış gösterim", () => {
    expect(formatMoney(Money.of("10000000", "USD"), { compact: true })).toBe("10,0 Mn $");
    expect(formatMoney(Money.of("1500000000", "USD"), { compact: true })).toBe("1,50 Mr $");
  });

  it("yüzde biçimi", () => {
    expect(formatPercent("0.0734")).toBe("%7,34");
    expect(formatPercent("0.0734", { signed: true })).toBe("+%7,34");
    expect(formatPercent("-0.12")).toBe("%-12,00");
  });

  it("miktar sondaki sıfırları atar", () => {
    expect(formatQuantity("1.50000000")).toBe("1,5");
    expect(formatQuantity("1000")).toBe("1.000");
  });
});
