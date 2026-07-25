import Decimal from "decimal.js";
import { db } from "@/db/client";
import { assets, deposits, withholdingRates } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Money } from "@/lib/money";
import {
  accrue,
  earningsRate,
  effectiveAnnualRate,
  analyzeRealReturn,
  resolveWithholdingRate,
  counterfactualValue,
  type DepositTerms,
  type Compounding,
  type DayCount,
} from "./deposit";

/**
 * DB satırlarını faiz motorunun anlayacağı `DepositTerms`'e çevirir ve
 * arayüzün ihtiyaç duyduğu tüm türev bilgileri üretir.
 *
 * Stopaj oranı burada çözülür: kullanıcı elle bir oran girdiyse o,
 * girmediyse vade ve para birimine göre DB'deki kademeli tablodan.
 */

/** Türkiye yıllık TÜFE varsayımı — ayarlardan güncellenebilir olmalı. */
const DEFAULT_INFLATION: Record<string, string> = {
  TRY: "0.33",
  USD: "0.028",
  EUR: "0.021",
};

/** Karşı-olgusal karşılaştırma için referans yıllık getiriler. */
const BENCHMARKS = [
  { key: "usd_deposit", label: "USD mevduat", annualReturn: "0.035" },
  { key: "gold", label: "Altın", annualReturn: "0.08" },
  { key: "sp500", label: "S&P 500", annualReturn: "0.10" },
] as const;

const MS_PER_DAY = 86_400_000;

export function loadWithholdingRules() {
  return db
    .select()
    .from(withholdingRates)
    .all()
    .map((r) => ({
      currency: r.currency,
      maxTermDays: r.maxTermDays,
      rate: r.rate,
    }));
}

export function buildTerms(
  row: typeof deposits.$inferSelect,
  currency: string,
  rules = loadWithholdingRules(),
): DepositTerms {
  const startDate = new Date(row.startDate);
  const maturityDate = row.maturityDate ? new Date(row.maturityDate) : null;

  const termDays = maturityDate
    ? Math.round((maturityDate.getTime() - startDate.getTime()) / MS_PER_DAY)
    : null;

  const withholdingRate = row.withholdingRateOverride
    ? new Decimal(row.withholdingRateOverride)
    : resolveWithholdingRate(rules, currency, termDays);

  return {
    principal: Money.of(row.principal, currency),
    annualRate: new Decimal(row.annualRate),
    compounding: row.compounding as Compounding,
    dayCount: row.dayCount as DayCount,
    startDate,
    maturityDate,
    withholdingRate,
  };
}

export interface DepositView {
  assetId: string;
  name: string;
  institution: string | null;
  currency: string;
  /** Motorun ihtiyaç duyduğu parametreler — istemci sayacı bunlarla çalışır. */
  params: {
    principal: string;
    annualRate: string;
    compounding: Compounding;
    dayCount: DayCount;
    startDate: string;
    maturityDate: string | null;
    withholdingRate: string;
  };
  /** Sunucudaki anlık durum (istemci bunu kendi saatiyle ileri sarar). */
  snapshot: {
    balance: string;
    grossInterest: string;
    withholding: string;
    netInterest: string;
    netBalance: string;
    daysToMaturity: number | null;
    matured: boolean;
  };
  rates: {
    perSecond: string;
    perHour: string;
    perDay: string;
    perWeek: string;
    perMonth: string;
    perYear: string;
  };
  apy: string;
  real: {
    netNominalAnnual: string;
    realAnnual: string;
    losingToInflation: boolean;
    purchasingPowerChange: string;
    inflationAssumed: string;
  };
  counterfactuals: Array<{ key: string; label: string; value: string; delta: string }>;
}

export function loadDeposits(now = new Date()): DepositView[] {
  const rules = loadWithholdingRules();

  const rows = db
    .select({ deposit: deposits, asset: assets })
    .from(deposits)
    .innerJoin(assets, eq(deposits.assetId, assets.id))
    .all()
    .filter((r) => r.asset.status === "active");

  return rows.map(({ deposit, asset }) => {
    const terms = buildTerms(deposit, asset.currency, rules);
    const snap = accrue(terms, now);
    const rate = earningsRate(terms, now, true);
    const inflation = DEFAULT_INFLATION[asset.currency] ?? "0.03";
    const real = analyzeRealReturn(terms, inflation);

    const elapsedYears = snap.elapsedYears;
    const counterfactuals = BENCHMARKS.map((b) => {
      const value = counterfactualValue(terms.principal, b.annualReturn, elapsedYears);
      return {
        key: b.key,
        label: b.label,
        value: value.toDb(),
        delta: value.minus(snap.netBalance).toDb(),
      };
    });

    return {
      assetId: asset.id,
      name: asset.name,
      institution: null,
      currency: asset.currency,
      params: {
        principal: terms.principal.toDb(),
        annualRate: terms.annualRate.toFixed(),
        compounding: terms.compounding,
        dayCount: terms.dayCount,
        startDate: terms.startDate.toISOString(),
        maturityDate: terms.maturityDate?.toISOString() ?? null,
        withholdingRate: terms.withholdingRate.toFixed(),
      },
      snapshot: {
        balance: snap.balance.toDb(),
        grossInterest: snap.grossInterest.toDb(),
        withholding: snap.withholding.toDb(),
        netInterest: snap.netInterest.toDb(),
        netBalance: snap.netBalance.toDb(),
        daysToMaturity: snap.daysToMaturity,
        matured: snap.matured,
      },
      rates: {
        perSecond: rate.perSecond.toDb(),
        perHour: rate.perHour.toDb(),
        perDay: rate.perDay.toDb(),
        perWeek: rate.perWeek.toDb(),
        perMonth: rate.perMonth.toDb(),
        perYear: rate.perYear.toDb(),
      },
      apy: effectiveAnnualRate(terms).toFixed(),
      real: {
        netNominalAnnual: real.netNominalAnnual.toFixed(),
        realAnnual: real.realAnnual.toFixed(),
        losingToInflation: real.losingToInflation,
        purchasingPowerChange: real.purchasingPowerChange.toDb(),
        inflationAssumed: inflation,
      },
      counterfactuals,
    };
  });
}

/** valuation.ts için: mevduatın o anki brüt bakiyesi. */
export function depositBalance(
  row: typeof deposits.$inferSelect,
  currency: string,
  rules: ReturnType<typeof loadWithholdingRules>,
  now = new Date(),
): { balance: Money; netBalance: Money } {
  const terms = buildTerms(row, currency, rules);
  const snap = accrue(terms, now);
  return { balance: snap.balance, netBalance: snap.netBalance };
}
