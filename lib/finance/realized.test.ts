import { describe, it, expect } from "vitest";
import { realizedEvents, type LotMethod } from "./realized";
import type { Transaction } from "@/db/schema";

/**
 * Gerçekleşen K/Z testleri.
 *
 * Bu sayılar vergi beyanına girecek — lot eşleştirmesindeki bir hata
 * doğrudan yanlış beyana yol açar. Her yöntem ayrı ayrı sabitlendi.
 */

let seq = 0;
function tx(over: Partial<Transaction>): Transaction {
  seq++;
  return {
    id: `tx-${seq}`,
    assetId: "a1",
    type: "buy",
    date: "2026-01-01",
    quantity: null,
    pricePerUnit: null,
    amount: "0",
    currency: "USD",
    fxRateToUsd: "1",
    fee: null,
    note: null,
    createdAt: `2026-01-01T00:00:${String(seq).padStart(2, "0")}Z`,
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  } as Transaction;
}

const buy = (date: string, qty: string, total: string, fee?: string) =>
  tx({ type: "buy", date, quantity: qty, amount: total, fee: fee ?? null });

const sell = (date: string, qty: string, total: string, fee?: string) =>
  tx({ type: "sell", date, quantity: qty, amount: total, fee: fee ?? null });

const run = (txs: Transaction[], method: LotMethod = "fifo", longTermDays = 365) =>
  realizedEvents("a1", "USD", txs, { method, longTermDays });

describe("realizedEvents — temel", () => {
  it("satış yoksa olay üretmez", () => {
    expect(run([buy("2026-01-01", "10", "1000")])).toHaveLength(0);
  });

  it("tek alım tek satış: kâr doğru", () => {
    const [e] = run([buy("2026-01-01", "10", "1000"), sell("2026-06-01", "10", "1500")]);
    expect(e.proceeds).toBe("1500");
    expect(e.costBasis).toBe("1000");
    expect(e.gain).toBe("500");
  });

  it("zarar negatif çıkar", () => {
    const [e] = run([buy("2026-01-01", "10", "1000"), sell("2026-06-01", "10", "700")]);
    expect(e.gain).toBe("-300");
  });

  it("komisyon maliyete eklenir ve hasılattan düşer", () => {
    // Alış 1000 + 10 komisyon = 1010 maliyet
    // Satış 1500 − 20 komisyon = 1480 hasılat → kâr 470
    const [e] = run([
      buy("2026-01-01", "10", "1000", "10"),
      sell("2026-06-01", "10", "1500", "20"),
    ]);
    expect(e.costBasis).toBe("1010");
    expect(e.proceeds).toBe("1480");
    expect(e.gain).toBe("470");
  });

  it("kısmi satışta yalnızca satılan kısım hesaplanır", () => {
    const [e] = run([buy("2026-01-01", "10", "1000"), sell("2026-06-01", "4", "600")]);
    expect(e.quantity).toBe("4");
    expect(e.costBasis).toBe("400");
    expect(e.gain).toBe("200");
  });

  it("her satış ayrı olay üretir", () => {
    const events = run([
      buy("2026-01-01", "10", "1000"),
      sell("2026-03-01", "5", "600"),
      sell("2026-09-01", "5", "700"),
    ]);
    expect(events).toHaveLength(2);
    expect(events[0].date).toBe("2026-03-01");
    expect(events[1].date).toBe("2026-09-01");
  });

  it("elde olandan fazlası satılamaz", () => {
    const [e] = run([buy("2026-01-01", "5", "500"), sell("2026-06-01", "99", "1000")]);
    expect(e.quantity).toBe("5");
  });

  it("adetsiz çıkış vergi olayı doğurmaz", () => {
    // Nakit çekimi bir varlığın elden çıkarılması değildir.
    const events = run([
      tx({ type: "deposit_in", date: "2026-01-01", amount: "1000", quantity: "1000" }),
      tx({ type: "withdraw", date: "2026-06-01", amount: "300", quantity: null }),
    ]);
    expect(events).toHaveLength(0);
  });

  it("değerleme kaydı yok sayılır", () => {
    const events = run([
      buy("2026-01-01", "10", "1000"),
      tx({ type: "valuation", date: "2026-03-01", amount: "2000" }),
      sell("2026-06-01", "10", "1500"),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].gain).toBe("500");
  });
});

