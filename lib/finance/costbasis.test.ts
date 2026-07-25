import { describe, it, expect } from "vitest";
import { computePosition, valuePosition } from "./costbasis";
import { Money } from "@/lib/money";
import type { Transaction } from "@/db/schema";

let seq = 0;
function tx(p: Partial<Transaction>): Transaction {
  seq++;
  return {
    id: `tx${seq}`,
    assetId: "a1",
    type: "buy",
    date: "2026-01-01",
    quantity: null,
    pricePerUnit: null,
    amount: "0",
    currency: "USD",
    fxRateToUsd: null,
    fee: null,
    note: null,
    createdAt: String(seq).padStart(6, "0"),
    updatedAt: "",
    ...p,
  } as Transaction;
}

describe("computePosition — alım", () => {
  it("tek alımda WAC birim fiyata eşit", () => {
    const p = computePosition("a1", "USD", [
      tx({ type: "buy", quantity: "10", amount: "1000", date: "2026-01-01" }),
    ]);
    expect(p.quantity.toFixed()).toBe("10");
    expect(p.wacPerUnit.toDb()).toBe("100");
    expect(p.totalCost.toDb()).toBe("1000");
  });

  it("komisyon maliyete eklenir", () => {
    const p = computePosition("a1", "USD", [
      tx({ type: "buy", quantity: "10", amount: "1000", fee: "50" }),
    ]);
    expect(p.totalCost.toDb()).toBe("1050");
    expect(p.wacPerUnit.toDb()).toBe("105");
  });

  it("iki farklı fiyattan alımda WAC doğru ağırlıklanır", () => {
    const p = computePosition("a1", "USD", [
      tx({ type: "buy", quantity: "10", amount: "1000", date: "2026-01-01" }),
      tx({ type: "buy", quantity: "30", amount: "6000", date: "2026-02-01" }),
    ]);
    // (1000 + 6000) / 40 = 175
    expect(p.quantity.toFixed()).toBe("40");
    expect(p.wacPerUnit.toDb()).toBe("175");
  });
});

describe("computePosition — WAC ve FIFO farkı", () => {
  const buys = [
    tx({ type: "buy", quantity: "10", amount: "1000", date: "2026-01-01" }), // 100/adet
    tx({ type: "buy", quantity: "10", amount: "3000", date: "2026-02-01" }), // 300/adet
  ];

  it("WAC ortalama maliyetten hesaplar", () => {
    const p = computePosition("a1", "USD", [
      ...buys,
      tx({ type: "sell", quantity: "10", amount: "2500", date: "2026-03-01" }),
    ]);
    // WAC = 4000/20 = 200. Satılanın maliyeti 2000, hasılat 2500 → +500
    expect(p.realizedPnl.toDb()).toBe("500");
  });

  it("FIFO en eski lottan hesaplar — farklı sonuç verir", () => {
    const p = computePosition("a1", "USD", [
      ...buys,
      tx({ type: "sell", quantity: "10", amount: "2500", date: "2026-03-01" }),
    ]);
    // FIFO: ilk 10 adet 100'den alınmıştı → maliyet 1000, hasılat 2500 → +1500
    expect(p.realizedPnlFifo.toDb()).toBe("1500");
    // İki yöntem farklı ve ikisi de doğru
    expect(p.realizedPnl.eq(p.realizedPnlFifo)).toBe(false);
  });

  it("satıştan sonra kalan lot doğru", () => {
    const p = computePosition("a1", "USD", [
      ...buys,
      tx({ type: "sell", quantity: "15", amount: "3000", date: "2026-03-01" }),
    ]);
    expect(p.quantity.toFixed()).toBe("5");
    // İlk lot tamamen, ikinci lottan 5 tüketildi → 5 adet 300'lük lot kaldı
    expect(p.lots).toHaveLength(1);
    expect(p.lots[0].qty).toBe("5");
    expect(p.lots[0].price).toBe("300");
  });
});

