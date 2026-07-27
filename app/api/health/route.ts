import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import { ensureSchedulerStarted } from "@/lib/bootstrap";

export const dynamic = "force-dynamic";

/**
 * Sağlık kontrolü — konteyner düzenleyicisi bunu yoklar.
 *
 * Kimlik doğrulaması YOK: sağlık kontrolünün giriş yapması beklenemez.
 * Karşılığında hiçbir finansal veri sızdırmaz, yalnızca "veritabanına
 * erişebiliyor muyum" sorusunu cevaplar.
 *
 * Ayrıca arka plan zamanlayıcısını ayağa kaldırır: konteyner düzenleyicisi
 * bu ucu zaten düzenli yokladığı için, yeniden başlatmadan sonra kimse
 * paneli açmasa bile otomasyon çalışmaya başlar.
 */
export async function GET() {
  try {
    db.get(sql`SELECT 1`);
    ensureSchedulerStarted();
    return NextResponse.json({ ok: true, at: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 503 },
    );
  }
}
