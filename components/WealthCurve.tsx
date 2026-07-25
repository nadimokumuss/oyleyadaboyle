import { Card } from "./PageShell";
import { Money, formatMoney, formatPercent } from "@/lib/money";
import { cn } from "@/lib/cn";
import Decimal from "decimal.js";
import type { SnapshotPoint } from "@/lib/snapshot";

/**
 * Servet eğrisi — günlük anlık görüntülerden.
 *
 * Tek seri olduğu için legend yok; başlık seriyi adlandırır.
 * Geçmiş yoksa grafik uydurmaz, ne zaman dolacağını açıklar.
 */
export function WealthCurve({ points }: { points: SnapshotPoint[] }) {
  if (points.length < 2) {
    return (
      <Card title="Servet eğrisi" hint="günlük kayıt">
        <p className="text-pretty text-sm text-ink-muted">
          {points.length === 0
            ? "Henüz geçmiş kaydı yok."
            : "Şimdilik tek gün kaydı var."}{" "}
          Panel her açıldığında o günün net serveti kaydedilir; birkaç gün
          içinde eğri oluşmaya başlar.
        </p>
        <p className="mt-1.5 text-pretty text-xs text-ink-faint">
          Geçmiş fiyatlar geriye dönük hesaplanamadığı için eğri ancak ileriye
          doğru birikir — bu yüzden panelin ilk günü grafiği boş olur.
        </p>
      </Card>
    );
  }

  const values = points.map((p) => Number(p.totalUsd));
  const first = values[0];
  const last = values[values.length - 1];
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  const W = 100;
  const H = 32;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / range) * H;

  const line = points.map((p, i) => `${x(i)},${y(Number(p.totalUsd))}`).join(" ");
  const area = `0,${H} ${line} ${W},${H}`;

  const change = last - first;
  const changeRatio = first !== 0 ? new Decimal(change).dividedBy(first) : null;
  const up = change >= 0;

  return (
    <Card
      title="Servet eğrisi"
      hint={`${points.length} gün · ${points[0].date} → ${points[points.length - 1].date}`}
    >
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="num text-xl font-semibold text-ink">
          {formatMoney(Money.of(String(last), "USD"))}
        </p>
        <p className={cn("num text-sm", up ? "text-gain" : "text-loss")}>
          {formatMoney(Money.of(String(change), "USD"), { signed: true, compact: true })}
          {changeRatio && (
            <span className="ml-1.5">
              ({formatPercent(changeRatio, { signed: true, decimals: 1 })})
            </span>
          )}
        </p>
      </div>

      <figure>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-32 w-full"
          role="img"
          aria-label={`Net servet ${points.length} günde ${formatMoney(
            Money.of(String(first), "USD"),
            { compact: true },
          )} seviyesinden ${formatMoney(Money.of(String(last), "USD"), {
            compact: true,
          })} seviyesine ${up ? "yükseldi" : "geriledi"}`}
        >
          <polygon points={area} className={up ? "fill-gain/15" : "fill-loss/15"} />
          <polyline
            points={line}
            className={cn("fill-none", up ? "stroke-gain" : "stroke-loss")}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className="num mt-1.5 flex justify-between text-xs text-ink-faint">
          <span>{formatMoney(Money.of(String(min), "USD"), { compact: true })} en düşük</span>
          <span>{formatMoney(Money.of(String(max), "USD"), { compact: true })} en yüksek</span>
        </div>
      </figure>
    </Card>
  );
}
