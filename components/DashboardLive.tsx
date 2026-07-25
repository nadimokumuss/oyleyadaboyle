"use client";

import { useEffect, useState } from "react";
import { useNetWorthStream } from "@/lib/useNetWorthStream";
import { LiveNetWorth, AssetTable } from "./LiveNetWorth";
import { Card } from "./PageShell";
import { Money, formatMoney, formatPercent } from "@/lib/money";
import Decimal from "decimal.js";

const KIND_LABEL: Record<string, string> = {
  equity: "Hisse",
  crypto: "Kripto",
  commodity: "Emtia",
  deposit: "Mevduat",
  realestate: "Gayrimenkul",
  vehicle: "Araç",
  venture: "Girişim",
  cash: "Nakit",
};

const LIQUIDITY_LABEL: Record<string, string> = {
  instant: "Anında",
  days: "Günler içinde",
  weeks: "Haftalar içinde",
  months: "Aylar içinde",
  illiquid: "İllikit",
};

export function DashboardLive() {
  const { data, status, error } = useNetWorthStream();
  const [rates, setRates] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    fetch("/api/fx")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setRates(d?.rates ?? null))
      .catch(() => setRates(null));
  }, []);

  const total = data ? new Decimal(data.totalUsd) : null;

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">
          {error}
        </p>
      )}

      <LiveNetWorth data={data} status={status} rates={rates} />

      {data && total && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Varlık dağılımı" hint="sınıfa göre">
              <Breakdown map={data.byKind} total={total} labels={KIND_LABEL} />
            </Card>
            <Card title="Likidite merdiveni" hint="nakde çevirme süresi">
              <Breakdown
                map={data.byLiquidity}
                total={total}
                labels={LIQUIDITY_LABEL}
                order={["instant", "days", "weeks", "months", "illiquid"]}
              />
            </Card>
            <Card title="Para birimi maruziyeti">
              <Breakdown map={data.byCurrency} total={total} />
            </Card>
            <Card title="Ülke dağılımı">
              <Breakdown map={data.byCountry} total={total} />
            </Card>
          </div>

          <AssetTable assets={data.assets} />
        </>
      )}
    </div>
  );
}

function Breakdown({
  map,
  total,
  labels,
  order,
}: {
  map: Record<string, string>;
  total: Decimal;
  labels?: Record<string, string>;
  order?: string[];
}) {
  let entries = Object.entries(map).filter(([, v]) => new Decimal(v).abs().greaterThan(0));

  entries = order
    ? entries.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    : entries.sort((a, b) => Number(b[1]) - Number(a[1]));

  if (entries.length === 0) {
    return <p className="text-sm text-ink-faint">Veri yok</p>;
  }

  return (
    <ul className="space-y-2">
      {entries.map(([key, value]) => {
        const share = total.isZero()
          ? new Decimal(0)
          : new Decimal(value).dividedBy(total);
        return (
          <li key={key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-ink-muted">{labels?.[key] ?? key}</span>
              <span className="num shrink-0 text-ink">
                {formatMoney(Money.of(value, "USD"), { compact: true })}
                <span className="ml-2 text-ink-faint">{formatPercent(share, { decimals: 1 })}</span>
              </span>
            </div>
            <div
              className="mt-1 h-1 overflow-hidden rounded-full bg-surface"
              role="presentation"
            >
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.min(100, Math.max(0, share.toNumber() * 100))}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
