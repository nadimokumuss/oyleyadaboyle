/**
 * Next.js açılış kancası — süreç başına bir kez çalışır.
 *
 * Arka plan zamanlayıcısı buradan başlatılır. Bir sayfa veya API ucundan
 * başlatmak yanlış olurdu: o zaman zamanlayıcı ancak biri paneli açtığında
 * hayat bulurdu, ki tam da çözmeye çalıştığı sorun bu.
 */
export async function register() {
  // Edge runtime'da SQLite ve setInterval yok; yalnızca Node.js tarafında.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Derleme sırasında (next build) sayfa toplama adımı da bu dosyayı
  // çalıştırır — o sırada zamanlayıcı açmanın anlamı yok.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { startScheduler } = await import("@/lib/scheduler");
  const { JOBS } = await import("@/lib/jobs");

  startScheduler(JOBS);
  console.info(`[scheduler] ${JOBS.length} iş kaydedildi`);
}
