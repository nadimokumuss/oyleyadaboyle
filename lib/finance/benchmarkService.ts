import { fetchHistory } from "@/lib/market/history";
import { loadSnapshots } from "@/lib/snapshot";
import { compareToBenchmark, type BenchmarkComparison, type SeriesPoint } from "./benchmark";

/**
 * Servet eğrisini bir piyasa endeksiyle karşılaştırır.
 *
 * Endeks fiyatı `lib/market/history.ts` üzerinden gelir — aynı sağlayıcı,
 * aynı önbellek, aynı hız sınırı. Ayrı bir kaynak eklemeye gerek yok.
 */

export const BENCHMARKS = [
  { key: "sp500", symbol: "^GSPC", label: "S&P 500" },
  { key: "bist100", symbol: "XU100.IS", label: "BIST 100" },
  { key: "gold", symbol: "GC=F", label: "Altın" },
  { key: "nasdaq", symbol: "^IXIC", label: "Nasdaq" },
] as const;

export type BenchmarkKey = (typeof BENCHMARKS)[number]["key"];

export interface BenchmarkResult {
  key: BenchmarkKey;
  label: string;
  comparison: BenchmarkComparison;
}

/**
 * Karşılaştırmayı üretir.
 *
 * Anlık görüntü sayısı ikiden azsa veya endeks verisi alınamazsa `null`
 * döner — panel bu durumda grafiği hiç göstermez. Yarım veriyle
 * karşılaştırma yapıp yanlış bir üstünlük duygusu yaratmaktansa
 * göstermemek doğrusudur.
 */
export async function loadBenchmark(
  key: BenchmarkKey = "sp500",
): Promise<BenchmarkResult | null> {
  const def = BENCHMARKS.find((b) => b.key === key);
  if (!def) return null;

  const snapshots = loadSnapshots(3650);
  if (snapshots.length < 2) return null;

  const history = await fetchHistory(def.symbol);
  if (!history || history.closes.length < 2) return null;

  const portfolio: SeriesPoint[] = snapshots.map((s) => ({
    date: s.date,
    value: Number(s.totalUsd),
  }));

  const benchmark: SeriesPoint[] = history.dates.map((date, i) => ({
    date: date.slice(0, 10),
    value: history.closes[i],
  }));

  const comparison = compareToBenchmark(portfolio, benchmark);
  if (!comparison) return null;

  return { key: def.key, label: def.label, comparison };
}
