import Link from "next/link";
import Decimal from "decimal.js";
import { PageShell, Card, EmptyState, ScrollTable } from "@/components/PageShell";
import { db } from "@/db/client";
import { watchlist } from "@/db/schema";
import { getQuotes } from "@/lib/market/registry";
import { Money, formatMoney, formatPercent } from "@/lib/money";
import { cn } from "@/lib/cn";
import { DiscoverSearch } from "@/components/DiscoverSearch";
import { removeFromWatchlistAction } from "@/app/actions/assets";

export const dynamic = "force-dynamic";

export default async function KesfetPage() {
  const rows = db.select().from(watchlist).all();
  const quotes = await getQuotes(rows.map((r) => r.symbol));
  const bySymbol = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));

  return (
    <PageShell
      title="Keşfet"
      subtitle="Enstrüman arayın, inceleyin, izleme listenize ekleyin."
    >
      <Card title="Ara" className="mb-4">
        <DiscoverSearch />
      </Card>

      <Card
        title="İzleme listesi"
        hint={rows.length > 0 ? `${rows.length} enstrüman` : undefined}
      >
        {rows.length === 0 ? (
          <EmptyState
            title="İzleme listeniz boş"
            description="Yukarıdan bir enstrüman arayıp inceleyin. Beğendiklerinizi listeye ekleyerek fiyatlarını buradan takip edebilirsiniz — satın almadan önce izlemek iyi bir alışkanlık."
            action={
              <span className="text-xs text-ink-faint">
                Aramaya başlamak için yukarıdaki kutuyu kullanın
              </span>
            }
          />
        ) : (
          <ScrollTable label="İzleme listesi tablosu">
            <table className="w-full min-w-[42rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-faint">
                  <th className="py-2 pr-4 font-medium">Sembol</th>
                  <th className="py-2 pr-4 font-medium">Tür</th>
                  <th className="py-2 pr-4 text-right font-medium">Fiyat</th>
                  <th className="py-2 pr-4 text-right font-medium">24s</th>
                  <th className="py-2 text-right font-medium">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const q = bySymbol.get(r.symbol.toUpperCase());
                  const change = q?.changePct24h ? new Decimal(q.changePct24h) : null;
                  return (
                    <tr key={r.id} className="border-b border-line/50 last:border-0">
                      <td className="py-2.5 pr-4">
                        <Link
                          href={`/kesfet/${encodeURIComponent(r.symbol)}`}
                          className="block hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                        >
                          <span className="block truncate font-medium text-ink">
                            {r.symbol}
                          </span>
                          <span className="block truncate text-xs text-ink-faint">
                            {r.name}
                          </span>
                        </Link>
                      </td>
                      <td className="py-2.5 pr-4 text-xs text-ink-muted">
                        {r.kind === "crypto" ? "Kripto" : (r.exchange ?? "Hisse")}
                      </td>
                      <td className="num py-2.5 pr-4 text-right text-ink">
                        {q
                          ? formatMoney(Money.of(q.price, q.currency), {
                              decimals: Number(q.price) < 1 ? 6 : 2,
                            })
                          : "—"}
                        {q?.stale && (
                          <span className="ml-1.5 text-[11px] text-warn">bayat</span>
                        )}
                      </td>
                      <td
                        className={cn(
                          "num py-2.5 pr-4 text-right",
                          change?.isPositive() && "text-gain",
                          change?.isNegative() && "text-loss",
                          !change && "text-ink-faint",
                        )}
                      >
                        {change ? formatPercent(change, { signed: true }) : "—"}
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/ekle/pozisyon?symbol=${encodeURIComponent(r.symbol)}&name=${encodeURIComponent(r.name)}&kind=${r.kind}`}
                            className="rounded-md border border-line px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
                          >
                            Portföye ekle
                          </Link>
                          <form action={removeFromWatchlistAction}>
                            <input type="hidden" name="symbol" value={r.symbol} />
                            <button
                              type="submit"
                              className="rounded-md px-2 py-1 text-xs text-ink-faint transition-colors hover:bg-surface-hover hover:text-loss focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                            >
                              Çıkar
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollTable>
        )}
      </Card>

      <p className="mt-6 text-pretty text-xs text-ink-faint">
        Enstrüman detay sayfalarındaki göstergeler fiyat geçmişinden hesaplanan
        teknik göstergelerdir; temel analiz (F/K, temettü verimi vb.) içermez ve
        yatırım tavsiyesi değildir.
      </p>
    </PageShell>
  );
}
