import { randomUUID } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { assets, recurringTransactions, transactions } from "@/db/schema";
import { record } from "./notify";

/**
 * Tekrarlayan para hareketleri: maaş, kira, abonelik, düzenli yatırım.
 *
 * Şablon `recurring_transactions` tablosunda durur; üretilen kayıt normal
 * bir `transactions` satırıdır. Bu bilinçli: otomatik üretilen hareket
 * elle girilmiş olandan hiçbir şekilde ayrışmaz — aynı listede görünür,
 * aynı şekilde geri alınır, aynı hesaba girer.
 *
 * ## Tarih ilerletmesi neden çapaya dayanıyor
 *
 * "Bir sonraki tarihe bir ay ekle" saf hâliyle kayar: 31 Ocak → 28 Şubat
 * → 28 Mart olur ve ayın 31'i bir daha asla gelmez. Bunun yerine her
 * tekrar `startDate` çapasından hesaplanır (`çapa + n ay`), ayın son günü
 * kısaysa o aya sığdırılır ama çapa bozulmaz.
 */

export type Frequency = "weekly" | "monthly" | "quarterly" | "yearly";

/** Tek çalıştırmada üretilecek azami kayıt — kaçak döngüye karşı emniyet. */
const MAX_OCCURRENCES_PER_RUN = 500;

/* ------------------------------------------------------------------ */
/* Tarih aritmetiği — saf, test edilebilir                             */
/* ------------------------------------------------------------------ */

