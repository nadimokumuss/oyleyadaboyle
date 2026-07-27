import Decimal from "decimal.js";
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { alerts } from "@/db/schema";
import { getQuotes } from "@/lib/market/registry";
import { Money, formatMoney } from "@/lib/money";
import { record } from "./notify";

/**
 * Fiyat alarmları.
 *
 * `alerts` tablosu şemada baştan beri vardı ama hiçbir dosya onu
 * kullanmıyordu — tanımlı, boş bir söz. Burada karşılığı veriliyor.
 *
 * Alarm **tek atışlıktır**: eşik aşıldığında `firedAt` damgalanır ve
 * `active` kapanır. Aksi halde eşiğin etrafında salınan bir fiyat
 * dakikada bir bildirim üretirdi.
 */

export interface AlertInput {
  symbol: string;
  condition: "above" | "below";
  threshold: string;
  currency: string;
  note?: string | null;
}

export function createAlert(input: AlertInput): string {
  const id = randomUUID();
  db.insert(alerts)
    .values({
      id,
      symbol: input.symbol.trim().toUpperCase(),
      condition: input.condition,
      threshold: input.threshold,
      currency: input.currency,
      note: input.note ?? null,
      active: true,
    })
    .run();
  return id;
}

export function deleteAlert(id: string): void {
  db.delete(alerts).where(eq(alerts.id, id)).run();
}

export function listAlerts() {
  return db.select().from(alerts).all();
}

/** Henüz tetiklenmemiş, açık alarmlar. */
function pendingAlerts() {
  return db
    .select()
    .from(alerts)
    .where(and(eq(alerts.active, true), isNull(alerts.firedAt)))
    .all();
}

/**
 * Eşiğin aşılıp aşılmadığına karar verir.
 *
 * Ayrı ve saf tutuldu ki testten geçirilebilsin — para eşiği karşılaştırması
 * `Money` üzerinden yapılır, böylece farklı para birimleri sessizce
 * kıyaslanamaz.
 */
export function isTriggered(
  condition: "above" | "below",
  price: Decimal | string,
  threshold: Decimal | string,
): boolean {
  const p = new Decimal(price);
  const t = new Decimal(threshold);
  return condition === "above" ? p.greaterThanOrEqualTo(t) : p.lessThanOrEqualTo(t);
}

export interface AlertEvaluation {
  checked: number;
  fired: number;
  /** Fiyatı alınamayan veya para birimi uyuşmayan alarmlar. */
  skipped: number;
}

/**
 * Açık alarmları değerlendirir ve tetiklenenler için bildirim üretir.
 *
 * Bayat fiyatla tetiklemiyoruz: saatler önceki bir fiyatla "hedefe ulaştı"
 * demek yanlış bilgi vermektir; alarm bir sonraki taze fiyatı bekler.
 */
export async function evaluateAlerts(): Promise<AlertEvaluation> {
  const open = pendingAlerts();
  if (open.length === 0) return { checked: 0, fired: 0, skipped: 0 };

  const quotes = await getQuotes(open.map((a) => a.symbol));
  const bySymbol = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));

  let fired = 0;
  let skipped = 0;

  for (const alert of open) {
    const quote = bySymbol.get(alert.symbol.toUpperCase());
    if (!quote || quote.stale) {
      skipped++;
      continue;
    }

    // Kotasyon başka para biriminde geldiyse karşılaştırma anlamsız olur.
    if (quote.currency.toUpperCase() !== alert.currency.toUpperCase()) {
      skipped++;
      continue;
    }

    if (!isTriggered(alert.condition, quote.price, alert.threshold)) continue;

    const price = Money.of(quote.price, quote.currency);
    const threshold = Money.of(alert.threshold, alert.currency);
    const direction = alert.condition === "above" ? "üzerine çıktı" : "altına indi";

    db.update(alerts)
      .set({ firedAt: new Date().toISOString(), active: false })
      .where(eq(alerts.id, alert.id))
      .run();

    record({
      kind: "price_alert",
      severity: "info",
      title: `${alert.symbol} ${formatMoney(threshold)} ${direction}`,
      body:
        `Güncel fiyat ${formatMoney(price)}.` +
        (alert.note ? ` Notunuz: ${alert.note}` : ""),
      dedupeKey: `alert:${alert.id}`,
    });
    fired++;
  }

  return { checked: open.length, fired, skipped };
}