describe("computePosition — kapanış ve kenar durumlar", () => {
  it("pozisyon tamamen kapanınca maliyet sıfırlanır", () => {
    const p = computePosition("a1", "USD", [
      tx({ type: "buy", quantity: "10", amount: "1000" }),
      tx({ type: "sell", quantity: "10", amount: "1500", date: "2026-06-01" }),
    ]);
    expect(p.quantity.toFixed()).toBe("0");
    expect(p.totalCost.isZero()).toBe(true);
    expect(p.lots).toHaveLength(0);
    expect(p.realizedPnl.toDb()).toBe("500");
  });

  it("elde olandan fazlası satılamaz", () => {
    const p = computePosition("a1", "USD", [
      tx({ type: "buy", quantity: "10", amount: "1000" }),
      tx({ type: "sell", quantity: "999", amount: "1500", date: "2026-06-01" }),
    ]);
    expect(p.quantity.toFixed()).toBe("0");
    expect(p.quantity.isNegative()).toBe(false);
  });

  it("satış komisyonu hasılattan düşer", () => {
    const p = computePosition("a1", "USD", [
      tx({ type: "buy", quantity: "10", amount: "1000" }),
      tx({ type: "sell", quantity: "10", amount: "1500", fee: "100", date: "2026-06-01" }),
    ]);
    expect(p.realizedPnl.toDb()).toBe("400");
  });

  it("işlem sırası tarihe göre normalize edilir", () => {
    // Satış önce kaydedilmiş ama tarihi sonra
    const p = computePosition("a1", "USD", [
      tx({ type: "sell", quantity: "10", amount: "1500", date: "2026-06-01" }),
      tx({ type: "buy", quantity: "10", amount: "1000", date: "2026-01-01" }),
    ]);
    expect(p.realizedPnl.toDb()).toBe("500");
  });

  it("boş işlem listesi sıfır pozisyon verir", () => {
    const p = computePosition("a1", "USD", []);
    expect(p.quantity.toFixed()).toBe("0");
    expect(p.totalCost.isZero()).toBe(true);
  });
});

describe("computePosition — gelir ve gider", () => {
  it("temettü ve faiz gelir sayılır, miktarı değiştirmez", () => {
    const p = computePosition("a1", "USD", [
      tx({ type: "buy", quantity: "10", amount: "1000" }),
      tx({ type: "dividend", amount: "75", date: "2026-03-01" }),
      tx({ type: "staking", amount: "25", date: "2026-04-01" }),
    ]);
    expect(p.incomeReceived.toDb()).toBe("100");
    expect(p.quantity.toFixed()).toBe("10");
    expect(p.totalCost.toDb()).toBe("1000");
  });

  it("gider ve vergi ayrı toplanır", () => {
    const p = computePosition("a1", "USD", [
      tx({ type: "buy", quantity: "10", amount: "1000" }),
      tx({ type: "tax", amount: "30", date: "2026-03-01" }),
      tx({ type: "expense", amount: "20", date: "2026-04-01" }),
    ]);
    expect(p.costsPaid.toDb()).toBe("50");
  });
});

describe("valuePosition", () => {
  it("canlı fiyata göre değer ve gerçekleşmemiş K/Z", () => {
    const p = computePosition("a1", "USD", [
      tx({ type: "buy", quantity: "10", amount: "1000" }),
    ]);
    const v = valuePosition(p, Money.of(150, "USD"));
    expect(v.marketValue.toDb()).toBe("1500");
    expect(v.unrealizedPnl.toDb()).toBe("500");
    expect(v.returnRatio?.toDecimalPlaces(4).toNumber()).toBe(0.5);
  });

  it("sıfır maliyette getiri oranı null döner, patlamaz", () => {
    const p = computePosition("a1", "USD", []);
    const v = valuePosition(p, Money.of(150, "USD"));
    expect(v.returnRatio).toBeNull();
    expect(v.marketValue.toDb()).toBe("0");
  });
});
