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

/**
 * Anlık görüntüyü yazar.
 *
 * @returns yazıldıysa true, bayat veri nedeniyle atlandıysa false
 */
export async function captureSnapshotFor(nw?: NetWorth): Promise<boolean> {
  const netWorth = nw ?? (await computeNetWorth());

  // Kur veya fiyatlar bayatsa anlık görüntü almayız — bayat veriyi
  // tarihe kalıcı olarak yazmak, geçmişi kalıcı olarak bozar.
  if (netWorth.fxStale) return false;

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

  return true;
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
    await captureSnapshotFor(nw);
  } catch (err) {
    console.warn("[snapshot] kaydedilemedi:", (err as Error).message);
  }
}
