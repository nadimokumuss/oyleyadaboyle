"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Fiyat grafiği — tek seri, imleçle gezinme.
 *
 * Tek seri olduğu için gösterge (legend) yok; başlık zaten neyin
 * çizildiğini söylüyor. Fare ile üzerinde gezinince o günün tarihi ve
 * fiyatı okunuyor — noktaların hepsine etiket basmak grafiği okunamaz
 * hale getirirdi.
 */
export function PriceChart({
  closes,
  dates,
}: {
  closes: number[];
  dates: string[];
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (closes.length < 2) return null;

  const W = 100;
  const H = 30;
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;

  const x = (i: number) => (i / (closes.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / range) * H;

  const line = closes.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const area = `0,${H} ${line} ${W},${H}`;

  const up = closes[closes.length - 1] >= closes[0];
  const activeIndex = hover ?? closes.length - 1;

  return (
    <figure>
      <div
        className="relative"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / rect.width;
          const idx = Math.round(ratio * (closes.length - 1));
          setHover(Math.max(0, Math.min(closes.length - 1, idx)));
        }}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-48 w-full"
          role="img"
          aria-label={`Bir yıllık fiyat seyri: ${closes[0].toFixed(2)} seviyesinden ${closes[closes.length - 1].toFixed(2)} seviyesine`}
        >
          <polygon points={area} className={up ? "fill-gain/12" : "fill-loss/12"} />
          <polyline
            points={line}
            className={cn("fill-none", up ? "stroke-gain" : "stroke-loss")}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
          {hover !== null && (
            <line
              x1={x(hover)}
              y1={0}
              x2={x(hover)}
              y2={H}
              className="stroke-ink-faint"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* İmleç bilgisi */}
        <div className="num pointer-events-none absolute right-0 top-0 rounded-md border border-line bg-surface-raised px-2 py-1 text-xs">
          <span className="text-ink">{closes[activeIndex].toFixed(2)}</span>
          {dates[activeIndex] && (
            <span className="ml-2 text-ink-faint">
              {new Date(dates[activeIndex]).toLocaleDateString("tr-TR", {
                day: "numeric",
                month: "short",
                year: "2-digit",
              })}
            </span>
          )}
        </div>
      </div>

      <div className="num mt-1.5 flex justify-between text-xs text-ink-faint">
        <span>{dates[0] ? new Date(dates[0]).toLocaleDateString("tr-TR") : ""}</span>
        <span>
          {dates[dates.length - 1]
            ? new Date(dates[dates.length - 1]).toLocaleDateString("tr-TR")
            : ""}
        </span>
      </div>
    </figure>
  );
}
