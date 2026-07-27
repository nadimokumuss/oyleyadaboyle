import { Card } from "./PageShell";
import { Money, formatMoney, formatPercent } from "@/lib/money";
import { cn } from "@/lib/cn";
import type { BenchmarkComparison } from "@/lib/finance/benchmark";

/**
 * Servet eğrisi ile endeksin üst üste çizimi.
 *
 * İki seri olduğu için — tek serili `WealthCurve`'ün aksine — legend var.
 * Renk tek başına ayırt edici değil: seriler farklı çizgi desenleriyle de
 * ayrılıyor, renk körlüğünde de okunabilsin.
 */
export function BenchmarkCurve({
  comparison,
  benchmarkLabel,
}: {
  comparison: BenchmarkComparison;
  benchmarkLabel: string;
}) {
  const { portfolio, benchmark, excessReturn } = comparison;
  const ahead = !excessReturn.isNegative();

  const all = [...portfolio.map((p) => p.value), ...benchmark.map((p) => p.value)];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = max - min || 1;

  const W = 100;
  const H = 34;
  const path = (series: typeof portfolio) =>
    series
      .map((p, i) => {
        const x = (i / (series.length - 1)) * W;
        const y = H - ((p.value - min) / range) * H;
        return `${x},${y}`;
      })
      .join(" ");

  const first = portfolio[0].date;
  const last = portfolio[portfolio.length - 1].date;

  return (
    <Card
      title="Endekse karşı"
      hint={`${comparison.days} gün · ${first} → ${last}`}
    >
      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-xs text-ink-faint">Portföyünüz</p>
          <p
            className={cn(
              "num mt-0.5 text-lg font-semibold",
              comparison.portfolioReturn.isNegative() ? "text-loss" : "text-gain",
            )}
          >
            {formatPercent(comparison.portfolioReturn, { signed: true, decimals: 1 })}
          </p>
        </div>
        <div>
          <p className="text-xs text-ink-faint">{benchmarkLabel}</p>
          <p className="num mt-0.5 text-lg font-semibold text-ink-muted">
            {formatPercent(comparison.benchmarkReturn, { signed: true, decimals: 1 })}
          </p>
        </div>
        <div>
          <p className="text-xs text-ink-faint">Fark</p>
          <p
            className={cn(
              "num mt-0.5 text-lg font-semibold",
              ahead ? "text-gain" : "text-loss",
            )}
          >
            {formatPercent(excessReturn, { signed: true, decimals: 1 })}
          </p>
        </div>
      </div>

      <figure>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-32 w-full"
          role="img"
          aria-label={
            `Portföyünüz ${comparison.days} günde ` +
            `${formatPercent(comparison.portfolioReturn, { signed: true, decimals: 1 })}, ` +
            `${benchmarkLabel} ${formatPercent(comparison.benchmarkReturn, { signed: true, decimals: 1 })} getirdi. ` +
            (ahead ? "Endeksi geçtiniz." : "Endeksin altında kaldınız.")
          }
        >
          {/* Endeks arkada ve kesikli — referans olduğu belli olsun */}
          <polyline
            points={path(benchmark)}
            className="fill-none stroke-ink-faint"
            strokeWidth={1.25}
            strokeDasharray="3 2"
            vectorEffect="non-scaling-stroke"
          />
          <polyline
            points={path(portfolio)}
            className={cn("fill-none", ahead ? "stroke-gain" : "stroke-loss")}
            strokeWidth={1.75}
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-faint">
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={cn("inline-block h-0.5 w-4", ahead ? "bg-gain" : "bg-loss")}
            />
            Portföyünüz
          </span>
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-0.5 w-4 bg-ink-faint"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(to right, currentColor 0 3px, transparent 3px 5px)",
              }}
            />
            {benchmarkLabel}
          </span>
        </figcaption>
      </figure>

      <p className="mt-3 text-pretty text-xs text-ink-muted">
        Başlangıçtaki{" "}
        <span className="num">
          {formatMoney(Money.of(comparison.actualValue.dividedBy(
            comparison.portfolioReturn.plus(1),
          ), "USD"), { compact: true })}
        </span>{" "}
        {benchmarkLabel} endeksine konsaydı bugün{" "}
        <span className="num text-ink">
          {formatMoney(Money.of(comparison.counterfactualValue, "USD"), { compact: true })}
        </span>{" "}
        olurdu; gerçekte{" "}
        <span className={cn("num", ahead ? "text-gain" : "text-loss")}>
          {formatMoney(Money.of(comparison.actualValue, "USD"), { compact: true })}
        </span>
        .
      </p>

      <p className="mt-1.5 text-pretty text-xs text-ink-faint">
        Karşılaştırma yalnızca ortak tarihleri kullanır ve{" "}
        <strong className="text-ink-muted">ara dönem para giriş-çıkışını yok sayar</strong>.
        Dönem içinde ciddi bir katkı yaptıysanız fark olduğundan iyi görünür —
        para-ağırlıklı getiri için Portföy sayfasındaki XIRR'a bakın.
      </p>
    </Card>
  );
}
