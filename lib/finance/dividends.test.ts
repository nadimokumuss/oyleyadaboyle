import { describe, it, expect } from "vitest";
import { analyzeDividends, sumDividends } from "./dividends";
import { Money } from "@/lib/money";
import type { Transaction } from "@/db/schema";

let seq = 0;
function tx(type: string, date: string, amount: string, currency = "USD"): Transaction {
  seq++;
  return {
    id: `tx-${seq}`,
    assetId: "a1",
    type,
    date,
    quantity: null,
    pricePerUnit: null,
    amount,
    currency,
    fxRateToUsd: "1",
    fee: null,
    note: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as Transaction;
}

const NOW = new Date("2026-07-01T12:00:00Z");
const usd = (n: string) => Money.of(n, "USD");

const analyze = (txs: Transaction[], cost = "10000") =>
  analyzeDividends("a1", "USD", txs, usd(cost), NOW);

describe("analyzeDividends", () => {
  it("temettü yoksa sıfır döner, çökmez", () => {
    const a = analyze([tx("buy", "2026-01-01", "10000")]);
    expect(a.trailingTwelveMonths.toDb()).toBe("0");
    expect(a.paymentCount).toBe(0);
    expect(a.lastPaymentDate).toBeNull();
  });

  it("son 12 aydaki ödemeleri toplar", () => {
    const a = analyze([
      tx("dividend", "2025-09-15", "100"),
      tx("dividend", "2025-12-15", "100"),
      tx("dividend", "2026-03-15", "120"),
      tx("dividend", "2026-06-15", "120"),
    ]);
    expect(a.trailingTwelveMonths.toDb()).toBe("440");
    expect(a.paymentCount).toBe(4);
  });

  it("12 aydan eski ödeme tahmine girmez ama ömür boyu toplamda kalır", () => {
    const a = analyze([
      tx("dividend", "2024-01-15", "500"), // çok eski
      tx("dividend", "2026-03-15", "100"),
    ]);
    expect(a.trailingTwelveMonths.toDb()).toBe("100");
    expect(a.lifetime.toDb()).toBe("600");
  });

  it("gelecek tarihli kayıt tahmini şişirmez", () => {
    const a = analyze([
      tx("dividend", "2026-03-15", "100"),
      tx("dividend", "2027-01-01", "9999"),
    ]);
    expect(a.trailingTwelveMonths.toDb()).toBe("100");
  });

  it("staking ve dağıtım da gelir sayılır", () => {
    const a = analyze([
      tx("dividend", "2026-03-15", "100"),
      tx("staking", "2026-04-15", "50"),
      tx("distribution", "2026-05-15", "25"),
    ]);
    expect(a.trailingTwelveMonths.toDb()).toBe("175");
  });

  it("alım ve satım gelir sayılmaz", () => {
    const a = analyze([
      tx("buy", "2026-01-01", "10000"),
      tx("sell", "2026-02-01", "5000"),
      tx("dividend", "2026-03-15", "100"),
    ]);
    expect(a.trailingTwelveMonths.toDb()).toBe("100");
  });

  it("maliyete göre verim doğru", () => {
    // 10.000 maliyete 400 temettü = %4
    const a = analyze([tx("dividend", "2026-03-15", "400")], "10000");
    expect(a.yieldOnCost?.toFixed(4)).toBe("0.0400");
  });

  it("maliyet sıfırsa verim null — bölme hatası vermez", () => {
    const a = analyze([tx("dividend", "2026-03-15", "400")], "0");
    expect(a.yieldOnCost).toBeNull();
  });

  it("aylık ortalama yıllığın on ikide biri", () => {
    const a = analyze([tx("dividend", "2026-03-15", "1200")]);
    expect(a.monthlyAverage.toDb()).toBe("100");
  });

  it("son ödeme tarihi en yenidir", () => {
    const a = analyze([
      tx("dividend", "2026-06-15", "100"),
      tx("dividend", "2026-01-15", "100"),
    ]);
    expect(a.lastPaymentDate).toBe("2026-06-15");
  });

  it("ileriye dönük tahmin son 12 aya eşit", () => {
    const a = analyze([tx("dividend", "2026-03-15", "333")]);
    expect(a.forwardEstimate.toDb()).toBe(a.trailingTwelveMonths.toDb());
  });
});

describe("sumDividends", () => {
  const analyses = [
    analyzeDividends("a1", "USD", [tx("dividend", "2026-03-15", "100")], usd("1000"), NOW),
    analyzeDividends("a2", "EUR", [tx("dividend", "2026-03-15", "200", "EUR")], Money.of("2000", "EUR"), NOW),
  ];

  it("çevrilebilenleri toplar", () => {
    const total = sumDividends(analyses, (m) =>
      m.currency === "USD" ? m : Money.of(m.amount.times(1.1), "USD"),
    );
    expect(total.trailingTwelveMonths.toDb()).toBe("320");
    expect(total.unconverted).toHaveLength(0);
  });

  it("çevrilemeyeni sessizce yutmaz, bildirir", () => {
    const total = sumDividends(analyses, (m) => (m.currency === "USD" ? m : null));
    expect(total.trailingTwelveMonths.toDb()).toBe("100");
    expect(total.unconverted).toEqual(["EUR"]);
  });

  it("boş listede sıfır döner", () => {
    const total = sumDividends([], (m) => m);
    expect(total.trailingTwelveMonths.toDb()).toBe("0");
    expect(total.monthlyAverage.toDb()).toBe("0");
  });
});
