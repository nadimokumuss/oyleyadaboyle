import Decimal from "decimal.js";
import { Money, formatMoney, formatPercent, formatQuantity } from "@/lib/money";
import { cn } from "@/lib/cn";
import type { PositionView } from "@/lib/finance/portfolioService";
import { DisposeButton } from "@/components/DisposeButton";
import { ScrollTable } from "@/components/PageShell";
import type { CashAccount } from "@/components/form/FundingSource";
import Link from "next/link";

/**
 * Pozisyon tablosu.
 *
 * K/Z kutupluluk kodlaması: kazanç/kayıp renk çifti + her zaman işaret
 * (+/−). Renk tek başına anlam taşımaz — renk körlüğünde de işaret ve
 * sayı okunabilir kalır.
 */
export function PositionsTable({
  positions,
  cashAccounts = [],
}: {
  positions: PositionView[];
  cashAccounts?: CashAccount[];
}) {
  return (
    <ScrollTable
      label="Pozisyonlar tablosu"
      className="rounded-lg border border-line bg-surface-raised"
    >
      <table className="w-full min-w-[64rem] text-sm">
        <caption className="sr-only">Portföy pozisyonları</caption>
        <thead>
          <tr className="border-b border-line text-left text-xs text-ink-faint">
            <th scope="col" className="px-4 py-2.5 font-medium">Varlık</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">Miktar</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">Ort. maliyet</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">Fiyat</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">24s</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">K/Z</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">Getiri</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">Ağırlık</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">Değer (USD)</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">İşlem</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const change = p.changePct24h ? new Decimal(p.changePct24h) : null;
            const pnl = new Decimal(p.unrealizedPnl);
            const ret = p.returnRatio ? new Decimal(p.returnRatio) : null;
            const weight = new Decimal(p.weight);

            return (
              <tr key={p.assetId} className="border-b border-line/50 last:border-0">
                <th scope="row" className="px-4 py-3 text-left font-normal">
                  <span className="block truncate font-medium text-ink">{p.name}</span>
                  <span className="block truncate text-xs text-ink-faint">
                    {p.symbol}
                    {p.institution && ` · ${p.institution}`}
                    {p.priceBasis === "stale" && (
                      <span className="ml-1.5 text-warn">bayat fiyat</span>
                    )}
                    {p.priceBasis === "none" && (
                      <span className="ml-1.5 text-warn">fiyat yok</span>
                    )}
                  </span>
                </th>

                <td className="num px-4 py-3 text-right text-ink-muted">
                  {formatQuantity(p.quantity, 6)}
                </td>

                <td className="num px-4 py-3 text-right text-ink-muted">
                  {formatMoney(Money.of(p.wacPerUnit, p.currency), {
                    decimals: pricePrecision(p.wacPerUnit),
                  })}
                </td>

                <td className="num px-4 py-3 text-right text-ink">
                  {p.livePrice
                    ? formatMoney(Money.of(p.livePrice, p.currency), {
                        decimals: pricePrecision(p.livePrice),
                      })
                    : "—"}
                </td>

                <td
                  className={cn(
                    "num px-4 py-3 text-right",
                    change?.isPositive() && "text-gain",
                    change?.isNegative() && "text-loss",
                    !change && "text-ink-faint",
                  )}
                >
                  {change ? formatPercent(change, { signed: true, decimals: 2 }) : "—"}
                </td>

                <td
                  className={cn(
                    "num px-4 py-3 text-right",
                    pnl.isPositive() && "text-gain",
                    pnl.isNegative() && "text-loss",
                    pnl.isZero() && "text-ink-faint",
                  )}
                >
                  {formatMoney(Money.of(pnl, p.currency), { compact: true, signed: true })}
                </td>

                <td
                  className={cn(
                    "num px-4 py-3 text-right",
                    ret?.isPositive() && "text-gain",
                    ret?.isNegative() && "text-loss",
                    !ret && "text-ink-faint",
                  )}
                >
                  {ret ? formatPercent(ret, { signed: true, decimals: 1 }) : "—"}
                </td>

                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <span className="num text-xs text-ink-muted">
                      {formatPercent(weight, { decimals: 1 })}
                    </span>
                    <span
                      aria-hidden
                      className="h-1 w-10 shrink-0 overflow-hidden rounded-full bg-surface"
                    >
                      <span
                        className="block h-full rounded-full bg-accent"
                        style={{ width: `${Math.min(100, weight.toNumber() * 100)}%` }}
                      />
                    </span>
                  </div>
                </td>

                <td className="num px-4 py-3 text-right font-medium text-ink">
                  {formatMoney(Money.of(p.valueUsd, "USD"))}
                  {p.currency !== "USD" && (
                    <span className="block text-xs font-normal text-ink-faint">
                      {formatMoney(Money.of(p.valueLocal, p.currency), { compact: true })}
                    </span>
                  )}
                </td>

                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <DisposeButton
                      kind="position"
                      assetId={p.assetId}
                      name={p.name}
                      currency={p.currency}
                      cashAccounts={cashAccounts}
                      quantity={p.quantity}
                      currentValue={p.valueLocal}
                      cost={p.costLocal}
                    />
                    <Link
                      href={`/ekle/pozisyon?id=${p.assetId}`}
                      className="rounded-md px-2 py-1 text-xs text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      Düzenle
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollTable>
  );
}

/** Kripto kuruş fiyatlarını ezmemek için hassasiyeti değere göre seç. */
function pricePrecision(value: string): number {
  const v = new Decimal(value).abs();
  if (v.greaterThanOrEqualTo(1000)) return 2;
  if (v.greaterThanOrEqualTo(1)) return 2;
  if (v.greaterThanOrEqualTo("0.01")) return 4;
  return 8;
}
