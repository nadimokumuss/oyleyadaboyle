import Link from "next/link";
import Decimal from "decimal.js";
import { PageShell, Card, EmptyState } from "@/components/PageShell";
import { fetchHistory } from "@/lib/market/history";
import { analyzeSignals, summarizeCrypto, scoreToPercent } from "@/lib/finance/signals";
import { Money, formatMoney, formatPercent } from "@/lib/money";
import { cn } from "@/lib/cn";
import { db } from "@/db/client";
import { watchlist } from "@/db/schema";
import { eq } from "drizzle-orm";
import { addToWatchlistAction, removeFromWatchlistAction } from "@/app/actions/assets";
import { classify } from "@/lib/market/registry";
import { PriceChart } from "@/components/PriceChart";

export const dynamic = "force-dynamic";

export default async function SembolPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol: raw } = await params;
  const symbol = decodeURIComponent(raw).toUpperCase();

  const history = await fetchHistory(symbol);
  const watched = db
    .select()
    .from(watchlist)
    .where(eq(watchlist.symbol, symbol))
    .get();

  if (!history || history.closes.length === 0) {
    return (
      <PageShell title={symbol} subtitle="Enstrüman detayı">
        <EmptyState
          title="Fiyat geçmişi alınamadı"
          description="Bu sembol için veri sağlayıcıdan geçmiş fiyat gelmedi. Sembolün doğru yazıldığından emin olun — BIST hisseleri için sonuna .IS eklenmeli (örn. THYAO.IS). Sağlayıcı geçici olarak erişilemiyor da olabilir."
          action={
            <Link
              href="/kesfet"
              className="inline-flex items-center rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink hover:bg-surface-hover"
            >
              Aramaya dön
            </Link>
          }
        />
      </PageShell>
    );
  }

  const report = analyzeSignals(symbol, history.closes);
  const cryptoExtras =
    classify(symbol) === "crypto"
      ? summarizeCrypto({
          marketCapRank: history.meta.marketCapRank ?? null,
          athChangePct: history.meta.athChangePct ?? null,
          change7d: history.meta.change7d ?? null,
          change30d: history.meta.change30d ?? null,
          change1y: history.meta.change1y ?? null,
        })
      : [];

  const allComponents = [...report.components, ...cryptoExtras];
  const price = history.meta.currentPrice ?? history.closes[history.closes.length - 1];
  const first = history.closes[0];
  const yearChange = first > 0 ? (price - first) / first : 0;

  const scorePct = scoreToPercent(report.score);
  const dir =
    report.score > 0.2 ? "positive" : report.score < -0.2 ? "negative" : "neutral";

  return (
    <PageShell
      title={symbol}
      subtitle={`${history.source === "coingecko" ? "Kripto" : "Hisse / ETF"} · ${history.closes.length} günlük fiyat geçmişi`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {watched ? (
            <form action={removeFromWatchlistAction}>
              <input type="hidden" name="symbol" value={symbol} />
              <button
                type="submit"
                className="rounded-md border border-line bg-surface-raised px-3 py-1.5 text-xs text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                İzlemeden çıkar
              </button>
            </form>
          ) : (
            <form action={addToWatchlistAction}>
              <input type="hidden" name="symbol" value={symbol} />
              <input type="hidden" name="name" value={symbol} />
              <input type="hidden" name="kind" value={classify(symbol) === "crypto" ? "crypto" : "equity"} />
              <input type="hidden" name="currency" value={history.currency} />
              <button
                type="submit"
                className="rounded-md border border-line bg-surface-raised px-3 py-1.5 text-xs text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                İzlemeye al
              </button>
            </form>
          )}
          <Link
            href={`/ekle/pozisyon?symbol=${encodeURIComponent(symbol)}&name=${encodeURIComponent(symbol)}&kind=${classify(symbol) === "crypto" ? "crypto" : "equity"}`}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-surface transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Portföye ekle
          </Link>
          <Link
            href={`/ekle/pozisyon?symbol=${encodeURIComponent(symbol)}&name=${encodeURIComponent(symbol)}&kind=${classify(symbol) === "crypto" ? "crypto" : "equity"}&status=planned`}
            className="rounded-md border border-line bg-surface-raised px-3 py-1.5 text-xs text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Plana ekle
          </Link>
        </div>
      }
    >
      {/* Fiyat ve grafik */}
      <Card className="mb-4">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <p className="num text-3xl font-semibold text-ink">
            {formatMoney(Money.of(String(price), history.currency), {
              decimals: price < 1 ? 6 : 2,
            })}
          </p>
          <p
            className={cn(
              "num text-sm",
              yearChange > 0 ? "text-gain" : yearChange < 0 ? "text-loss" : "text-ink-faint",
            )}
          >
            {formatPercent(yearChange, { signed: true })} (1 yıl)
          </p>
        </div>

        <PriceChart closes={history.closes} dates={history.dates} />

        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-3 text-xs">
          {history.meta.fiftyTwoWeekLow !== null && (
            <Meta
              label="52h düşük"
              value={formatMoney(
                Money.of(String(history.meta.fiftyTwoWeekLow), history.currency),
                { compact: true },
              )}
            />
          )}
          {history.meta.fiftyTwoWeekHigh !== null && (
            <Meta
              label="52h yüksek"
              value={formatMoney(
                Money.of(String(history.meta.fiftyTwoWeekHigh), history.currency),
                { compact: true },
              )}
            />
          )}
          {history.meta.change7d != null && (
            <Meta label="7 gün" value={formatPercent(history.meta.change7d / 100, { signed: true })} />
          )}
          {history.meta.change30d != null && (
            <Meta label="30 gün" value={formatPercent(history.meta.change30d / 100, { signed: true })} />
          )}
          <Meta label="Kaynak" value={history.source === "coingecko" ? "CoinGecko" : "Yahoo Finance"} />
        </dl>
      </Card>

      {/* Sinyaller */}
      <Card
        title="Teknik göstergeler"
        hint={report.sufficient ? report.label : "yetersiz veri"}
      >
        {!report.sufficient ? (
          <p className="text-pretty text-sm text-ink-muted">
            Gösterge hesaplamak için en az 30 günlük fiyat geçmişi gerekiyor;
            bu sembolde {report.dataPoints} gün var.
          </p>
        ) : (
          <>
            {/* Bileşik gösterge */}
            <div className="mb-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-ink-muted">Bileşik değerlendirme</span>
                <span
                  className={cn(
                    "num text-sm font-medium",
                    dir === "positive" && "text-gain",
                    dir === "negative" && "text-loss",
                    dir === "neutral" && "text-ink",
                  )}
                >
                  {report.label}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface">
                <div
                  className={cn(
                    "h-full rounded-full",
                    dir === "positive" && "bg-gain",
                    dir === "negative" && "bg-loss",
                    dir === "neutral" && "bg-ink-faint",
                  )}
                  style={{ width: `${scorePct}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-ink-faint">
                <span>olumsuz</span>
                <span>nötr</span>
                <span>olumlu</span>
              </div>
            </div>

            {/* Bileşenler — her biri gerekçesiyle */}
            <ul className="space-y-3 border-t border-line pt-3">
              {allComponents.map((c) => (
                <li key={c.key}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-ink">{c.label}</span>
                    <span
                      className={cn(
                        "num shrink-0 text-sm font-medium",
                        c.direction === "positive" && "text-gain",
                        c.direction === "negative" && "text-loss",
                        c.direction === "neutral" && "text-ink-muted",
                      )}
                    >
                      {c.value}
                    </span>
                  </div>
                  <p className="mt-0.5 text-pretty text-xs text-ink-faint">
                    {c.explanation}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="mt-4 rounded-md border border-warn/40 bg-warn/10 px-3 py-2.5">
          <p className="text-pretty text-xs text-ink-muted">
            <strong className="text-warn">Bunlar teknik göstergedir.</strong>{" "}
            Şirketin kârlılığı, borcu, F/K oranı gibi temel veriler ücretsiz
            erişilebilir olmadığı için buraya dahil edilmemiştir. Fiyat
            geçmişinden hesaplanan bu göstergeler geleceği tahmin etmez ve
            yatırım tavsiyesi değildir.
          </p>
        </div>
      </Card>
    </PageShell>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-ink-faint">{label}</dt>
      <dd className="num text-ink">{value}</dd>
    </div>
  );
}
