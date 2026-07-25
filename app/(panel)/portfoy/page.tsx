import Decimal from "decimal.js";
import { PageShell, EmptyState, Card } from "@/components/PageShell";
import { PositionsTable } from "@/components/PositionsTable";
import { loadPortfolio } from "@/lib/finance/portfolioService";
import { listCashAccounts } from "@/lib/services/funding";
import { Money, formatMoney, formatPercent, formatNumber } from "@/lib/money";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

export default async function PortfoyPage() {
  const p = await loadPortfolio();
  const cashAccounts = listCashAccounts();

  if (p.positions.length === 0) {
    return (
      <PageShell title="Portföy" subtitle="Hisse, kripto ve emtia pozisyonları.">
        <EmptyState
          title="Açık pozisyon yok"
          description="Demo senaryoyu yükleyerek örnek portföyü görebilirsiniz."
          action={
            <code className="inline-block rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink-muted">
              npm run db:seed
            </code>
          }
        />
      </PageShell>
    );
  }

  const unrealized = new Decimal(p.totals.unrealizedPnlUsd);
  const ret = p.totals.returnRatio ? new Decimal(p.totals.returnRatio) : null;
  const xirrValue = p.xirr ? new Decimal(p.xirr) : null;
  const hhi = new Decimal(p.risk.hhi);

  return (
    <PageShell
      title="Portföy"
      subtitle="Canlı fiyatlarla değerlenen piyasa pozisyonları."
    >
      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Piyasa değeri" value={formatMoney(Money.of(p.totals.valueUsd, "USD"))} />
        <Stat label="Maliyet" value={formatMoney(Money.of(p.totals.costUsd, "USD"))} />
        <Stat
          label="Gerçekleşmemiş K/Z"
          value={formatMoney(Money.of(unrealized, "USD"), { signed: true })}
          sub={ret ? formatPercent(ret, { signed: true }) : undefined}
          tone={unrealized.isPositive() ? "gain" : unrealized.isNegative() ? "loss" : undefined}
        />
        <Stat
          label="Yıllık getiri (XIRR)"
          value={xirrValue ? formatPercent(xirrValue, { signed: true }) : "—"}
          sub="para-ağırlıklı"
          tone={xirrValue?.isPositive() ? "gain" : xirrValue?.isNegative() ? "loss" : undefined}
        />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card title="Risk" hint="yoğunlaşma">
          <dl className="space-y-2.5 text-sm">
            <Row
              label="Etkin varlık sayısı"
              value={formatNumber(p.risk.effectiveCount, 2)}
              hint={`${p.positions.length} pozisyon`}
            />
            <Row label="Yoğunlaşma (HHI)" value={formatNumber(hhi, 3)} />
            <Row
              label="En büyük pozisyon"
              value={formatPercent(new Decimal(p.risk.topWeight), { decimals: 1 })}
              hint={p.risk.topName ?? undefined}
            />
          </dl>

          {p.risk.concentrated.length > 0 && (
            <div className="mt-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2">
              <p className="text-xs font-medium text-warn">Yoğunlaşma uyarısı</p>
              <ul className="mt-1 space-y-0.5">
                {p.risk.concentrated.map((c) => (
                  <li key={c.name} className="num text-pretty text-xs text-ink-muted">
                    {c.name} tek başına portföyün{" "}
                    {formatPercent(new Decimal(c.weight), { decimals: 1 })} kadarı
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card title="Varlık sınıfı dağılımı">
          <Allocation map={p.byKind} labels={KIND_LABEL} />
        </Card>

        <Card title="Para birimi maruziyeti">
          <Allocation map={p.byCurrency} />
        </Card>
      </div>

      <PositionsTable positions={p.positions} cashAccounts={cashAccounts} />

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Stat
          label="Gerçekleşmiş K/Z"
          value={formatMoney(Money.of(p.totals.realizedPnlUsd, "USD"), { signed: true })}
          sub="satışlardan (WAC)"
        />
        <Stat
          label="Tahsil edilen gelir"
          value={formatMoney(Money.of(p.totals.incomeUsd, "USD"))}
          sub="temettü, staking"
        />
        <Stat
          label="Fiyat durumu"
          value={p.staleCount === 0 ? "Hepsi canlı" : `${p.staleCount} bayat`}
          sub={`kur ${p.fxDate}${p.fxStale ? " (bayat)" : ""}`}
          tone={p.staleCount > 0 ? "warn" : undefined}
        />
      </div>
    </PageShell>
  );
}

const KIND_LABEL: Record<string, string> = {
  equity: "Hisse",
  crypto: "Kripto",
  commodity: "Emtia",
};

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "gain" | "loss" | "warn";
}) {
  return (
    <div className="rounded-lg border border-line bg-surface-raised p-4">
      <p className="truncate text-xs text-ink-faint">{label}</p>
      <p
        className={cn(
          "num mt-1 text-xl font-semibold",
          tone === "gain" && "text-gain",
          tone === "loss" && "text-loss",
          tone === "warn" && "text-warn",
          !tone && "text-ink",
        )}
      >
        {value}
      </p>
      {sub && <p className="num mt-0.5 truncate text-xs text-ink-faint">{sub}</p>}
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="truncate text-ink-muted">{label}</dt>
      <dd className="num shrink-0 text-right text-ink">
        {value}
        {hint && <span className="ml-2 text-xs text-ink-faint">{hint}</span>}
      </dd>
    </div>
  );
}

/** Büyüklük kodlaması: tek renk, uzunlukla okunur — kategorik palet gerekmez. */
function Allocation({
  map,
  labels,
}: {
  map: Record<string, string>;
  labels?: Record<string, string>;
}) {
  const entries = Object.entries(map)
    .map(([k, v]) => [k, new Decimal(v)] as const)
    .filter(([, v]) => v.greaterThan(0))
    .sort((a, b) => b[1].comparedTo(a[1]));

  const total = entries.reduce((a, [, v]) => a.plus(v), new Decimal(0));
  if (entries.length === 0) return <p className="text-sm text-ink-faint">Veri yok</p>;

  return (
    <ul className="space-y-2">
      {entries.map(([key, value]) => {
        const share = total.isZero() ? new Decimal(0) : value.dividedBy(total);
        return (
          <li key={key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-ink-muted">{labels?.[key] ?? key}</span>
              <span className="num shrink-0 text-ink">
                {formatMoney(Money.of(value, "USD"), { compact: true })}
                <span className="ml-2 text-ink-faint">
                  {formatPercent(share, { decimals: 1 })}
                </span>
              </span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.min(100, share.toNumber() * 100)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
