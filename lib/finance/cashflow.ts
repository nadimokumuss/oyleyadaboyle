import Decimal from "decimal.js";
import { Money, type CurrencyCode } from "@/lib/money";

/**
 * Nakit akışı ve finansal bağımsızlık ölçümü.
 *
 * Asıl metrik: pasif gelir kapsama oranı = pasif gelir / yaşam gideri.
 * %100'ü geçtiğinde çalışmak zorunda değilsiniz demektir — panelin
 * cevaplaması gereken en anlamlı soru bu.
 */

export type IncomeSource =
  | "interest"   // mevduat faizi
  | "rent"       // kira
  | "dividend"   // temettü
  | "staking"    // kripto getirisi
  | "venture"    // girişim kâr payı
  | "other";

export type ExpenseCategory =
  | "living"     // yaşam gideri
  | "property"   // aidat, emlak vergisi, bakım
  | "vehicle"    // sigorta, vergi, yakıt
  | "tax"        // stopaj ve vergiler
  | "venture"    // girişim yakımı
  | "other";

export interface FlowItem {
  label: string;
  /** Aylık tutar, ana para biriminde. */
  monthlyUsd: Money;
  source?: IncomeSource;
  category?: ExpenseCategory;
  /** Bu gelir pasif mi? Çalışma gerektirmiyor mu? */
  passive?: boolean;
}

export interface CashflowSummary {
  incomes: FlowItem[];
  expenses: FlowItem[];

  totalMonthlyIncome: Money;
  totalMonthlyExpense: Money;
  netMonthly: Money;

  /** Çalışmadan gelen aylık gelir. */
  passiveMonthlyIncome: Money;
  /** Aylık yaşam gideri (kullanıcı ayarı). */
  livingCost: Money;
  /**
   * Pasif gelir / yaşam gideri. 1 = finansal bağımsızlık.
   * Yaşam gideri girilmemişse null.
   */
  coverageRatio: Decimal | null;
  financiallyIndependent: boolean;
  /** Bağımsızlığa kalan aylık gelir açığı. */
  gapToIndependence: Money | null;

  byIncomeSource: Record<string, string>;
  byExpenseCategory: Record<string, string>;
}

export function summarize(
  incomes: FlowItem[],
  expenses: FlowItem[],
  livingCost: Money,
  currency: CurrencyCode = "USD",
): CashflowSummary {
  const totalMonthlyIncome = incomes.reduce(
    (a, i) => a.plus(i.monthlyUsd),
    Money.zero(currency),
  );
  const totalMonthlyExpense = expenses.reduce(
    (a, e) => a.plus(e.monthlyUsd),
    Money.zero(currency),
  );
  const passiveMonthlyIncome = incomes
    .filter((i) => i.passive !== false)
    .reduce((a, i) => a.plus(i.monthlyUsd), Money.zero(currency));

  const coverageRatio = livingCost.isZero()
    ? null
    : passiveMonthlyIncome.ratioTo(livingCost);

  const financiallyIndependent = coverageRatio
    ? coverageRatio.greaterThanOrEqualTo(1)
    : false;

  const gapToIndependence =
    livingCost.isZero() || financiallyIndependent
      ? null
      : livingCost.minus(passiveMonthlyIncome);

  return {
    incomes: [...incomes].sort((a, b) => b.monthlyUsd.amount.comparedTo(a.monthlyUsd.amount)),
    expenses: [...expenses].sort((a, b) => b.monthlyUsd.amount.comparedTo(a.monthlyUsd.amount)),
    totalMonthlyIncome,
    totalMonthlyExpense,
    netMonthly: totalMonthlyIncome.minus(totalMonthlyExpense),
    passiveMonthlyIncome,
    livingCost,
    coverageRatio,
    financiallyIndependent,
    gapToIndependence,
    byIncomeSource: group(incomes, (i) => i.source ?? "other", currency),
    byExpenseCategory: group(expenses, (e) => e.category ?? "other", currency),
  };
}

function group(
  items: FlowItem[],
  keyFn: (i: FlowItem) => string,
  currency: CurrencyCode,
): Record<string, string> {
  const out = new Map<string, Money>();
  for (const item of items) {
    const key = keyFn(item);
    out.set(key, (out.get(key) ?? Money.zero(currency)).plus(item.monthlyUsd));
  }
  return Object.fromEntries([...out.entries()].map(([k, v]) => [k, v.toDb()]));
}

/**
 * İleriye dönük nakit projeksiyonu.
 *
 * Net aylık akış birikimli olarak eklenir. Bu basit bir doğrusal
 * projeksiyondur — piyasa getirisi varsayımı içermez, çünkü nakit
 * akışı ile portföy getirisini karıştırmak yanıltıcı olur.
 */
export function projectCash(
  startingCash: Money,
  netMonthly: Money,
  months = 12,
): Array<{ month: number; cash: string }> {
  const out: Array<{ month: number; cash: string }> = [];
  let cash = startingCash;
  for (let m = 0; m <= months; m++) {
    out.push({ month: m, cash: cash.toDb() });
    cash = cash.plus(netMonthly);
  }
  return out;
}

export const INCOME_LABEL: Record<string, string> = {
  interest: "Faiz",
  rent: "Kira",
  dividend: "Temettü",
  staking: "Staking",
  venture: "Girişim",
  other: "Diğer",
};

export const EXPENSE_LABEL: Record<string, string> = {
  living: "Yaşam gideri",
  property: "Gayrimenkul giderleri",
  vehicle: "Araç giderleri",
  tax: "Vergi ve stopaj",
  venture: "Girişim yakımı",
  other: "Diğer",
};
