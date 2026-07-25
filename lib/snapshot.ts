import { randomUUID } from "node:crypto";
import { db } from "@/db/client";
import { snapshots } from "@/db/schema";
import { sql } from "drizzle-orm";
import { computeNetWorth, type NetWorth } from "@/lib/valuation";

/**
 * Günlük servet anlık görüntüsü.
 *
 * Servet eğrisi geçmişi başka türlü elde edilemez — canlı fiyatlar
 * geriye dönük hesaplanamayacağı için her günün değerini o gün
 * kaydetmek zorundayız.
 *
 * Günde bir kayıt tutulur (UNIQUE(date)); aynı gün tekrar çağrılırsa
 * kayıt güncellenir, çoğalmaz.
 */

export async function captureSnapshot(nw?: NetWorth): Promise<void> {
  const netWorth = nw ?? (await computeNetWorth());

  // Kur veya fiyatlar bayatsa anlık görüntü almayız — bayat veriyi
  // tarihe kalıcı olarak yazmak, geçmişi kalıcı olarak bozar.
  if (netWorth.fxStale) return;

  const date = new Date().toISOString().slice(0, 10);

  db.insert(snapshots)
    .values({
      id: randomUUID(),
      date,
      totalUsd: netWorth.totalUsd.toDb(),
      breakdown: {
        ...netWorth.byKind,
        __currency: JSON.stringify(netWorth.byCurrency),
      },
      createdAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: snapshots.date,
      set: {
        totalUsd: sql`excluded.total_usd`,
        breakdown: sql`excluded.breakdown`,
      },
    })
    .run();
}

export interface SnapshotPoint {
  date: string;
  totalUsd: string;
}

export function loadSnapshots(limit = 365): SnapshotPoint[] {
  return db
    .select({ date: snapshots.date, totalUsd: snapshots.totalUsd })
    .from(snapshots)
    .orderBy(snapshots.date)
    .limit(limit)
    .all();
}

/** Belirli bir gün öncesine göre değişim. Kayıt yoksa null. */
export function changeSince(days: number, currentUsd: string): string | null {
  const target = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const points = loadSnapshots();
  if (points.length === 0) return null;

  // Hedef tarihe eşit veya ondan önceki en yakın kayıt
  const past = [...points].reverse().find((p) => p.date <= target);
  if (!past) return null;

  return (Number(currentUsd) - Number(past.totalUsd)).toString();
}

let lastCaptureDate: string | null = null;

/**
 * Gün değiştiyse anlık görüntü alır. SSE tick'inden çağrılır —
 * panel açık olduğu sürece geçmiş kendiliğinden birikir, ayrı bir
 * zamanlayıcı kurmaya gerek kalmaz.
 */
export async function captureIfNewDay(nw: NetWorth): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  if (lastCaptureDate === today) return;
  lastCaptureDate = today;
  try {
    await captureSnapshot(nw);
  } catch (err) {
    console.warn("[snapshot] kaydedilemedi:", (err as Error).message);
  }
}
