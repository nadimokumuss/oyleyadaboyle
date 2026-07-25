import Decimal from "decimal.js";
import { Money } from "@/lib/money";

/**
 * Senaryo simülasyonu: Monte Carlo ve stres testi.
 *
 * Monte Carlo tek bir "gelecekte şu kadar paranız olacak" sayısı yerine
 * bir OLASILIK DAĞILIMI üretir. Tek sayı vermek yanıltıcıdır — gerçek
 * hayatta sonuç bir aralıktır ve o aralığın genişliği riskin kendisidir.
 *
 * Hesap float ile yapılır (Decimal 10.000 yol × 30 yıl için çok yavaş
 * kalırdı), ama sonuçlar Decimal'a çevrilerek döner. Simülasyon zaten
 * bir tahmindir; kuruş hassasiyeti anlamsız, hız anlamlıdır.
 */

export interface AssetClassAssumption {
  key: string;
  label: string;
  /** Portföydeki ağırlık (0-1). */
  weight: number;
  /** Beklenen yıllık reel getiri. */
  expectedReturn: number;
  /** Yıllık volatilite (standart sapma). */
  volatility: number;
}

/**
 * Varsayılan uzun vadeli getiri/risk varsayımları.
 * TEMSİLÎdir — geçmiş performans gelecek getiriyi garanti etmez.
 */
export const DEFAULT_ASSUMPTIONS: Record<string, { expectedReturn: number; volatility: number }> = {
  equity: { expectedReturn: 0.07, volatility: 0.16 },
  crypto: { expectedReturn: 0.12, volatility: 0.65 },
  commodity: { expectedReturn: 0.03, volatility: 0.15 },
  deposit: { expectedReturn: 0.005, volatility: 0.01 },
  cash: { expectedReturn: -0.02, volatility: 0.005 },
  realestate: { expectedReturn: 0.035, volatility: 0.10 },
  vehicle: { expectedReturn: -0.12, volatility: 0.05 },
  venture: { expectedReturn: 0.15, volatility: 0.55 },
};

export interface SimulationInput {
  initialValue: number;
  assumptions: AssetClassAssumption[];
  years: number;
  paths: number;
  /** Yıllık net nakit ekleme (pozitif) veya çekme (negatif). */
  annualContribution?: number;
  seed?: number;
}

export interface SimulationResult {
  years: number;
  paths: number;
  /** Her yıl için persentil bantları. */
  percentiles: Array<{
    year: number;
    p10: string;
    p25: string;
    p50: string;
    p75: string;
    p90: string;
  }>;
  finalP10: string;
  finalP50: string;
  finalP90: string;
  /** Başlangıç değerinin altına düşme olasılığı. */
  probabilityOfLoss: string;
  /** Portföyün ağırlıklı beklenen getirisi ve volatilitesi. */
  portfolioReturn: string;
  portfolioVolatility: string;
}

/** Tekrarlanabilir sonuçlar için basit ve hızlı PRNG (mulberry32). */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller: düzgün dağılımdan normal dağılım üretir. */
function makeNormal(rng: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = rng() * 2 - 1;
      v = rng() * 2 - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * mul;
    return u * mul;
  };
}

export function simulate(input: SimulationInput): SimulationResult {
  const { initialValue, assumptions, years, paths } = input;
  const contribution = input.annualContribution ?? 0;

  // Portföy düzeyinde beklenen getiri ve volatilite.
  // NOT: volatilite basitçe ağırlıklı toplanıyor; gerçekte korelasyon
  // matrisi gerekir ve çeşitlendirme volatiliteyi düşürür. Bu haliyle
  // model KARAMSAR tarafta kalır — riski olduğundan büyük gösterir,
  // ki bu yanılmanın güvenli yönüdür.
  const totalWeight = assumptions.reduce((a, x) => a + x.weight, 0) || 1;
  const mu =
    assumptions.reduce((a, x) => a + x.weight * x.expectedReturn, 0) / totalWeight;
  const sigma =
    assumptions.reduce((a, x) => a + x.weight * x.volatility, 0) / totalWeight;

  const rng = makeRng(input.seed ?? 42);
  const normal = makeNormal(rng);

  // yearlyValues[yıl][yol]
  const yearlyValues: number[][] = Array.from({ length: years + 1 }, () =>
    new Array<number>(paths),
  );

  for (let p = 0; p < paths; p++) {
    let value = initialValue;
    yearlyValues[0][p] = value;

    for (let y = 1; y <= years; y++) {
      // Geometrik Brownian hareket: log-normal getiri.
      // Aritmetik normal kullanmak değerin negatife inmesine izin verirdi.
      const drift = mu - (sigma * sigma) / 2;
      const shock = sigma * normal();
      value = value * Math.exp(drift + shock) + contribution;
      if (value < 0) value = 0;
      yearlyValues[y][p] = value;
    }
  }

  const percentiles = yearlyValues.map((values, year) => {
    const sorted = [...values].sort((a, b) => a - b);
    return {
      year,
      p10: fmt(quantile(sorted, 0.1)),
      p25: fmt(quantile(sorted, 0.25)),
      p50: fmt(quantile(sorted, 0.5)),
      p75: fmt(quantile(sorted, 0.75)),
      p90: fmt(quantile(sorted, 0.9)),
    };
  });

  const finalValues = yearlyValues[years];
  const lossCount = finalValues.filter((v) => v < initialValue).length;
  const finalSorted = [...finalValues].sort((a, b) => a - b);

  return {
    years,
    paths,
    percentiles,
    finalP10: fmt(quantile(finalSorted, 0.1)),
    finalP50: fmt(quantile(finalSorted, 0.5)),
    finalP90: fmt(quantile(finalSorted, 0.9)),
    probabilityOfLoss: new Decimal(lossCount).dividedBy(paths).toFixed(),
    portfolioReturn: new Decimal(mu).toFixed(),
    portfolioVolatility: new Decimal(sigma).toFixed(),
  };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next !== undefined ? sorted[base] + rest * (next - sorted[base]) : sorted[base];
}

