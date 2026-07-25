import { db } from "@/db/client";
import { priceCache } from "@/db/schema";
import { inArray, sql } from "drizzle-orm";
import type { Quote } from "./provider";

/**
 * Fiyat cache'i + hız sınırlayıcı.
 *
 * Üç görevi var:
 *  1. Aynı fiyatı tekrar tekrar sormayı önlemek (TTL)
 *  2. Sağlayıcı limitlerini aşmamak (token bucket)
 *  3. Sağlayıcı düştüğünde paneli ayakta tutmak (stale-while-error)
 *
 * Kritik davranış: fiyat alınamazsa DB'deki son bilinen fiyat
 * `stale: true` ile döner. Asla 0, null veya uydurma bir değer dönmez —
 * yanlış servet göstermektense bayat fiyat göstermek yeğdir.
 */

export const TTL_MS = {
  crypto: 60_000,
  equity: 60_000,
  fx: 12 * 60 * 60 * 1000,
} as const;

/* ------------------------------------------------------------------ */
/* Token bucket                                                        */
/* ------------------------------------------------------------------ */

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    if (elapsedSec <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
    this.lastRefill = now;
  }

  /** Token varsa alır ve true döner; yoksa false — çağıran beklemez, atlar. */
  tryTake(count = 1): boolean {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  /** Bir sonraki token için beklenmesi gereken süre (ms). */
  msUntilNextToken(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    return Math.ceil(((1 - this.tokens) / this.refillPerSec) * 1000);
  }
}

/**
 * Sağlayıcı bazlı bucket'lar. Kapasiteler resmi limitlerin altında
 * tutuldu — sınıra dayanmak 429 riski demek.
 */
const buckets: Record<string, TokenBucket> = {
  // CoinGecko anahtarsız: 10-30/dk → biz 8/dk kullanıyoruz
  coingecko: new TokenBucket(4, 8 / 60),
  // Yahoo resmi limit vermiyor; makul bir tavan koyuyoruz
  yahoo: new TokenBucket(20, 60 / 60),
  frankfurter: new TokenBucket(5, 10 / 60),
};

export function getBucket(provider: string): TokenBucket {
  return (buckets[provider] ??= new TokenBucket(10, 1));
}

/* ------------------------------------------------------------------ */
/* Ardışık hata takibi (exponential backoff)                           */
/* ------------------------------------------------------------------ */

const failures = new Map<string, { count: number; retryAfter: number }>();

export function recordFailure(provider: string): void {
  const prev = failures.get(provider);
  const count = (prev?.count ?? 0) + 1;
  // 2s, 4s, 8s ... tavan 5 dakika
  const backoffMs = Math.min(2 ** count * 1000, 5 * 60_000);
  failures.set(provider, { count, retryAfter: Date.now() + backoffMs });
}

export function recordSuccess(provider: string): void {
  failures.delete(provider);
}

export function isBackedOff(provider: string): boolean {
  const f = failures.get(provider);
  return f ? Date.now() < f.retryAfter : false;
}

/* ------------------------------------------------------------------ */
/* Kalıcı cache (SQLite)                                               */
/* ------------------------------------------------------------------ */

export interface CachedQuote extends Quote {
  /** Fiyatın kaç milisaniyedir beklediği. */
  ageMs: number;
}

export function readCache(symbols: string[]): Map<string, CachedQuote> {
  const result = new Map<string, CachedQuote>();
  if (symbols.length === 0) return result;

  const rows = db
    .select()
    .from(priceCache)
    .where(inArray(priceCache.symbol, symbols))
    .all();

  const now = Date.now();
  for (const row of rows) {
    const asOf = new Date(row.fetchedAt);
    result.set(row.symbol, {
      symbol: row.symbol,
      price: row.price,
      currency: row.currency,
      changePct24h: row.changePct24h,
      asOf,
      source: row.source,
      stale: row.stale,
      ageMs: now - asOf.getTime(),
    });
  }
  return result;
}

export function writeCache(quotes: Quote[]): void {
  if (quotes.length === 0) return;

  const rows = quotes.map((q) => ({
    symbol: q.symbol,
    price: q.price,
    currency: q.currency,
    changePct24h: q.changePct24h,
    source: q.source,
    fetchedAt: q.asOf.toISOString(),
    stale: q.stale,
  }));

  db.insert(priceCache)
    .values(rows)
    .onConflictDoUpdate({
      target: priceCache.symbol,
      set: {
        price: sql`excluded.price`,
        currency: sql`excluded.currency`,
        changePct24h: sql`excluded.change_pct_24h`,
        source: sql`excluded.source`,
        fetchedAt: sql`excluded.fetched_at`,
        stale: sql`excluded.stale`,
      },
    })
    .run();
}

/** Cache'teki kaydı bayat olarak işaretler (sağlayıcı düştüğünde). */
export function markStale(symbols: string[]): void {
  if (symbols.length === 0) return;
  db.update(priceCache)
    .set({ stale: true })
    .where(inArray(priceCache.symbol, symbols))
    .run();
}
