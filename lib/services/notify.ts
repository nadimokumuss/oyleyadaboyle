import { randomUUID } from "node:crypto";
import { desc, eq, isNull, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { notifications, settings } from "@/db/schema";

/**
 * Bildirim kaydı ve dışarı gönderimi.
 *
 * İki iş ayrı tutulur ve sırası önemlidir: önce **kaydedilir**, sonra
 * gönderilmeye çalışılır. Webhook çalışmasa da bildirim kaybolmaz;
 * kullanıcı paneli açtığında kaçırdığını görür. Tersi sırada bir ağ
 * hatası uyarıyı tamamen yok ederdi.
 */

export type NotificationKind =
  | "price_alert"
  | "portfolio"
  | "recurring"
  | "loan"
  | "system";

export type NotificationSeverity = "info" | "warn" | "critical";

export interface NotificationInput {
  kind: NotificationKind;
  severity?: NotificationSeverity;
  title: string;
  body?: string;
  /**
   * Aynı olayın tekrarını engeller. Verilirse ve aynı anahtarla bir kayıt
   * varsa yenisi yazılmaz — "nakit eşiğin altında" uyarısını her dakika
   * tekrarlamak bildirimleri işe yaramaz hale getirirdi.
   */
  dedupeKey?: string;
}

/**
 * Bildirimi kaydeder.
 *
 * @returns yeni kayıt oluştuysa id, dedupe nedeniyle atlandıysa null
 */
export function record(input: NotificationInput): string | null {
  const id = randomUUID();
  try {
    db.insert(notifications)
      .values({
        id,
        kind: input.kind,
        severity: input.severity ?? "info",
        title: input.title,
        body: input.body ?? null,
        dedupeKey: input.dedupeKey ?? null,
        createdAt: new Date().toISOString(),
      })
      .run();
    return id;
  } catch {
    // UNIQUE(dedupe_key) ihlali — bu olay zaten bildirilmiş.
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Webhook gönderimi                                                    */
/* ------------------------------------------------------------------ */

/** Ağ takılırsa zamanlayıcı tick'ini kilitlemesin. */
const DELIVERY_TIMEOUT_MS = 8_000;

export function webhookUrl(): string | null {
  const cfg = db.select().from(settings).all()[0];
  const url = cfg?.webhookUrl?.trim();
  return url ? url : null;
}

export interface WebhookPayload {
  kind: string;
  severity: string;
  title: string;
  body: string | null;
  at: string;
  /** Telegram/Discord gibi düz metin bekleyen uçlar için hazır metin. */
  text: string;
}

export async function postWebhook(
  url: string,
  payload: WebhookPayload,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Henüz gönderilmemiş bildirimleri webhook'a yollar.
 *
 * Başarısızlık kaydın üzerine yazılır (`deliveryError`) ama kayıt
 * "gönderildi" işaretlenmez — bir sonraki tur yeniden dener.
 *
 * @returns gönderilen bildirim sayısı
 */
export async function flushPending(limit = 20): Promise<number> {
  const url = webhookUrl();
  if (!url) return 0;

  const pending = db
    .select()
    .from(notifications)
    .where(isNull(notifications.deliveredAt))
    .orderBy(notifications.createdAt)
    .limit(limit)
    .all();

  let sent = 0;
  for (const n of pending) {
    try {
      await postWebhook(url, {
        kind: n.kind,
        severity: n.severity,
        title: n.title,
        body: n.body,
        at: n.createdAt,
        text: n.body ? `${n.title}\n${n.body}` : n.title,
      });
      db.update(notifications)
        .set({ deliveredAt: new Date().toISOString(), deliveryError: null })
        .where(eq(notifications.id, n.id))
        .run();
      sent++;
    } catch (err) {
      db.update(notifications)
        .set({ deliveryError: (err as Error).message.slice(0, 200) })
        .where(eq(notifications.id, n.id))
        .run();
      // İlk hatada duruyoruz: uç kapalıysa 20 isteğin hepsi de başarısız
      // olacak, boşuna beklemenin anlamı yok.
      break;
    }
  }
  return sent;
}

/* ------------------------------------------------------------------ */
/* Okuma                                                                */
/* ------------------------------------------------------------------ */

export function recent(limit = 30) {
  return db
    .select()
    .from(notifications)
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .all();
}

export function unreadCount(): number {
  return db
    .select({ id: notifications.id })
    .from(notifications)
    .where(isNull(notifications.readAt))
    .all().length;
}

export function markAllRead(): void {
  db.update(notifications)
    .set({ readAt: new Date().toISOString() })
    .where(isNull(notifications.readAt))
    .run();
}

/**
 * Eski bildirimleri siler — günlük sonsuza kadar büyümemeli.
 *
 * Dedupe anahtarları da bu sayede serbest kalır: bir yıl önceki
 * "nakit düşük" uyarısı yüzünden bugünkü uyarının bastırılması yanlış olurdu.
 */
export function prune(olderThanDays = 90): number {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  const doomed = db
    .select({ id: notifications.id })
    .from(notifications)
    .where(lt(notifications.createdAt, cutoff))
    .all();
  if (doomed.length === 0) return 0;
  db.delete(notifications).where(lt(notifications.createdAt, cutoff)).run();
  return doomed.length;
}
