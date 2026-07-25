import { CoinGeckoProvider, isKnownCrypto } from "./coingecko";
import { YahooProvider } from "./yahoo";
import type { MarketProvider, Quote } from "./provider";
import {
  readCache,
  writeCache,
  markStale,
  getBucket,
  isBackedOff,
  recordFailure,
  recordSuccess,
  TTL_MS,
} from "./cache";

/**
 * Sembolü doğru sağlayıcıya yönlendiren ve cache/limit politikasını
 * uygulayan tek giriş noktası. Uygulamanın geri kalanı sadece
 * `getQuotes(symbols)` çağırır.
 */

const coingecko = new CoinGeckoProvider();
const yahoo = new YahooProvider();

export type AssetClass = "crypto" | "equity";

export function classify(symbol: string): AssetClass {
  const s = symbol.toUpperCase();
  // Nokta içeren semboller borsa sonekli (.IS = BIST, .DE, .L ...)
  if (s.includes(".")) return "equity";
  // ^GSPC, ^XU100 gibi endeksler
  if (s.startsWith("^")) return "equity";
  if (isKnownCrypto(s)) return "crypto";
  return "equity";
}

function providerFor(cls: AssetClass): MarketProvider {
  return cls === "crypto" ? coingecko : yahoo;
}

function ttlFor(cls: AssetClass): number {
  return cls === "crypto" ? TTL_MS.crypto : TTL_MS.equity;
}

export interface QuoteResult extends Quote {
  /** Fiyatın yaşı (ms). Arayüz "3 dk önce" göstermek için kullanır. */
  ageMs: number;
  /** Bu çağrıda sağlayıcıdan mı geldi, cache'ten mi? */
  fromCache: boolean;
}

/**
 * Sembollerin güncel fiyatlarını döner.
 *
 * Akış: cache oku → tazesi varsa kullan → bayat/eksik olanları sınıfına
 * göre grupla → hız sınırı ve backoff izin veriyorsa sağlayıcıdan çek →
 * cache'e yaz. Sağlayıcı hata verir veya limit doluysa son bilinen fiyat
 * `stale: true` ile döner; hiç kaydı yoksa o sembol sonuçta yer almaz.
 */
export async function getQuotes(symbols: string[]): Promise<QuoteResult[]> {
  const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()))].filter(Boolean);
  if (unique.length === 0) return [];

  const cached = readCache(unique);
  const results = new Map<string, QuoteResult>();
  const needsFetch: string[] = [];

  for (const symbol of unique) {
    const hit = cached.get(symbol);
    if (hit && !hit.stale && hit.ageMs < ttlFor(classify(symbol))) {
      results.set(symbol, { ...hit, fromCache: true });
    } else {
      needsFetch.push(symbol);
    }
  }

  if (needsFetch.length > 0) {
    const byClass = new Map<AssetClass, string[]>();
    for (const s of needsFetch) {
      const cls = classify(s);
      const list = byClass.get(cls);
      if (list) list.push(s);
      else byClass.set(cls, [s]);
    }

    await Promise.all(
      [...byClass.entries()].map(([cls, syms]) =>
        fetchClass(cls, syms, results),
      ),
    );
  }

  // Hâlâ eksik olanlar için cache'teki bayat kaydı kullan
  for (const symbol of unique) {
    if (results.has(symbol)) continue;
    const hit = cached.get(symbol);
    if (hit) {
      results.set(symbol, { ...hit, stale: true, fromCache: true });
    }
  }

  return unique
    .map((s) => results.get(s))
    .filter((q): q is QuoteResult => Boolean(q));
}

async function fetchClass(
  cls: AssetClass,
  symbols: string[],
  results: Map<string, QuoteResult>,
): Promise<void> {
  const provider = providerFor(cls);
  const bucket = getBucket(provider.name);

  // Backoff sürüyorsa veya token yoksa sağlayıcıya hiç dokunma
  if (isBackedOff(provider.name) || !bucket.tryTake()) {
    markStale(symbols);
    return;
  }

  try {
    const fresh: Quote[] = [];
    for (let i = 0; i < symbols.length; i += provider.batchSize) {
      const batch = symbols.slice(i, i + provider.batchSize);
      // İlk batch dışındakiler için de token gerekir
      if (i > 0 && !bucket.tryTake()) break;
      fresh.push(...(await provider.fetchQuotes(batch)));
    }

    if (fresh.length > 0) {
      writeCache(fresh);
      recordSuccess(provider.name);
      const now = Date.now();
      for (const q of fresh) {
        results.set(q.symbol, {
          ...q,
          ageMs: now - q.asOf.getTime(),
          fromCache: false,
        });
      }
    }

    // Sağlayıcının döndürmediği semboller bayat işaretlenir
    const returned = new Set(fresh.map((q) => q.symbol));
    const missing = symbols.filter((s) => !returned.has(s));
    if (missing.length > 0) markStale(missing);
  } catch (err) {
    recordFailure(provider.name);
    markStale(symbols);
    console.warn(`[market] ${provider.name} başarısız:`, (err as Error).message);
  }
}

/** Tek sembol için kısayol. */
export async function getQuote(symbol: string): Promise<QuoteResult | null> {
  const [q] = await getQuotes([symbol]);
  return q ?? null;
}