function fmt(n: number): string {
  return new Decimal(n).toDecimalPlaces(2).toFixed();
}

/* ------------------------------------------------------------------ */
/* Stres testi                                                         */
/* ------------------------------------------------------------------ */

export interface StressScenario {
  key: string;
  label: string;
  description: string;
  /** Varlık sınıfına uygulanacak şok oranı (-0.4 = %40 düşüş). */
  shocks: Record<string, number>;
}

export const STRESS_SCENARIOS: StressScenario[] = [
  {
    key: "equityCrash",
    label: "Borsa çöküşü",
    description: "Hisse senetleri %40, kripto %60 düşer.",
    shocks: { equity: -0.40, crypto: -0.60, venture: -0.30, commodity: -0.10 },
  },
  {
    key: "fxShock",
    label: "Kur şoku",
    description: "TL %50 değer kaybeder — TL varlıklar USD bazında erir.",
    shocks: { __currency_TRY: -0.3333 },
  },
  {
    key: "propertyCrash",
    label: "Gayrimenkul düzeltmesi",
    description: "Konut fiyatları %25 geriler, araçlar %20 değer kaybeder.",
    shocks: { realestate: -0.25, vehicle: -0.20 },
  },
  {
    key: "ventureWipeout",
    label: "Girişimler sıfırlanır",
    description: "Tüm girişim yatırımları tamamen değersizleşir.",
    shocks: { venture: -1.0 },
  },
  {
    key: "perfectStorm",
    label: "Mükemmel fırtına",
    description: "Hepsi aynı anda: borsa, kur, gayrimenkul ve girişimler.",
    shocks: {
      equity: -0.40, crypto: -0.60, realestate: -0.25,
      vehicle: -0.20, venture: -1.0, __currency_TRY: -0.3333,
    },
  },
];

export interface StressResult {
  key: string;
  label: string;
  description: string;
  before: string;
  after: string;
  loss: string;
  lossRatio: string;
  /** En çok etkilenen varlıklar. */
  impacts: Array<{ name: string; loss: string }>;
}

export interface StressAsset {
  name: string;
  kind: string;
  currency: string;
  valueUsd: Money;
}

export function runStressTest(
  assets: StressAsset[],
  scenario: StressScenario,
): StressResult {
  const before = assets.reduce((a, x) => a.plus(x.valueUsd), Money.zero("USD"));
  const impacts: Array<{ name: string; loss: string }> = [];

  const after = assets.reduce((acc, asset) => {
    // Varlık sınıfı şoku ve para birimi şoku birlikte uygulanır
    const kindShock = scenario.shocks[asset.kind] ?? 0;
    const fxShock = scenario.shocks[`__currency_${asset.currency}`] ?? 0;

    // (1+a)(1+b) — iki şok çarpımsal birleşir, toplamsal değil
    const factor = (1 + kindShock) * (1 + fxShock);
    const shocked = asset.valueUsd.times(Math.max(0, factor));
    const loss = asset.valueUsd.minus(shocked);

    if (loss.isPositive()) {
      impacts.push({ name: asset.name, loss: loss.toDb() });
    }
    return acc.plus(shocked);
  }, Money.zero("USD"));

  const loss = before.minus(after);

  return {
    key: scenario.key,
    label: scenario.label,
    description: scenario.description,
    before: before.toDb(),
    after: after.toDb(),
    loss: loss.toDb(),
    lossRatio: before.isZero() ? "0" : loss.ratioTo(before).toFixed(),
    impacts: impacts.sort((a, b) => Number(b.loss) - Number(a.loss)).slice(0, 5),
  };
}
