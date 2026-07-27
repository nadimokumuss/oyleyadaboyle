import { startScheduler } from "./scheduler";
import { JOBS } from "./jobs";

/**
 * Arka plan zamanlayıcısını ilk sunucu isteğinde ayağa kaldırır.
 *
 * `instrumentation.ts` daha doğru yer olurdu ama Next onu edge runtime
 * için de derliyor ve SQLite oraya sığmıyor — ayrıntı `scheduler.ts`
 * içinde. Buradan çağrıldığında modül grafiği yalnızca Node tarafında
 * kalır.
 *
 * Çağrıldığı yerler bilerek iki tane: panel düzeni (giriş yapmış
 * kullanıcı) ve sağlık ucu (giriş gerektirmez, harici bir uptime
 * kontrolü de tetikleyebilir). İkisi de sunucu tarafı.
 *
 * Fonksiyon idempotent: `startScheduler` zaten çalışan bir döngü varsa
 * hemen döner, o yüzden her istekte çağrılması sorun değil.
 */
export function ensureSchedulerStarted(): void {
  try {
    startScheduler(JOBS);
  } catch (err) {
    // Zamanlayıcı başlamazsa panel yine çalışmalı — otomasyon bir
    // kolaylık, açılışın önkoşulu değil.
    console.warn("[bootstrap] zamanlayıcı başlatılamadı:", (err as Error).message);
  }
}
