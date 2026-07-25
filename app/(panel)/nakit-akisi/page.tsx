import Decimal from "decimal.js";
import { PageShell, Card } from "@/components/PageShell";
import { loadCashflow } from "@/lib/finance/cashflowService";
import { INCOME_LABEL, EXPENSE_LABEL } from "@/lib/finance/cashflow";
import { Money, formatMoney, formatPercent } from "@/lib/money";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

export default async function NakitAkisiPage() {
  const cf = await loadCashflow();

  const coverage = cf.coverageRatio ? new Decimal(cf.coverageRatio) : null;
  const net = cf.netMonthly;

  return (
    <PageShell
      title="Nakit Akışı"
      subtitle="Aylık gelir, gider ve finansal bağımsızlığa ne kadar kaldığı."
    >
      {/* Pasif gelir kapsama oranı — en anlamlı metrik */}
      <section
        className={cn(
          "mb-4 rounded-lg border p-5",
          cf.financiallyIndependent
            ? "border-gain/50 bg-gain/10"
            : "border-line bg-surface-raised",
        )}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium text-ink-muted">
            Pasif gelir kapsama oranı
          </h2>
          {cf.financiallyIndependent && (
            <span className="rounded border border-gain/50 px-2 py-0.5 text-xs text-gain">
              finansal bağımsızlık
            </span>
          )}
        </div>

        {coverage ? (
          <>
            <p
              className={cn(
                "num mt-2 text-4xl font-semibold",
                cf.financiallyIndependent ? "text-gain" : "text-ink",
              )}
            >
              {formatPercent(coverage, { decimals: 1 })}
            </p>

            <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface">
              <div
                className={cn(
                  "h-full rounded-full",
                  cf.financiallyIndependent ? "bg-gain" : "bg-accent",
                )}
                style={{
                  width: `${Math.min(100, Math.max(0, coverage.toNumber() * 100))}%`,
                }}
              />
            </div>

            <p className="num mt-2.5 text-pretty text-sm text-ink-muted">
              Aylık {formatMoney(cf.passiveMonthlyIncome)} pasif gelir,{" "}
              {formatMoney(cf.livingCost)} yaşam gideri.
              {cf.gapToIndependence ? (
                <>
                  {" "}Bağımsızlık için ayda{" "}
                  <span className="text-ink">{formatMoney(cf.gapToIndependence)}</span> daha
                  gerekiyor.
                </>
              ) : (
                " Yaşam giderinizi çalışmadan karşılıyorsunuz."
              )}
            </p>
          </>
        ) : (
          <p className="mt-2 text-pretty text-sm text-ink-muted">
            Kapsama oranı için aylık yaşam gideri girilmeli. Ayarlar tablosundaki{" "}
            <code className="text-ink">monthly_living_cost</code> alanını doldurun.
          </p>
        )}
      </section>

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat
          label="Aylık gelir"
          value={formatMoney(cf.totalMonthlyIncome)}
          tone="gain"
        />
        <Stat
          label="Aylık gider"
          value={formatMoney(cf.totalMonthlyExpense)}
          tone="loss"
        />
        <Stat
          label="Aylık net"
          value={formatMoney(net, { signed: true })}
          tone={net.isPositive() ? "gain" : "loss"}
          sub={net.isNegative() ? "birikim eriyor" : "birikim büyüyor"}
        />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card title="Gelir kalemleri" hint="aylık">
          <FlowList items={cf.incomes} tone="gain" total={cf.totalMonthlyIncome} />
          <Breakdown map={cf.byIncomeSource} labels={INCOME_LABEL} />
        </Card>

        <Card title="Gider kalemleri" hint="aylık">
          <FlowList items={cf.expenses} tone="loss" total={cf.totalMonthlyExpense} />
          <Breakdown map={cf.byExpenseCategory} labels={EXPENSE_LABEL} />
        </Card>
      </div>

      <Card title="12 aylık nakit projeksiyonu" hint="mevcut net akışla">
        <Projection projection={cf.projection} />
        <p className="mt-3 text-pretty text-xs text-ink-faint">
          Bu doğrusal bir projeksiyondur — portföy getirisi veya fiyat değişimi
          içermez. Sadece bugünkü gelir-gider dengesi devam ederse nakdin nasıl
          seyredeceğini gösterir.
        </p>
      </Card>
    </PageShell>
  );
}

function FlowList({
  items,
  tone,
  total,
}: {
  items: Array<{ label: string; monthlyUsd: Money; passive?: boolean }>;
  tone: "gain" | "loss";
  total: Money;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-ink-faint">Kayıt yok</p>;
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => {
        const share = total.isZero()
          ? new Decimal(0)
          : item.monthlyUsd.ratioTo(total);
        return (
          <li key={`${item.label}-${i}`} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-ink-muted">
              {item.label}
              {item.passive === false && (
                <span className="ml-1.5 text-xs text-ink-faint">(aktif)</span>
              )}
            </span>
            <span className="num shrink-0">
              <span className={tone === "gain" ? "text-gain" : "text-loss"}>
                {formatMoney(item.monthlyUsd, { compact: true })}
              </span>
              <span className="ml-2 text-xs text-ink-faint">
                {formatPercent(share, { decimals: 0 })}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Breakdown({
  map,
  labels,
}: {
  map: Record<string, string>;
  labels: Record<string, string>;
}) {
  const entries = Object.entries(map).filter(([, v]) => new Decimal(v).greaterThan(0));
  if (entries.length === 0) return null;

  return (
    <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-xs">
      {entries
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .map(([key, value]) => (
          <div key={key} className="flex items-baseline gap-1.5">
            <dt className="text-ink-faint">{labels[key] ?? key}</dt>
            <dd className="num text-ink-muted">
              {formatMoney(Money.of(value, "USD"), { compact: true })}
            </dd>
          </div>
        ))}
    </dl>
  );
}

function Projection({ projection }: { projection: Array<{ month: number; cash: string }> }) {
  if (projection.length < 2) return null;

  const values = projection.map((p) => Number(p.cash));
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  const W = 100;
  const H = 30;
  const x = (m: number) => (m / (projection.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / range) * H;

  const line = projection.map((p) => `${x(p.month)},${y(Number(p.cash))}`).join(" ");
  const zeroY = y(0);
  const last = projection[projection.length - 1];
  const declining = Number(last.cash) < Number(projection[0].cash);

  return (
    <figure>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-24 w-full"
        role="img"
        aria-label={`Nakit 12 ay içinde ${formatMoney(
          Money.of(projection[0].cash, "USD"),
          { compact: true },
        )} seviyesinden ${formatMoney(Money.of(last.cash, "USD"), { compact: true })} seviyesine gidiyor`}
      >
        <polygon
          points={`0,${zeroY} ${line} ${W},${zeroY}`}
          className={declining ? "fill-loss/15" : "fill-gain/15"}
        />
        {min < 0 && (
          <line
            x1={0}
            y1={zeroY}
            x2={W}
            y2={zeroY}
            className="stroke-line"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}
        <polyline
          points={line}
          className={cn("fill-none", declining ? "stroke-loss" : "stroke-gain")}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="num mt-1.5 flex justify-between text-xs text-ink-faint">
        <span>bugün {formatMoney(Money.of(projection[0].cash, "USD"), { compact: true })}</span>
        <span
          className={cn(declining ? "text-loss" : "text-gain")}
        >
          12 ay sonra {formatMoney(Money.of(last.cash, "USD"), { compact: true })}
        </span>
      </div>
    </figure>
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
