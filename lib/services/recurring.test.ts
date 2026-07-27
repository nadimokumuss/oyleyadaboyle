import { describe, it, expect } from "vitest";
import {
  addPeriods,
  formatDay,
  nextOccurrence,
  parseDay,
  type Frequency,
} from "./recurring";

/**
 * Tarih aritmetiği testleri.
 *
 * Bu fonksiyonlar DB'ye dokunmaz — tekrarlayan hareketlerin ne zaman
 * üretileceğine tek başlarına karar verirler, dolayısıyla çift kayıt
 * veya atlanan ay gibi hataların kaynağı burasıdır.
 */

const d = (iso: string) => parseDay(iso);

describe("addPeriods — periyot ekleme", () => {
  it("haftalık 7 gün ekler", () => {
    expect(formatDay(addPeriods(d("2026-01-01"), "weekly", 1))).toBe("2026-01-08");
    expect(formatDay(addPeriods(d("2026-01-01"), "weekly", 4))).toBe("2026-01-29");
  });

  it("aylık ay ekler", () => {
    expect(formatDay(addPeriods(d("2026-03-15"), "monthly", 1))).toBe("2026-04-15");
    expect(formatDay(addPeriods(d("2026-03-15"), "monthly", 6))).toBe("2026-09-15");
  });

  it("üç aylık ve yıllık", () => {
    expect(formatDay(addPeriods(d("2026-01-10"), "quarterly", 1))).toBe("2026-04-10");
    expect(formatDay(addPeriods(d("2026-01-10"), "yearly", 2))).toBe("2028-01-10");
  });

  it("yıl sınırını geçer", () => {
    expect(formatDay(addPeriods(d("2026-11-20"), "monthly", 3))).toBe("2027-02-20");
  });

  it("ayın 31'i kısa aya sığdırılır ama çapa bozulmaz", () => {
    // Asıl hata bu: naif "bir ay ekle" 31 Oca → 28 Şub → 28 Mar yapar
    // ve ayın 31'i bir daha asla gelmez.
    const anchor = d("2026-01-31");
    expect(formatDay(addPeriods(anchor, "monthly", 1))).toBe("2026-02-28");
    expect(formatDay(addPeriods(anchor, "monthly", 2))).toBe("2026-03-31");
    expect(formatDay(addPeriods(anchor, "monthly", 3))).toBe("2026-04-30");
    expect(formatDay(addPeriods(anchor, "monthly", 4))).toBe("2026-05-31");
  });

  it("artık yılı bilir", () => {
    expect(formatDay(addPeriods(d("2024-01-31"), "monthly", 1))).toBe("2024-02-29");
    expect(formatDay(addPeriods(d("2023-02-28"), "yearly", 1))).toBe("2024-02-28");
  });

  it("n=0 çapanın kendisini verir", () => {
    expect(formatDay(addPeriods(d("2026-06-15"), "monthly", 0))).toBe("2026-06-15");
  });
});

describe("nextOccurrence — sıradaki tarih", () => {
  it("çapadan sonraki ilk tekrarı verir", () => {
    expect(nextOccurrence("2026-01-15", "monthly", "2026-01-15")).toBe("2026-02-15");
  });

  it("aradan aylar geçmişse doğru tarihe atlar", () => {
    expect(nextOccurrence("2026-01-15", "monthly", "2026-05-15")).toBe("2026-06-15");
  });

  it("çapa gelecekteyse çapanın kendisini verir", () => {
    expect(nextOccurrence("2026-12-01", "monthly", "2026-06-01")).toBe("2026-12-01");
  });

  it("arka arkaya ilerletmede kayma birikmez", () => {
    // Ayın 31'inden başlayıp 12 kez ilerlersek yine ayın 31'i olmalı,
    // 28'e düşüp orada kalmamalı.
    const anchor = "2026-01-31";
    let cursor = anchor;
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      cursor = nextOccurrence(anchor, "monthly", cursor);
      seen.push(cursor);
    }
    expect(seen[0]).toBe("2026-02-28");
    expect(seen[1]).toBe("2026-03-31");
    expect(seen[11]).toBe("2027-01-31");
  });

  it("her frekans için ilerler", () => {
    const cases: Array<[Frequency, string]> = [
      ["weekly", "2026-06-08"],
      ["monthly", "2026-07-01"],
      ["quarterly", "2026-09-01"],
      ["yearly", "2027-06-01"],
    ];
    for (const [freq, expected] of cases) {
      expect(nextOccurrence("2026-06-01", freq, "2026-06-01")).toBe(expected);
    }
  });
});