export function parseDay(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function formatDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * Çapaya n periyot ekler.
 *
 * Ay sonu taşması kırpılır: 31 Ocak çapasının 1 ay sonrası 28/29 Şubat,
 * 2 ay sonrası yine 31 Mart olur — kayma yok.
 */
export function addPeriods(anchor: Date, frequency: Frequency, n: number): Date {
  if (frequency === "weekly") {
    const d = new Date(anchor);
    d.setDate(d.getDate() + 7 * n);
    return d;
  }

  const monthsPer = frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : 12;
  const totalMonths = anchor.getMonth() + monthsPer * n;
  const year = anchor.getFullYear() + Math.floor(totalMonths / 12);
  const month = ((totalMonths % 12) + 12) % 12;
  const day = Math.min(anchor.getDate(), daysInMonth(year, month));
  return new Date(year, month, day);
}

/**
 * `current` tarihinden sonraki ilk tekrar tarihi.
 *
 * Çapadan kaç periyot geçtiğini bulup bir sonrakini döner; böylece
 * arka arkaya ilerletmelerde hata birikmez.
 */
export function nextOccurrence(
  anchorIso: string,
  frequency: Frequency,
  currentIso: string,
): string {
  const anchor = parseDay(anchorIso);
  const current = parseDay(currentIso);

  let n = 0;
  let candidate = anchor;
  // Çapa geleceği gösteriyorsa ilk tekrar çapanın kendisidir.
  while (candidate <= current && n < MAX_OCCURRENCES_PER_RUN * 4) {
    n++;
    candidate = addPeriods(anchor, frequency, n);
  }
  return formatDay(candidate);
}

/* ------------------------------------------------------------------ */
/* CRUD                                                                */
/* ------------------------------------------------------------------ */

export interface RecurringInput {
  id?: string;
  assetId: string;
  label: string;
  type: "dividend" | "interest" | "rent" | "staking" | "expense" | "fee" | "tax" | "deposit_in" | "withdraw";
  amount: string;
  currency: string;
  frequency: Frequency;
  startDate: string;
  endDate?: string | null;
  note?: string | null;
  active?: boolean;
}

export function saveRecurring(input: RecurringInput): string {
  const id = input.id ?? randomUUID();
  const now = new Date().toISOString();
  const existing = input.id
    ? db.select().from(recurringTransactions).where(eq(recurringTransactions.id, input.id)).get()
    : undefined;

  // Yeni kayıtta ilk üretim `startDate`in kendisidir; düzenlemede
  // sıradaki tarih korunur ki geçmiş yeniden üretilmesin.
  const nextRunDate = existing?.nextRunDate ?? input.startDate;

  const values = {
    assetId: input.assetId,
    label: input.label,
    type: input.type,
    amount: input.amount,
    currency: input.currency,
    frequency: input.frequency,
    startDate: input.startDate,
    endDate: input.endDate ?? null,
    nextRunDate,
    active: input.active ?? true,
    note: input.note ?? null,
    updatedAt: now,
  };

  if (existing) {
    db.update(recurringTransactions).set(values).where(eq(recurringTransactions.id, id)).run();
  } else {
    db.insert(recurringTransactions).values({ id, ...values, createdAt: now }).run();
  }
  return id;
}

export function deleteRecurring(id: string): void {
  db.delete(recurringTransactions).where(eq(recurringTransactions.id, id)).run();
}

export function listRecurring() {
  return db
    .select({
      rec: recurringTransactions,
      assetName: assets.name,
    })
    .from(recurringTransactions)
    .innerJoin(assets, eq(recurringTransactions.assetId, assets.id))
    .all();
}

/* ------------------------------------------------------------------ */
/* Çalıştırma                                                          */
/* ------------------------------------------------------------------ */

export interface RecurringRunResult {
  generated: number;
  templates: number;
}

/**
 * Vadesi gelmiş tüm tekrarları işler.
 *
 * ## Idempotency
 *
 * Her tekrar için kayıt yazma ve `nextRunDate` ilerletme **tek
 * transaction** içindedir. Arada süreç ölürse ikisi de geri alınır;
 * yeniden çalıştığında aynı tarihi bir kez daha üretir, iki kez değil.
 *
 * Zamanlayıcı ayrıca günde bir çalışacak şekilde anahtarlanmıştır
 * (`job_runs`), yani bu fonksiyon normalde günde bir kez çağrılır —
 * ama iki kez çağrılsa bile `nextRunDate > bugün` olduğu için ikinci
 * çağrı hiçbir şey üretmez.
 */
export function runDueRecurring(now = new Date()): RecurringRunResult {
  const today = formatDay(now);

  const due = db
    .select()
    .from(recurringTransactions)
    .where(
      and(
        eq(recurringTransactions.active, true),
        lte(recurringTransactions.nextRunDate, today),
      ),
    )
    .all();

  let generated = 0;

  for (const rec of due) {
    let guard = 0;
    let cursor = rec.nextRunDate;

    while (cursor <= today && guard < MAX_OCCURRENCES_PER_RUN) {
      // Bitiş tarihi geçtiyse şablon kapanır, kayıt üretilmez.
      if (rec.endDate && cursor > rec.endDate) {
        db.update(recurringTransactions)
          .set({ active: false, updatedAt: new Date().toISOString() })
          .where(eq(recurringTransactions.id, rec.id))
          .run();
        break;
      }

      const occurrence = cursor;
      const advanced = nextOccurrence(rec.startDate, rec.frequency as Frequency, occurrence);

      db.transaction((tx) => {
        tx.insert(transactions)
          .values({
            id: randomUUID(),
            assetId: rec.assetId,
            type: rec.type,
            date: occurrence,
            amount: rec.amount,
            currency: rec.currency,
            fxRateToUsd: rec.currency.toUpperCase() === "USD" ? "1" : null,
            note: `${rec.label} (otomatik)`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          .run();

        tx.update(recurringTransactions)
          .set({
            nextRunDate: advanced,
            lastRunAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(recurringTransactions.id, rec.id))
          .run();
      });

      generated++;
      guard++;
      cursor = advanced;
    }
  }

  if (generated > 0) {
    record({
      kind: "recurring",
      severity: "info",
      title: `${generated} düzenli hareket işlendi`,
      body: "İşlemler sayfasından her birini görebilir ve geri alabilirsiniz.",
      dedupeKey: `recurring:${today}`,
    });
  }

  return { generated, templates: due.length };
}
