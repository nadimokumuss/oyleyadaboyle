"use client";

import { Money, formatMoney, formatPercent } from "@/lib/money";
import { cn } from "@/lib/cn";
import type { NetWorthPayload, StreamStatus } from "@/lib/useNetWorthStream";
import Decimal from "decimal.js";
import { ScrollTable } from "@/components/PageShell";

const STATUS_LABEL: Record<StreamStatus, string> = {
  connecting: "bağlanıyor",
  live: "canlı",
  reconnecting: "yeniden bağlanıyor",
  error: "bağlantı yok",
};

export function LiveNetWorth({
  data,
  status,
  rates,
}: {
  data: NetWorthPayload | null;
  status: StreamStatus;
  rates: Record<string, string> | null;
}) {
  const total = data ? Money.of(data.totalUsd, "USD") : null;

  return (
    <section className="rounded-lg border border-line bg-surface-raised p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-ink-muted">Net Servet</h2>
        <StatusDot status={status} />
      </div>

      {total ? (
        <>
          <p className="num mt-2 text-4xl font-semibold tracking-tight text-ink">
            {formatMoney(total)}
          </p>
          {rates && (
            <p className="num mt-1.5 text-sm text-ink-muted">
              {(["TRY", "EUR"] as const)
                .filter((c) => rates[c])
                .map((c) =>
                  formatMoney(total.times(rates[c]).withCurrency(c), { compact: true }),
                )
                .join("  ·  ")}
            </p>
          )}
        </>
      ) : (
        <div className="mt-3 h-10 w-64 animate-pulse rounded bg-surface-hover" />
      )}

      {data && Number(data.liabilitiesUsd) > 0 && (
        <dl className="num mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div className="flex items-baseline gap-2">
            <dt className="text-ink-faint">Varlıklar</dt>
            <dd className="text-ink">
              {formatMoney(Money.of(data.grossAssetsUsd, "USD"), { compact: true })}
            </dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="text-ink-faint">Borçlar</dt>
            <dd className="text-loss">
              −{formatMoney(Money.of(data.liabilitiesUsd, "USD"), { compact: true })}
            </dd>
          </div>
        </dl>
      )}

      {data && (
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-3 text-xs text-ink-faint">
          <span>{data.assetCount} varlık</span>
          <span>
            kur {data.fxDate}
            {data.fxStale && <span className="text-warn"> (bayat)</span>}
          </span>
          {data.staleCount > 0 && (
            <span className="text-warn">{data.staleCount} varlıkta bayat fiyat</span>
          )}
          <span>
            güncelleme{" "}
            {new Date(data.computedAt).toLocaleTimeString("tr-TR", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        </div>
      )}
    </section>
  );
}

function StatusDot({ status }: { status: StreamStatus }) {
  return (
    // Bağlantı durumu seyrek değişir ve önemlidir — duyurulmaya değer.
    // Net servet rakamı bilinçli olarak duyurulmuyor: 5 saniyede bir
    // güncellendiği için ekran okuyucuyu susmaz hâle getirirdi.
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="flex items-center gap-1.5 text-xs text-ink-faint"
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          status === "live" && "bg-gain",
          status === "connecting" && "bg-ink-faint",
          status === "reconnecting" && "bg-warn",
          status === "error" && "bg-loss",
        )}
      />
      {STATUS_LABEL[status]}
    </span>
  );
}


/** Varlık listesi — değer kaynağı (canlı/model/defter) görünür şekilde. */
export function AssetTable({ assets }: { assets: NetWorthPayload["assets"] }) {
  if (assets.length === 0) return null;

  const sorted = [...assets].sort(
    (a, b) => Number(b.valueUsd) - Number(a.valueUsd),
  );

  return (
    <ScrollTable
      label="Varlık dağılımı tablosu"
      className="rounded-lg border border-line bg-surface-raised"
    >
      <table className="w-full min-w-[46rem] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-ink-faint">
            <th className="px-4 py-2.5 font-medium">Varlık</th>
            <th className="px-4 py-2.5 font-medium">Kaynak</th>
            <th className="px-4 py-2.5 text-right font-medium">24s</th>
            <th className="px-4 py-2.5 text-right font-medium">K/Z</th>
            <th className="px-4 py-2.5 text-right font-medium">Değer (USD)</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((a) => {
            const change = a.changePct24h ? new Decimal(a.changePct24h) : null;
            const pnl = a.unrealizedPnl ? new Decimal(a.unrealizedPnl) : null;
            return (
              <tr key={a.assetId} className="border-b border-line/50 last:border-0">
                <td className="px-4 py-2.5">
                  <span className="block truncate font-medium text-ink">{a.name}</span>
                  <span className="block truncate text-xs text-ink-faint">
                    {a.symbol ?? KIND_LABEL[a.kind] ?? a.kind}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <BasisBadge basis={a.basis} ageMs={a.priceAgeMs} />
                </td>
                <td
                  className={cn(
                    "num px-4 py-2.5 text-right",
                    change?.isPositive() && "text-gain",
                    change?.isNegative() && "text-loss",
                    !change && "text-ink-faint",
                  )}
                >
                  {change ? formatPercent(change, { signed: true }) : "—"}
                </td>
                <td
                  className={cn(
                    "num px-4 py-2.5 text-right",
                    pnl?.isPositive() && "text-gain",
                    pnl?.isNegative() && "text-loss",
                    !pnl && "text-ink-faint",
                  )}
                >
                  {pnl
                    ? formatMoney(Money.of(pnl, a.currency), { compact: true, signed: true })
                    : "—"}
                </td>
                <td className="num px-4 py-2.5 text-right font-medium text-ink">
                  {formatMoney(Money.of(a.valueUsd, "USD"))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollTable>
  );
}

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

const BASIS_STYLE: Record<string, { label: string; className: string }> = {
  live: { label: "canlı", className: "border-gain/40 text-gain" },
  stale: { label: "bayat", className: "border-warn/50 text-warn" },
  accrual: { label: "tahakkuk", className: "border-line text-ink-muted" },
  model: { label: "model", className: "border-dashed border-ink-faint text-ink-faint" },
  book: { label: "defter", className: "border-line text-ink-muted" },
};

function BasisBadge({ basis, ageMs }: { basis: string; ageMs: number | null }) {
  const style = BASIS_STYLE[basis] ?? BASIS_STYLE.book;
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={cn(
          "inline-flex shrink-0 rounded border px-1.5 py-0.5 text-[11px]",
          style.className,
        )}
      >
        {style.label}
      </span>
      {ageMs !== null && ageMs > 120_000 && (
        <span className="text-[11px] text-ink-faint">{formatAge(ageMs)}</span>
      )}
    </span>
  );
}

function formatAge(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} dk önce`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} sa önce`;
  return `${Math.floor(hr / 24)} gün önce`;
}
