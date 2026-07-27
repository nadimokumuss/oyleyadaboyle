import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { jobRuns, settings } from "@/db/schema";

/**
 * Arka plan zamanlayıcısı.
 *
 * Panelin en büyük eksiği edilgen olmasıydı: siz açmazsanız hiçbir şey
 * olmuyordu. Servet eğrisi yalnızca sayfa açıldığında ilerliyor, kredi
 * taksitleri elle sayılıyor, alarmlar hiç değerlendirilmiyordu.
 *
 * ## Neden tek kopya varsayılıyor
 *
 * Veritabanı tek bir SQLite dosyası ve `railway.json` içinde
 * `numReplicas: 1` sabitlenmiş durumda. İkinci bir kopya aynı diske
 * yazarsa zaten veri bozulur — zamanlayıcı bu kısıtı yaratmıyor, var
 * olana yaslanıyor. Yatay ölçeklemeye geçilirse burada bir kilit
 * (advisory lock) gerekir.
 *
 * ## Neden idempotency defteri
 *
 * Bellekteki bir bayrak yetmez: süreç yeniden başladığında sıfırlanır
 * ve o günün işi ikinci kez çalışır. Para hareketi üreten bir iş için
 * bu çift kayıt demektir. `job_runs` tablosundaki `(jobKey, runKey)`
 * benzersizliği bunu veritabanı düzeyinde imkânsız kılar.
 */

/** Döngü aralığı. Dakikada bir yeterli — işler günlük dönemlerle çalışır. */
const TICK_MS = 60_000;

/** Açılıştan sonra ilk tick'e kadar beklenen süre. */
const STARTUP_DELAY_MS = 10_000;

export interface Job {
  key: string;
  label: string;
  /**
   * İşin hangi dönem için çalıştığını belirler. Aynı `runKey` ikinci kez
   * çalıştırılmaz. Dönem gelmediyse `null` döner ve iş atlanır.
   */
  runKeyFor(now: Date): string | null;
  /** Yaptığı işin kısa özetini döner — `job_runs.message` alanına yazılır. */
  run(now: Date): Promise<string>;
}

/** Yerel takvim gününe göre YYYY-MM-DD. */
export function dayKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * İşi bu dönem için rezerve etmeye çalışır.
 *
 * Rezervasyon INSERT ile yapılır: benzersizlik ihlali "bu dönem zaten
 * işlendi" demektir. Önce SELECT edip sonra INSERT etmek yarış durumuna
 * açık olurdu; tek atomik yazma bunu kapatır.
 *
 * @returns rezervasyon kaydının id'si, ya da alınamadıysa null
 */
function claim(jobKey: string, runKey: string): string | null {
  const rowId = randomUUID();
  try {
    db.insert(jobRuns)
      .values({ id: rowId, jobKey, runKey, startedAt: new Date().toISOString() })
      .run();
    return rowId;
  } catch {
    // UNIQUE(job_key, run_key) ihlali — başka bir çalıştırma bu dönemi aldı.
    return null;
  }
}

function finish(rowId: string, ok: boolean, message: string): void {
  db.update(jobRuns)
    .set({ finishedAt: new Date().toISOString(), ok, message: message.slice(0, 500) })
    .where(eq(jobRuns.id, rowId))
    .run();
}

/**
 * Bir işi çalıştırır — dönemi gelmişse ve daha önce çalışmadıysa.
 *
 * Hata durumunda rezervasyon **silinir**, böylece bir sonraki tick tekrar
 * dener. Kalıcı olarak "çalıştı" işaretlemek geçici bir ağ hatası yüzünden
 * o günü tamamen kaybettirirdi.
 */
export async function runJob(job: Job, now = new Date()): Promise<string | null> {
  const runKey = job.runKeyFor(now);
  if (runKey === null) return null;

  const rowId = claim(job.key, runKey);
  if (rowId === null) return null;

  try {
    const message = await job.run(now);
    finish(rowId, true, message);
    return message;
  } catch (err) {
    db.delete(jobRuns).where(eq(jobRuns.id, rowId)).run();
    console.warn(`[scheduler] ${job.key} başarısız:`, (err as Error).message);
    return null;
  }
}

/** Bir işin bu dönem için çalışıp çalışmadığı — test ve arayüz için. */
export function hasRun(jobKey: string, runKey: string): boolean {
  return (
    db
      .select({ id: jobRuns.id })
      .from(jobRuns)
      .where(and(eq(jobRuns.jobKey, jobKey), eq(jobRuns.runKey, runKey)))
      .get() !== undefined
  );
}

/** Tüm işleri sırayla çalıştırır. Biri patlarsa diğerleri devam eder. */
export async function runDueJobs(jobs: Job[], now = new Date()): Promise<string[]> {
  const done: string[] = [];
  for (const job of jobs) {
    const result = await runJob(job, now);
    if (result !== null) done.push(`${job.key}: ${result}`);
  }
  return done;
}

/* ------------------------------------------------------------------ */
/* Döngü                                                               */
/* ------------------------------------------------------------------ */

const globalForScheduler = globalThis as unknown as {
  __servetSchedulerTimer?: NodeJS.Timeout;
};

function schedulerEnabled(): boolean {
  try {
    const cfg = db.select().from(settings).all()[0];
    return cfg?.schedulerEnabled ?? true;
  } catch {
    // Göçler henüz çalışmamış olabilir — o durumda sessizce beklenir.
    return false;
  }
}

/**
 * Döngüyü başlatır. `instrumentation.ts` üzerinden bir kez çağrılır.
 *
 * Dev modunda hot reload modülü yeniden çalıştırdığı için zamanlayıcı
 * `globalThis` üzerinde tutulur; yoksa her kaydetmede bir döngü daha
 * eklenir ve işler paralel çalışmaya başlar.
 */
export function startScheduler(jobs: Job[]): void {
  if (globalForScheduler.__servetSchedulerTimer) return;

  const tick = async () => {
    if (!schedulerEnabled()) return;
    try {
      const done = await runDueJobs(jobs);
      if (done.length > 0) console.info("[scheduler]", done.join(" | "));
    } catch (err) {
      console.warn("[scheduler] tick hatası:", (err as Error).message);
    }
  };

  const timer = setInterval(tick, TICK_MS);
  // Zamanlayıcı sürecin kapanmasını engellememeli.
  timer.unref?.();
  globalForScheduler.__servetSchedulerTimer = timer;

  // Açılışta hemen çalıştırmıyoruz: uygulama daha ısınıyor, fiyat
  // sağlayıcıları ve göçler hazır olmayabilir.
  setTimeout(tick, STARTUP_DELAY_MS).unref?.();
}
