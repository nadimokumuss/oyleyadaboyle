/**
 * Tüm piyasa veri sağlayıcılarının uyduğu ortak arayüz.
 *
 * Sağlayıcı eklemek/değiştirmek uygulamanın geri kalanını etkilemez;
 * registry.ts sembolü doğru sağlayıcıya yönlendirir.
 */

export interface Quote {
  symbol: string;
  /** Ondalık string — float değil. */
  price: string;
  currency: string;
  /** 24 saatlik değişim oranı (0.031 = +%3,1). Bilinmiyorsa null. */
  changePct24h: string | null;
  /** Fiyatın ait olduğu an. */
  asOf: Date;
  source: string;
  /**
   * true ise sağlayıcıya ulaşılamadı ve bu son bilinen fiyat.
   * Arayüz bunu gizlemez — kullanıcı verinin bayat olduğunu görmeli.
   */
  stale: boolean;
}

export interface MarketProvider {
  readonly name: string;
  /** Bu sağlayıcının tek çağrıda alabileceği maksimum sembol sayısı. */
  readonly batchSize: number;
  /**
   * Sembolleri fiyatlandırır. Bulunamayan semboller sonuçta yer almaz —
   * uydurma fiyat dönmez.
   */
  fetchQuotes(symbols: string[]): Promise<Quote[]>;
}

export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly cause?: unknown,
  ) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderError";
  }
}

/** Ağ çağrıları için ortak fetch — zaman aşımı ve hata sarmalama. */
export async function fetchJson<T>(
  url: string,
  provider: string,
  timeoutMs = 10_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "servet-terminali/0.1" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new ProviderError(provider, `HTTP ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new ProviderError(provider, `zaman aşımı (${timeoutMs}ms)`, err);
    }
    throw new ProviderError(provider, "ağ hatası", err);
  } finally {
    clearTimeout(timer);
  }
}

/** Float'ı güvenli ondalık string'e çevirir (bilimsel gösterim olmadan). */
export function numToDecimalString(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Geçersiz fiyat: ${n}`);
  // toFixed(12) küçük kripto fiyatlarını da (0.000000123) korur
  return n.toFixed(12).replace(/\.?0+$/, "") || "0";
}
