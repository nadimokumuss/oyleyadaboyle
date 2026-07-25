import { PageShell, EmptyState } from "@/components/PageShell";
import { scan } from "@/lib/engine/scan";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import type { Severity } from "@/lib/engine/types";

export const dynamic = "force-dynamic";

const SEVERITY: Record<Severity, { label: string; card: string; badge: string }> = {
  critical: {
    label: "kritik",
    card: "border-loss/50",
    badge: "border-loss/50 text-loss",
  },
  high: {
    label: "yüksek",
    card: "border-warn/50",
    badge: "border-warn/50 text-warn",
  },
  medium: {
    label: "orta",
    card: "border-line",
    badge: "border-line text-ink-muted",
  },
  info: {
    label: "bilgi",
    card: "border-line",
    badge: "border-line text-ink-faint",
  },
};

export default async function FirsatlarPage() {
  const result = await scan();

  return (
    <PageShell
      title="Fırsatlar"
      subtitle="Portföyünüz her tazelemede taranır; bulunan her şey somut sayılarla gösterilir."
    >
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Bulunan fırsat" value={String(result.opportunities.length)} />
        <Stat
          label="Tahmini aylık kazanç"
          value={
            result.totalMonthlyGain.isPositive()
              ? formatMoney(result.totalMonthlyGain)
              : "—"
          }
          sub="ölçülebilen fırsatlar"
          tone={result.totalMonthlyGain.isPositive() ? "gain" : undefined}
        />
        <Stat
          label="Çalıştırılan kural"
          value={String(result.ruleCount)}
          sub={
            result.failedRules.length > 0
              ? `${result.failedRules.length} kural hata verdi`
              : "hepsi başarılı"
          }
          tone={result.failedRules.length > 0 ? "loss" : undefined}
        />
      </div>

      {result.failedRules.length > 0 && (
        <div className="mb-4 rounded-lg border border-loss/40 bg-loss/10 px-4 py-3">
          <p className="text-sm font-medium text-loss">Bazı kurallar çalıştırılamadı</p>
          <ul className="mt-1 space-y-0.5">
            {result.failedRules.map((f) => (
              <li key={f.key} className="text-pretty text-xs text-ink-muted">
                <code className="text-ink">{f.key}</code>: {f.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.opportunities.length === 0 ? (
        <EmptyState
          title="Şu an bir fırsat bulunamadı"
          description="Tüm kurallar çalıştı ve tetiklenen olmadı. Portföyünüz tanımlı eşiklerin içinde görünüyor."
          action={
            <a
              href="/"
              className="inline-flex items-center rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Komuta ekranına dön
            </a>
          }
        />
      ) : (
        <ul className="space-y-3">
          {result.opportunities.map((o) => {
            const s = SEVERITY[o.severity];
            return (
              <li
                key={o.id}
                className={cn(
                  "rounded-lg border bg-surface-raised p-5",
                  s.card,
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h2 className="text-balance text-sm font-medium text-ink">{o.title}</h2>
                  <div className="flex shrink-0 items-center gap-2">
                    {o.estimatedMonthlyGain && (
                      <span className="num text-sm font-medium text-gain">
                        +{formatMoney(o.estimatedMonthlyGain, { compact: true })}/ay
                      </span>
                    )}
                    <span
                      className={cn(
                        "rounded border px-1.5 py-0.5 text-[11px]",
                        s.badge,
                      )}
                    >
                      {s.label}
                    </span>
                  </div>
                </div>

                <p className="num mt-2 text-pretty text-sm text-ink-muted">{o.detail}</p>

                <p className="mt-3 text-pretty text-sm text-ink">
                  <span className="text-ink-faint">Öneri: </span>
                  {o.action}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-6 text-pretty text-xs text-ink-faint">
        Bu kartlar hesaplamaya dayalı bilgilendirmedir, yatırım tavsiyesi değildir.
        Eşikler ve enflasyon varsayımları ayarlar tablosundan değiştirilebilir;
        sonuçlar bu varsayımlara duyarlıdır.
      </p>
    </PageShell>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "gain" | "loss";
}) {
  return (
    <div className="rounded-lg border border-line bg-surface-raised p-4">
      <p className="truncate text-xs text-ink-faint">{label}</p>
      <p
        className={cn(
          "num mt-1 text-xl font-semibold",
          tone === "gain" && "text-gain",
          tone === "loss" && "text-loss",
          !tone && "text-ink",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 truncate text-xs text-ink-faint">{sub}</p>}
    </div>
  );
}
