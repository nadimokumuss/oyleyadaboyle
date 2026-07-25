import Decimal from "decimal.js";
import { db } from "@/db/client";
import { fxRates } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { fetchFxRates, TRACKED_CURRENCIES } from "./frankfurter";
import { getBucket, isBackedOff, recordFailure, recordSuccess, TTL_MS } from "./cache";
import { FxConverter } from "@/lib/fx";

/**
 * Kur tablosunun kalıcı hali. Frankfurter günlük yayınladığı için TTL
 * uzun; internet yoksa DB'deki son tablo kullanılır.
 *
 * Panelin hiçbir yerinde kur olmadan hesap yapılmaz — kur tablosu
 * boşsa net servet hesaplanamaz. Bu yüzden bir kez çekilen tablo
 * kalıcı olarak saklanır ve asla silinmez.
 */

let memo: { converter: FxConverter; fetchedAt: number; stale: boolean } | null = null;

export interface FxState {
  converter: FxConverter;
  /** Kur tablosunun ait olduğu tarih. */
  date: string;
  stale: boolean;
  ageMs: number;
}

function readLatestFromDb(): { rates: Record<string, string>; date: string } | null {
  const rows = db
    .select()
    .from(fxRates)
    .where(eq(fxRates.base, "USD"))
    .orderBy(desc(fxRates.date))
    .all();

  if (rows.length === 0) return null;

  const latestDate = rows[0].date;
  const rates: Record<string, string> = { USD: "1" };
  for (const row of rows) {
    if (row.date === latestDate) rates[row.quote] = row.rate;
  }
  return { rates, date: latestDate };
}

function persist(rates: Record<string, string>, date: string, source: string): void {
  const values = Object.entries(rates)
    .filter(([code]) => code !== "USD")
    .map(([quote, rate]) => ({
      id: randomUUID(),
      base: "USD",
      quote,
      rate,
      date,
      source,
    }));
  if (values.length === 0) return;

  db.insert(fxRates).values(values).onConflictDoNothing().run();
}

/**
 * Güncel kur çeviricisini döner. Tazeyse cache'ten, değilse çekmeyi
 * dener; çekemezse DB'deki son tabloyu `stale: true` ile döner.
 */
export async function getFx(): Promise<FxState> {
  const now = Date.now();

  if (memo && now - memo.fetchedAt < TTL_MS.fx && !memo.stale) {
    return {
      converter: memo.converter,
      date: memo.converter.asOf.toISOString().slice(0, 10),
      stale: false,
      ageMs: now - memo.fetchedAt,
    };
  }

  const bucket = getBucket("frankfurter");
  const canFetch = !isBackedOff("frankfurter") && bucket.tryTake();

  if (canFetch) {
    try {
      const snapshot = await fetchFxRates(TRACKED_CURRENCIES);
      persist(snapshot.rates, snapshot.date, snapshot.source);
      recordSuccess("frankfurter");
      const converter = new FxConverter(snapshot.rates, new Date(snapshot.date));
      memo = { converter, fetchedAt: now, stale: false };
      return { converter, date: snapshot.date, stale: false, ageMs: 0 };
    } catch (err) {
      recordFailure("frankfurter");
      console.warn("[fx] kur çekilemedi:", (err as Error).message);
    }
  }

  // Çekemedik — DB'deki son tabloya düş
  const fallback = readLatestFromDb();
  if (fallback) {
    const converter = new FxConverter(fallback.rates, new Date(fallback.date));
    memo = { converter, fetchedAt: now, stale: true };
    return {
      converter,
      date: fallback.date,
      stale: true,
      ageMs: now - new Date(fallback.date).getTime(),
    };
  }

  throw new Error(
    "Kur tablosu yok ve çekilemiyor. İnternet bağlantısını kontrol edin — " +
      "ilk kurulumda en az bir kez kur çekilmesi gerekir.",
  );
}

/* ------------------------------------------------------------------ */
/* Geçmiş tarihli kur                                                  */
/* ------------------------------------------------------------------ */

/**
 * Belirli bir tarihteki "1 birim yerel para = kaç USD" kurunu döner.
 *
 * Önce DB'ye bakar, yoksa Frankfurter'ın o tarihe ait kaydını çekip
 * kalıcı olarak saklar. Böylece geçmiş alımların kur etkisi
 * ayrıştırması gerçek veriyle hesaplanabilir — tahminle değil.
 *
 * Bulunamazsa null döner; çağıran taraf "hesaplanamadı" demeli,
 * bugünkü kuru geçmişe uygulamamalı.
 */
export async function historicalUsdRate(
  currency: string,
  date: string,
): Promise<string | null> {
  const code = currency.toUpperCase();
  if (code === "USD") return "1";

  const day = date.slice(0, 10);

  // 1) Zaten kayıtlı mı?
  const cached = db
    .select()
    .from(fxRates)
    .where(and(eq(fxRates.base, "USD"), eq(fxRates.quote, code), eq(fxRates.date, day)))
    .get();

  if (cached) return invert(cached.rate);

  // 2) Frankfurter'dan çek
  const bucket = getBucket("frankfurter");
  if (isBackedOff("frankfurter") || !bucket.tryTake()) return null;

  try {
    const url =
      `https://api.frankfurter.dev/v1/${encodeURIComponent(day)}` +
      `?base=USD&symbols=${encodeURIComponent(code)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = (await res.json()) as {
      date: string;
      rates: Record<string, number>;
    };
    const perUsd = data.rates?.[code];
    if (typeof perUsd !== "number" || perUsd <= 0) return null;

    // Frankfurter hafta sonu/tatilde en yakın iş gününü döndürür;
    // gerçekte hangi güne ait olduğunu o günün tarihiyle kaydediyoruz
    persist({ [code]: String(perUsd) }, data.date, "frankfurter");
    // İstenen gün için de kayıt bırak ki bir daha ağa çıkılmasın
    if (data.date !== day) {
      persist({ [code]: String(perUsd) }, day, "frankfurter");
    }

    recordSuccess("frankfurter");
    return invert(String(perUsd));
  } catch {
    recordFailure("frankfurter");
    return null;
  }
}

/** 1 USD = X yerel → 1 yerel = kaç USD */
function invert(perUsd: string): string {
  const d = new Decimal(perUsd);
  return d.greaterThan(0) ? new Decimal(1).dividedBy(d).toFixed() : "0";
}
