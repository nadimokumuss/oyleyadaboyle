import Decimal from "decimal.js";
import { db } from "@/db/client";
import { settings, targets } from "@/db/schema";
import { Money } from "@/lib/money";
import { getFx } from "@/lib/market/fxStore";
import { computeNetWorth } from "@/lib/valuation";
import { loadPortfolio } from "@/lib/finance/portfolioService";
import { loadDeposits } from "@/lib/finance/depositService";
import { loadProperties, loadVehicles } from "@/lib/finance/assetService";
import { loadVentures, loadCashflow } from "@/lib/finance/cashflowService";
import { RULES } from "./rules";
import { SEVERITY_RANK, type Opportunity, type PortfolioState } from "./types";

/**
 * Fırsat tarayıcısı: portföyün tam görüntüsünü toplar, tüm kuralları
 * çalıştırır, sonuçları önem sırasına dizer.
 *
 * Bir kural hata verirse tarama durmaz — o kural atlanır ve diğerleri
 * çalışır. Tek bozuk kural yüzünden tüm fırsat listesini kaybetmek
 * kabul edilemez.
 */

export async function buildState(now = new Date()): Promise<PortfolioState> {
  const [netWorth, portfolio, properties, vehicles, ventures, cashflow] =
    await Promise.all([
      computeNetWorth(),
      loadPortfolio(),
      loadProperties(now),
      loadVehicles(now),
      loadVentures(now),
      loadCashflow(now),
    ]);

  const cfg = db.select().from(settings).all()[0];
  const targetRows = db.select().from(targets).all();
  const fx = await getFx();

  return {
    netWorth,
    portfolio,
    deposits: loadDeposits(now),
    properties,
    vehicles,
    ventures,
    cashflow,
    settings: {
      idleCashThreshold: new Decimal(cfg?.idleCashThreshold ?? "50000"),
      concentrationThreshold: new Decimal(cfg?.concentrationThreshold ?? "0.25"),
      riskProfile: cfg?.riskProfile ?? "balanced",
    },
    toUsd: (money: Money) =>
      fx.converter.has(money.currency)
        ? fx.converter.toBase(money)
        : Money.zero("USD"),
    targets: targetRows.map((t) => ({
      dimension: t.dimension,
      key: t.key,
      targetPct: new Decimal(t.targetPct),
      tolerancePct: new Decimal(t.tolerancePct),
    })),
    now,
  };
}

export interface ScanResult {
  opportunities: Opportunity[];
  /** Değerlendirilebilen fırsatların toplam aylık kazanç tahmini. */
  totalMonthlyGain: Money;
  /** Hata veren kurallar — sessizce yutulmaz, arayüzde gösterilir. */
  failedRules: Array<{ key: string; message: string }>;
  scannedAt: Date;
  ruleCount: number;
}

export async function scan(now = new Date()): Promise<ScanResult> {
  const state = await buildState(now);
  return scanState(state);
}

/** Durum hazırsa doğrudan tarar — test edilebilir saf kısım. */
export function scanState(state: PortfolioState): ScanResult {
  const opportunities: Opportunity[] = [];
  const failedRules: Array<{ key: string; message: string }> = [];

  for (const rule of RULES) {
    try {
      const result = rule.evaluate(state);
      if (!result) continue;
      if (Array.isArray(result)) opportunities.push(...result);
      else opportunities.push(result);
    } catch (err) {
      failedRules.push({ key: rule.key, message: (err as Error).message });
    }
  }

  // Önem sırası, sonra tahmini kazanç büyüklüğü
  opportunities.sort((a, b) => {
    const rank = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (rank !== 0) return rank;
    const ag = a.estimatedMonthlyGain?.amount ?? new Decimal(0);
    const bg = b.estimatedMonthlyGain?.amount ?? new Decimal(0);
    return bg.comparedTo(ag);
  });

  const totalMonthlyGain = opportunities.reduce(
    (acc, o) => (o.estimatedMonthlyGain ? acc.plus(o.estimatedMonthlyGain) : acc),
    Money.zero("USD"),
  );

  return {
    opportunities,
    totalMonthlyGain,
    failedRules,
    scannedAt: state.now,
    ruleCount: RULES.length,
  };
}
