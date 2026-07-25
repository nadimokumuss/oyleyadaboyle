import Decimal from "decimal.js";
import { PageShell, EmptyState } from "@/components/PageShell";
import { loadVentures } from "@/lib/finance/cashflowService";
import { listCashAccounts } from "@/lib/services/funding";
import { DisposeButton } from "@/components/DisposeButton";
import Link from "next/link";
import { Money, formatMoney, formatPercent, formatNumber } from "@/lib/money";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

export default async function GirisimPage() {
  const ventures = await loadVentures();
  const cashAccounts = listCashAccounts();

  if (ventures.length === 0) {
    return (
      <PageShell title="Girişim" subtitle="Burn rate, runway ve değerleme takibi.">
        <EmptyState
          title="Kayıtlı girişim yok"
          description="Demo senaryoyu yükleyerek örnek girişimleri görebilirsiniz."
          action={
            <code className="inline-block rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink-muted">
              npm run db:seed
            </code>
          }
        />
      </PageShell>
    );
  }

  const totalValue = ventures.reduce(
    (a, v) => a.plus(Money.of(v.positionValueUsd, "USD")),
    Money.zero("USD"),
  );
  const alerts = ventures.filter((v) => v.alert !== "ok");

  // En kritik olan en üstte
  const sorted = [...ventures].sort((a, b) => {
    const rank = { critical: 0, warning: 1, ok: 2 };
    return rank[a.alert] - rank[b.alert];
  });

  return (
    <PageShell
      title="Girişim"
      subtitle="Girişimlerde asıl soru kâr değil, ne kadar zaman kaldığıdır."
    >
      {alerts.length > 0 && (
        <div className="mb-4 rounded-lg border border-loss/40 bg-loss/10 px-4 py-3">
          <p className="text-sm font-medium text-loss">
            {alerts.length} girişimde runway uyarısı
          </p>
          <ul className="mt-1 space-y-0.5">
            {alerts.map((v) => (
              <li key={v.assetId} className="num text-pretty text-xs text-ink-muted">
                <span className="text-ink">{v.name}</span> —{" "}
                {v.runwayMonths
                  ? `${formatNumber(v.runwayMonths, 1)} ay yakıt kaldı`
                  : "nakit tükendi"}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-4 rounded-lg border border-line bg-surface-raised p-4">
        <p className="text-xs text-ink-faint">Toplam girişim değeri</p>
        <p className="num mt-1 text-xl font-semibold text-ink">{formatMoney(totalValue)}</p>
        <p className="mt-0.5 text-xs text-ink-faint">
          {ventures.length} girişim · sahiplik payına göre
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {sorted.map((v) => {
          const runway = v.runwayMonths ? new Decimal(v.runwayMonths) : null;
          const moic = v.moic ? new Decimal(v.moic) : null;
          const progress = v.breakevenProgress ? new Decimal(v.breakevenProgress) : null;

          return (
            <article
              key={v.assetId}
              className={cn(
                "rounded-lg border bg-surface-raised p-5",
                v.alert === "critical" && "border-loss/50",
                v.alert === "warning" && "border-warn/50",
                v.alert === "ok" && "border-line",
              )}
            >
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-ink">{v.name}</h3>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    {v.legalName} · {v.stage ?? "—"} ·{" "}
                    {formatPercent(new Decimal(v.ownershipPct), { decimals: 0 })} pay
                  </p>
                </div>
                <RunwayBadge alert={v.alert} runway={runway} profitable={v.profitable} />
              </header>

              <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <p className="num text-2xl font-semibold text-ink">
                  {formatMoney(Money.of(v.positionValue, v.currency))}
                </p>
                {moic && (
                  <p
                    className={cn(
                      "num text-sm",
                      moic.greaterThan(1) ? "text-gain" : moic.lessThan(1) ? "text-loss" : "text-ink-faint",
                    )}
                  >
                    {formatNumber(moic, 2)}× katlanma
                  </p>
                )}
              </div>
              <p className="num mt-0.5 text-xs text-ink-faint">
                {formatMoney(Money.of(v.calledCapital, v.currency), { compact: true })} ödendi ·{" "}
                {formatMoney(Money.of(v.uncalledCapital, v.currency), { compact: true })} taahhüt kaldı
              </p>

              {/* Runway göstergesi */}
              <RunwayBar projection={v.projection} currency={v.currency} runway={runway} />

              <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-3 text-xs">
                <Cell
                  label="Aylık gelir"
                  value={formatMoney(Money.of(v.monthlyRevenue, v.currency), { compact: true })}
                  tone="gain"
                />
                <Cell
                  label="Aylık gider"
                  value={formatMoney(Money.of(v.monthlyBurn, v.currency), { compact: true })}
                  tone="loss"
                />
                <Cell
                  label={v.profitable ? "Aylık kâr" : "Net yakım"}
                  value={formatMoney(
                    Money.of(v.netMonthlyBurn, v.currency).abs(),
                    { compact: true },
                  )}
                  tone={v.profitable ? "gain" : "loss"}
                />
              </dl>

              {/* Başabaş ilerlemesi */}
              {progress && (
                <div className="mt-4">
                  <div className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="text-ink-faint">Başabaşa ilerleme</span>
                    <span
                      className={cn(
                        "num",
                        progress.greaterThanOrEqualTo(1) ? "text-gain" : "text-ink",
                      )}
                    >
                      {formatPercent(progress, { decimals: 0 })}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        progress.greaterThanOrEqualTo(1) ? "bg-gain" : "bg-accent",
                      )}
                      style={{
                        width: `${Math.min(100, Math.max(0, progress.toNumber() * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <DisposeButton
                  kind="venture"
                  assetId={v.assetId}
                  name={v.name}
                  currency={v.currency}
                  cashAccounts={cashAccounts}
                  currentValue={v.positionValue}
                  cost={v.calledCapital}
                />
                <Link
                  href={`/ekle/girisim?id=${v.assetId}`}
                  className="rounded-md px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  Düzenle
                </Link>
              </div>

              {v.runwayEndsAt && (
                <p className="mt-3 text-xs text-ink-faint">
                  Bu hızla nakit{" "}
                  <span className={v.alert === "critical" ? "text-loss" : "text-warn"}>
                    {new Date(v.runwayEndsAt).toLocaleDateString("tr-TR", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </span>{" "}
                  tarihinde tükenir.
                </p>
              )}
            </article>
          );
        })}
      </div>
    </PageShell>
  );
}

/** Nakit projeksiyonu — tek seri alan grafiği. */
function RunwayBar({
  projection,
  currency,
  runway,
}: {
  projection: Array<{ month: number; cash: string }>;
  currency: string;
  runway: Decimal | null;
}) {
  if (projection.length < 2) return null;

  const W = 100;
  const H = 24;
  const maxCash = Math.max(...projection.map((p) => Number(p.cash)));
  const maxMonth = projection[projection.length - 1].month;
  if (maxCash <= 0 || maxMonth <= 0) return null;

  const pts = projection
    .map((p) => `${(p.month / maxMonth) * W},${H - (Number(p.cash) / maxCash) * H}`)
    .join(" ");
  const area = `0,${H} ${pts} ${(projection[projection.length - 1].month / maxMonth) * W},${H}`;

  return (
    <figure className="mt-4">
      <figcaption className="mb-1.5 text-xs text-ink-faint">
        Nakit projeksiyonu
        {runway && ` · ${formatNumber(runway, 1)} ay`}
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-12 w-full"
        role="img"
        aria-label={`Nakit ${formatMoney(Money.of(projection[0].cash, currency), {
          compact: true,
        })} seviyesinden ${maxMonth} ay içinde tükeniyor`}
      >
        <polygon points={area} className="fill-accent/15" />
        <polyline
          points={pts}
          className="fill-none stroke-accent"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </figure>
  );
}

function RunwayBadge({
  alert,
  runway,
  profitable,
}: {
  alert: string;
  runway: Decimal | null;
  profitable: boolean;
}) {
  if (profitable) {
    return (
      <span className="rounded border border-gain/50 px-1.5 py-0.5 text-[11px] text-gain">
        kârda
      </span>
    );
  }
  return (
    <span
      className={cn(
        "num rounded border px-1.5 py-0.5 text-[11px]",
        alert === "critical" && "border-loss/50 text-loss",
        alert === "warning" && "border-warn/50 text-warn",
        alert === "ok" && "border-line text-ink-muted",
      )}
    >
      {runway ? `${formatNumber(runway, 1)} ay yakıt` : "nakit yok"}
    </span>
  );
}

function Cell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "gain" | "loss";
}) {
  return (
    <div>
      <dt className="truncate text-ink-faint">{label}</dt>
      <dd
        className={cn(
          "num mt-0.5 font-medium",
          tone === "gain" && "text-gain",
          tone === "loss" && "text-loss",
          !tone && "text-ink",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
