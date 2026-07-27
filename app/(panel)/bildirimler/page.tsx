import { PageShell, Card, EmptyState } from "@/components/PageShell";
import { db } from "@/db/client";
import { jobRuns } from "@/db/schema";
import { desc } from "drizzle-orm";
import { recent, unreadCount, webhookUrl } from "@/lib/services/notify";
import { MarkReadButton } from "@/components/forms/MarkReadButton";
import Link from "next/link";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  price_alert: "Fiyat alarmı",
  portfolio: "Portföy",
  recurring: "Düzenli hareket",
  loan: "Kredi",
  system: "Sistem",
};

const SEVERITY_STYLE: Record<string, string> = {
  info: "border-line text-ink-muted",
  warn: "border-warn/50 text-warn",
  critical: "border-loss/50 text-loss",
};

export default function BildirimlerPage() {
  const items = recent(50);
  const unread = unreadCount();
  const hook = webhookUrl();

  // Zamanlayıcının gerçekten çalıştığını görebilmek önemli: bildirim
  // gelmiyorsa sorun kuralda mı, zamanlayıcıda mı ayırt edilebilmeli.
  const runs = db
    .select()
    .from(jobRuns)
    .orderBy(desc(jobRuns.startedAt))
    .limit(12)
    .all();

  return (
    <PageShell
      title="Bildirimler"
      subtitle="Panel kapalıyken olup bitenler."
      actions={unread > 0 ? <MarkReadButton count={unread} /> : undefined}
    >
      <div className="space-y-4">
        {!hook && (
          <div className="rounded-md border border-line bg-surface-raised px-3 py-2.5">
            <p className="text-pretty text-xs text-ink-muted">
              Bildirimler şu an yalnızca burada birikiyor. Telefonunuza
              düşmesi için{" "}
              <Link href="/ayarlar" className="text-accent underline">
                Ayarlar
              </Link>{" "}
              sayfasından bir webhook adresi tanımlayın.
            </p>
          </div>
        )}

        {items.length === 0 ? (
          <EmptyState
            title="Henüz bildirim yok"
            description="Fiyat alarmı kurduğunuzda, düzenli bir hareket işlendiğinde veya tutarlılık denetimi bir sorun bulduğunda burada görürsünüz."
            action={
              <Link
                href="/kesfet"
                className="inline-flex items-center rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink hover:bg-surface-hover"
              >
                Alarm kurmak için Keşfet'e git
              </Link>
            }
          />
        ) : (
          <ul className="space-y-2">
            {items.map((n) => (
              <li
                key={n.id}
                className={cn(
                  "rounded-lg border bg-surface-raised p-3.5",
                  n.readAt ? "border-line" : "border-accent/40",
                )}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-pretty text-sm font-medium text-ink">{n.title}</p>
                  <span className="num shrink-0 text-xs text-ink-faint">
                    {new Date(n.createdAt).toLocaleString("tr-TR")}
                  </span>
                </div>

                {n.body && (
                  <p className="mt-1 text-pretty text-xs text-ink-muted">{n.body}</p>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                  <span
                    className={cn(
                      "rounded border px-1.5 py-0.5",
                      SEVERITY_STYLE[n.severity] ?? SEVERITY_STYLE.info,
                    )}
                  >
                    {KIND_LABEL[n.kind] ?? n.kind}
                  </span>
                  {hook &&
                    (n.deliveredAt ? (
                      <span className="text-ink-faint">gönderildi</span>
                    ) : n.deliveryError ? (
                      <span className="text-loss">
                        gönderilemedi: {n.deliveryError}
                      </span>
                    ) : (
                      <span className="text-ink-faint">gönderim bekliyor</span>
                    ))}
                </div>
              </li>
            ))}
          </ul>
        )}

        <Card title="Zamanlayıcı" hint="son çalışmalar">
          {runs.length === 0 ? (
            <p className="text-pretty text-sm text-ink-faint">
              Henüz bir iş çalışmadı. Zamanlayıcı uygulama açıldıktan kısa süre
              sonra devreye girer; Ayarlar sayfasından kapatılmış da olabilir.
            </p>
          ) : (
            <ul className="space-y-1">
              {runs.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs"
                >
                  <span className="text-ink-muted">
                    {r.jobKey}{" "}
                    <span className="text-ink-faint">· {r.runKey}</span>
                  </span>
                  <span
                    className={cn(
                      "num",
                      r.ok === false ? "text-loss" : "text-ink-faint",
                    )}
                  >
                    {r.message ?? (r.finishedAt ? "—" : "çalışıyor")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </PageShell>
  );
}
