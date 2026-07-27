import { dayKey, type Job } from "@/lib/scheduler";
import { computeNetWorth } from "@/lib/valuation";
import { captureSnapshotFor } from "@/lib/snapshot";
import { evaluateAlerts } from "@/lib/services/alerts";
import { runDueRecurring } from "@/lib/services/recurring";
import { runLoanAutopay } from "@/lib/services/loanAutopay";
import { flushPending, prune, record } from "@/lib/services/notify";
import { runAudit } from "@/lib/services/audit";

/**
 * Zamanlayıcının çalıştırdığı işler.
 *
 * Sıra önemli: önce para hareketi üretenler (tekrarlayanlar, taksitler),
 * sonra bunların sonucunu gören anlık görüntü ve denetim, en sonda
 * bildirimlerin dışarı gönderimi.
 */

/** Dakikada bir çalışabilen işler için: her tick ayrı bir dönemdir. */
function minuteKey(now: Date): string {
  return `${dayKey(now)}T${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes(),
  ).padStart(2, "0")}`;
}

/**
 * Düzenli hareketler — günde bir.
 *
 * `runDueRecurring` kendi başına da idempotent (`nextRunDate` ilerler),
 * ama günlük anahtar gereksiz DB gezintisini de önler.
 */
const recurringJob: Job = {
  key: "recurring",
  label: "Düzenli hareketler",
  runKeyFor: dayKey,
  async run(now) {
    const r = runDueRecurring(now);
    return `${r.generated} kayıt / ${r.templates} şablon`;
  },
};

/** Kredi taksitleri — günde bir. */
const loanJob: Job = {
  key: "loanAutopay",
  label: "Kredi taksitleri",
  runKeyFor: dayKey,
  async run(now) {
    const r = runLoanAutopay(now);
    return `${r.installments} taksit / ${r.baselined} referans alma`;
  },
};

/**
 * Günlük servet anlık görüntüsü.
 *
 * Eskiden yalnızca SSE tick'inden alınıyordu, yani paneli açmadığınız
 * günler servet eğrisinde delik kalıyordu. Artık panel kapalıyken de birikir.
 */
const snapshotJob: Job = {
  key: "snapshot",
  label: "Servet anlık görüntüsü",
  runKeyFor: dayKey,
  async run() {
    const nw = await computeNetWorth();
    const saved = await captureSnapshotFor(nw);
    return saved ? "kaydedildi" : "atlandı (veri bayat)";
  },
};

/**
 * Fiyat alarmları — beş dakikada bir.
 *
 * Daha sık çalıştırmanın anlamı yok: fiyat önbelleğinin TTL'i zaten
 * bunun altında değil, sağlayıcı hız sınırına takılmak da istemeyiz.
 */
const alertJob: Job = {
  key: "alerts",
  label: "Fiyat alarmları",
  runKeyFor(now) {
    if (now.getMinutes() % 5 !== 0) return null;
    return minuteKey(now);
  },
  async run() {
    const r = await evaluateAlerts();
    return `${r.fired} tetiklendi / ${r.checked} kontrol / ${r.skipped} atlandı`;
  },
};

/**
 * Tutarlılık denetimi — günde bir.
 *
 * `runAudit` komuta ekranında zaten çalışıyor ama yalnızca panel
 * açıkken. Nakdin eksiye düşmesi gibi bir durumu fark etmek için
 * kullanıcının o sayfaya gelmesini beklememeliyiz.
 */
const auditJob: Job = {
  key: "audit",
  label: "Tutarlılık denetimi",
  runKeyFor: dayKey,
  async run(now) {
    const findings = runAudit();
    const serious = findings.filter((f) => f.severity !== "info");
    if (serious.length > 0) {
      record({
        kind: "portfolio",
        severity: serious.some((f) => f.severity === "error") ? "critical" : "warn",
        title: `${serious.length} tutarlılık uyarısı`,
        body: serious.map((f) => f.title).join(" · "),
        dedupeKey: `audit:${dayKey(now)}`,
      });
    }
    return `${serious.length} uyarı`;
  },
};

/** Bildirim gönderimi ve günlük temizliği — her dakika denenir. */
const deliveryJob: Job = {
  key: "notifyDelivery",
  label: "Bildirim gönderimi",
  runKeyFor: minuteKey,
  async run(now) {
    const sent = await flushPending();
    // Temizlik günde bir yeter.
    const pruned = now.getHours() === 4 && now.getMinutes() === 0 ? prune() : 0;
    return `${sent} gönderildi${pruned ? `, ${pruned} eski kayıt silindi` : ""}`;
  },
};

export const JOBS: Job[] = [
  recurringJob,
  loanJob,
  snapshotJob,
  auditJob,
  alertJob,
  deliveryJob,
];