describe("realizedEvents — lot yöntemleri", () => {
  // İki lot: ucuz-eski ve pahalı-yeni. Yöntem seçimi sonucu değiştirir.
  const txs = [
    buy("2026-01-01", "10", "1000"), // birim 100
    buy("2026-06-01", "10", "2000"), // birim 200
    sell("2026-09-01", "10", "2500"), // birim 250
  ];

  it("FIFO en eski lot'u satar", () => {
    const [e] = run(txs, "fifo");
    expect(e.costBasis).toBe("1000");
    expect(e.gain).toBe("1500");
  });

  it("LIFO en yeni lot'u satar", () => {
    const [e] = run(txs, "lifo");
    expect(e.costBasis).toBe("2000");
    expect(e.gain).toBe("500");
  });

  it("HIFO en pahalı lot'u satar — kârı en aza indirir", () => {
    const [e] = run(txs, "hifo");
    expect(e.costBasis).toBe("2000");
    expect(e.gain).toBe("500");
  });

  it("HIFO sırayı fiyata göre kurar, tarihe göre değil", () => {
    // Pahalı olan ÖNCE alınmış: FIFO ve HIFO burada ayrışmalı.
    const mixed = [
      buy("2026-01-01", "10", "3000"), // birim 300 — pahalı ama eski
      buy("2026-06-01", "10", "1000"), // birim 100 — ucuz ve yeni
      sell("2026-09-01", "10", "2000"),
    ];
    expect(run(mixed, "fifo")[0].costBasis).toBe("3000");
    expect(run(mixed, "hifo")[0].costBasis).toBe("3000");
    expect(run(mixed, "lifo")[0].costBasis).toBe("1000");
  });

  it("satış birden çok lot'a yayılır", () => {
    const [e] = run([
      buy("2026-01-01", "10", "1000"), // 100/adet
      buy("2026-06-01", "10", "2000"), // 200/adet
      sell("2026-09-01", "15", "3750"), // 250/adet
    ], "fifo");

    // 10 adet × 100 + 5 adet × 200 = 2000 maliyet
    expect(e.costBasis).toBe("2000");
    expect(e.gain).toBe("1750");
    expect(e.lots).toHaveLength(2);
    expect(e.lots[0].qty).toBe("10");
    expect(e.lots[1].qty).toBe("5");
  });

  it("kalan lot bir sonraki satışta kullanılır", () => {
    const events = run([
      buy("2026-01-01", "10", "1000"),
      buy("2026-06-01", "10", "2000"),
      sell("2026-09-01", "15", "3750"),
      sell("2026-10-01", "5", "1500"), // kalan 5 adet, birim maliyet 200
    ], "fifo");

    expect(events[1].costBasis).toBe("1000");
    expect(events[1].gain).toBe("500");
  });
});

describe("realizedEvents — elde tutma süresi", () => {
  it("bir yıldan kısa tutma kısa vade sayılır", () => {
    const [e] = run([buy("2026-01-01", "10", "1000"), sell("2026-06-01", "10", "1500")]);
    expect(e.shortTermGain).toBe("500");
    expect(e.longTermGain).toBe("0");
    expect(e.lots[0].longTerm).toBe(false);
  });

  it("eşiği aşan tutma uzun vade sayılır", () => {
    const [e] = run([buy("2025-01-01", "10", "1000"), sell("2026-06-01", "10", "1500")]);
    expect(e.longTermGain).toBe("500");
    expect(e.shortTermGain).toBe("0");
    expect(e.lots[0].longTerm).toBe(true);
  });

  it("tam eşik günü uzun vade kabul edilir", () => {
    const [e] = run([buy("2025-01-01", "10", "1000"), sell("2026-01-01", "10", "1500")]);
    expect(e.lots[0].holdingDays).toBe(365);
    expect(e.lots[0].longTerm).toBe(true);
  });

  it("eşik ayarlanabilir", () => {
    const txs = [buy("2025-01-01", "10", "1000"), sell("2026-06-01", "10", "1500")];
    // İki yıllık eşikte aynı işlem kısa vadeye düşer.
    const [e] = run(txs, "fifo", 730);
    expect(e.shortTermGain).toBe("500");
  });

  it("tek satış hem kısa hem uzun vade içerebilir", () => {
    const [e] = run([
      buy("2024-01-01", "10", "1000"), // uzun vade
      buy("2026-06-01", "10", "2000"), // kısa vade
      sell("2026-09-01", "20", "5000"), // 250/adet
    ], "fifo");

    // Eski lot: 2500 − 1000 = 1500 uzun
    // Yeni lot: 2500 − 2000 =  500 kısa
    expect(e.longTermGain).toBe("1500");
    expect(e.shortTermGain).toBe("500");
    expect(e.gain).toBe("2000");
  });

  it("kısa + uzun toplamı genel kâra eşittir", () => {
    for (const method of ["fifo", "lifo", "hifo"] as LotMethod[]) {
      const [e] = run([
        buy("2024-01-01", "7", "700"),
        buy("2026-05-01", "13", "2600"),
        sell("2026-09-01", "20", "5000"),
      ], method);
      const sum = Number(e.shortTermGain) + Number(e.longTermGain);
      expect(sum).toBeCloseTo(Number(e.gain), 8);
    }
  });
});
