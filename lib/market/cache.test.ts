import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TokenBucket, recordFailure, recordSuccess, isBackedOff } from "./cache";
import { classify } from "./registry";

describe("TokenBucket — hız sınırlayıcı", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("kapasite kadar token verir, sonra reddeder", () => {
    const b = new TokenBucket(3, 1);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(false);
  });

  it("zamanla dolar", () => {
    const b = new TokenBucket(2, 1); // saniyede 1 token
    b.tryTake();
    b.tryTake();
    expect(b.tryTake()).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(false);
  });

  it("kapasiteyi aşacak şekilde birikmez", () => {
    const b = new TokenBucket(2, 1);
    vi.advanceTimersByTime(60_000); // çok bekle
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(false); // tavan 2
  });

  it("CoinGecko limiti dakikada 8'i geçmez", () => {
    // Gerçek yapılandırma: kapasite 4, saniyede 8/60 token
    const b = new TokenBucket(4, 8 / 60);
    let taken = 0;
    // 1 dakika boyunca 1 saniyede bir dene
    for (let i = 0; i < 60; i++) {
      if (b.tryTake()) taken++;
      vi.advanceTimersByTime(1000);
    }
    // Başlangıç 4 token + dakikada 8 dolum = en fazla 12
    expect(taken).toBeLessThanOrEqual(12);
    // CoinGecko'nun anahtarsız alt sınırı olan 10/dk'ya yakın ama
    // sürekli rejimde 8/dk'da sabitlenir
    expect(taken).toBeGreaterThan(0);
  });

  it("msUntilNextToken bekleme süresini bildirir", () => {
    const b = new TokenBucket(1, 1);
    b.tryTake();
    expect(b.msUntilNextToken()).toBeGreaterThan(0);
    expect(b.msUntilNextToken()).toBeLessThanOrEqual(1000);
  });
});

describe("backoff — ardışık hata", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    recordSuccess("test-provider");
  });
  afterEach(() => vi.useRealTimers());

  it("hata sonrası backoff devreye girer", () => {
    expect(isBackedOff("test-provider")).toBe(false);
    recordFailure("test-provider");
    expect(isBackedOff("test-provider")).toBe(true);
  });

  it("backoff süresi dolunca tekrar denenir", () => {
    recordFailure("test-provider"); // 2 sn
    vi.advanceTimersByTime(2100);
    expect(isBackedOff("test-provider")).toBe(false);
  });

  it("ardışık hatalarda süre üstel artar", () => {
    recordFailure("test-provider"); // 2 sn
    recordFailure("test-provider"); // 4 sn
    recordFailure("test-provider"); // 8 sn
    vi.advanceTimersByTime(5000);
    expect(isBackedOff("test-provider")).toBe(true); // 8 sn dolmadı
    vi.advanceTimersByTime(4000);
    expect(isBackedOff("test-provider")).toBe(false);
  });

  it("başarı backoff'u sıfırlar", () => {
    recordFailure("test-provider");
    recordFailure("test-provider");
    recordSuccess("test-provider");
    expect(isBackedOff("test-provider")).toBe(false);
  });
});

describe("classify — sembol yönlendirme", () => {
  it("BIST sembolleri hisse sayılır", () => {
    expect(classify("THYAO.IS")).toBe("equity");
    expect(classify("BIMAS.IS")).toBe("equity");
  });

  it("bilinen kripto sembolleri kripto sayılır", () => {
    expect(classify("BTC")).toBe("crypto");
    expect(classify("btc")).toBe("crypto");
    expect(classify("ETH")).toBe("crypto");
  });

  it("endeksler hisse sayılır", () => {
    expect(classify("^GSPC")).toBe("equity");
    expect(classify("^XU100")).toBe("equity");
  });

  it("bilinmeyen semboller Yahoo'ya gider", () => {
    expect(classify("AAPL")).toBe("equity");
    expect(classify("VOO")).toBe("equity");
  });
});
