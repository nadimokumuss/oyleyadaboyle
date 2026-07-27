import { db } from "@/db/client";
import { settings } from "@/db/schema";

/**
 * Kullanıcının değiştirebildiği sayısal varsayımların tek kaynağı.
 *
 * Bunlar ölçülen değil **kabul edilen** sayılar: enflasyon beklentisi,
 * referans getiriler. Panelin geri kalanı "verinin nereden geldiğini"
 * rozetle gösterirken bu varsayımların koda gömülü olması tutarsızdı —
 * kullanıcı reel getirisini üreten sayıyı göremiyor, değiştiremiyordu.
 *
 * Kodda duran değerler artık yalnızca **yedek**: ayar satırında karşılığı
 * yoksa devreye girerler, böylece boş kurulumda da panel çalışır.
 */

/**
 * Yedek enflasyon varsayımları (yıllık).
 *
 * TEMSİLÎDİR. Resmî kaynaktan güncellenmeli: TÜFE için TÜİK,
 * euro bölgesi için Eurostat/ECB, ABD için BLS.
 */
export const FALLBACK_INFLATION: Record<string, string> = {
  TRY: "0.33",
  USD: "0.028",
  EUR: "0.021",
  GBP: "0.025",
  CHF: "0.011",
};

/** Para birimi listede yoksa kullanılacak varsayım. */
export const FALLBACK_INFLATION_OTHER = "0.03";

/**
 * Karşı-olgusal karşılaştırmanın referansları.
 *
 * `key` sabittir (ayar satırında oran bununla eşleşir), `label` ve
 * `annualReturn` sunum ve yedek değerdir.
 */
export const BENCHMARK_DEFS = [
  { key: "usd_deposit", label: "USD mevduat", fallback: "0.035" },
  { key: "gold", label: "Altın", fallback: "0.08" },
  { key: "sp500", label: "S&P 500", fallback: "0.10" },
] as const;

export type BenchmarkKey = (typeof BENCHMARK_DEFS)[number]["key"];

export interface Assumptions {
  /** Para birimi → yıllık enflasyon oranı (ondalık string). */
  inflation: Record<string, string>;
  /** Referans yıllık getiriler, sunum sırasına göre. */
  benchmarks: Array<{ key: BenchmarkKey; label: string; annualReturn: string }>;
  /**
   * Sermaye kazancı vergi oranı. "0" = tanımlanmamış; bu durumda
   * vergi tasarrufu tahmini yapılmaz.
   */
  capitalGainsRate: string;
}

/**
 * Bir oranın makul olup olmadığını denetler.
 *
 * Ayar satırı elle veya içe aktarmayla bozulabilir; bozuk bir değer
 * sessizce reel getiriyi anlamsızlaştırmaktansa yedeğe düşmeli.
 * Sınırlar geniş bilerek: yüksek enflasyonlu ülkelerde %100 üzeri
 * gerçek bir olasılık, ama %1000 girdi hatasıdır.
 */
function sane(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < -0.5 || n > 10) return null;
  return value;
}

/** Ayar satırından varsayımları okur, eksik/bozuk olanları yedekle tamamlar. */
export function loadAssumptions(): Assumptions {
  const cfg = db.select().from(settings).all()[0];

  const stored = cfg?.inflationRates ?? {};
  const inflation: Record<string, string> = { ...FALLBACK_INFLATION };
  for (const [currency, rate] of Object.entries(stored)) {
    const ok = sane(rate);
    if (ok !== null) inflation[currency] = ok;
  }

  const storedBenchmarks = cfg?.benchmarkReturns ?? {};
  const benchmarks = BENCHMARK_DEFS.map((b) => ({
    key: b.key,
    label: b.label,
    annualReturn: sane(storedBenchmarks[b.key]) ?? b.fallback,
  }));

  return {
    inflation,
    benchmarks,
    capitalGainsRate: sane(cfg?.capitalGainsRate) ?? "0",
  };
}

/** Bir para birimi için enflasyon varsayımı; listede yoksa genel yedek. */
export function inflationFor(
  currency: string,
  assumptions = loadAssumptions(),
): string {
  return assumptions.inflation[currency] ?? FALLBACK_INFLATION_OTHER;
}
