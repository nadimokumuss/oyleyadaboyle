import Decimal from "decimal.js";
import { db } from "@/db/client";
import { assets, ventures, settings, transactions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { computePosition } from "./costbasis";
import { Money } from "@/lib/money";
import { getFx } from "@/lib/market/fxStore";
import { FxConverter } from "@/lib/fx";
import { computeVentureMetrics, cashProjection, type VentureMetrics } from "./venture";
import { summarize, projectCash, type FlowItem, type CashflowSummary } from "./cashflow";
import { loadDeposits } from "./depositService";
import { loadProperties, loadVehicles } from "./assetService";
import { loadLiabilities } from "@/lib/services/liabilities";

/**
 * Girişim ve nakit akışı görünümleri.
 *
 * Nakit akışı tüm modüllerden beslenir: mevduat faizi, kira, girişim
 * kârı gelir tarafında; aidat, araç gideri, girişim yakımı gider
 * tarafında. Bu yüzden diğer servisleri çağırır — tek bir yerde
 * toplanmazsa "gerçekten ne kadar kazanıyorum" sorusu cevapsız kalır.
 */

export interface VentureView {
  assetId: string;
  name: string;
  status: string;
  legalName: string;
  country: string;
  sector: string | null;
  stage: string | null;
  currency: string;
  ownershipPct: string;
  committedCapital: string;
  calledCapital: string;
  uncalledCapital: string;
  valuation: string | null;
  valuationDate: string | null;

  positionValue: string;
  positionValueUsd: string;
  moic: string | null;
  monthlyRevenue: string;
  monthlyBurn: string;
  netMonthlyBurn: string;
  cashOnHand: string;
  runwayMonths: string | null;
  runwayEndsAt: string | null;
  breakevenProgress: string | null;
  profitable: boolean;
  alert: VentureMetrics["alert"];
  projection: Array<{ month: number; cash: string }>;
}

export async function loadVentures(
  now = new Date(),
  status: "active" | "planned" = "active",
): Promise<VentureView[]> {
  const fx = await getFx();

  const rows = db
    .select({ v: ventures, a: assets })
    .from(ventures)
    .innerJoin(assets, eq(ventures.assetId, assets.id))
    .all()
    .filter((r) => r.a.status === status);

  return rows.map(({ v, a }) => {
    const c = a.currency;
    const input = {
      ownershipPct: new Decimal(v.ownershipPct),
      committedCapital: Money.of(v.committedCapital, c),
      calledCapital: Money.fromDb(v.calledCapital, c),
      valuation: v.valuation ? Money.of(v.valuation, c) : null,
      monthlyRevenue: Money.fromDb(v.monthlyRevenue, c),
      monthlyBurn: Money.fromDb(v.monthlyBurn, c),
      cashOnHand: Money.fromDb(v.cashOnHand, c),
    };
    const m = computeVentureMetrics(input, now);

    return {
      assetId: a.id,
      name: a.name,
      status: a.status,
      legalName: v.legalName,
      country: v.country,
      sector: v.sector,
      stage: v.stage,
      currency: c,
      ownershipPct: v.ownershipPct,
      committedCapital: v.committedCapital,
      calledCapital: v.calledCapital ?? "0",
      uncalledCapital: m.uncalledCapital.toDb(),
      valuation: v.valuation,
      valuationDate: v.valuationDate,
      positionValue: m.positionValue.toDb(),
      positionValueUsd: fx.converter.has(c)
        ? fx.converter.toBase(m.positionValue).toDb()
        : "0",
      moic: m.moic?.toFixed() ?? null,
      monthlyRevenue: v.monthlyRevenue ?? "0",
      monthlyBurn: v.monthlyBurn ?? "0",
      netMonthlyBurn: m.netMonthlyBurn.toDb(),
      cashOnHand: v.cashOnHand ?? "0",
      runwayMonths: m.runwayMonths?.toFixed() ?? null,
      runwayEndsAt: m.runwayEndsAt?.toISOString() ?? null,
      breakevenProgress: m.breakevenProgress?.toFixed() ?? null,
      profitable: m.profitable,
      alert: m.alert,
      projection: cashProjection(input.cashOnHand, m.netMonthlyBurn, 18),
    };
  });
}

/* ------------------------------------------------------------------ */

export interface CashflowView extends CashflowSummary {
  projection: Array<{ month: number; cash: string }>;
  startingCash: string;
}

/** Tüm modüllerden aylık gelir ve giderleri toplar. */
export async function loadCashflow(now = new Date()): Promise<CashflowView> {
  const fx = await getFx();
  const cfg = db.select().from(settings).all()[0];

  const toUsd = (m: Money): Money =>
    fx.converter.has(m.currency) ? fx.converter.toBase(m) : Money.zero("USD");

  const incomes: FlowItem[] = [];
  const expenses: FlowItem[] = [];

  // --- Mevduat faizi (net, stopaj sonrası) ---
  for (const d of loadDeposits(now)) {
    const monthly = Money.of(d.rates.perMonth, d.currency);
    if (monthly.isPositive()) {
      incomes.push({
        label: `${d.name} faizi`,
        monthlyUsd: toUsd(monthly),
        source: "interest",
        passive: true,
      });
    }
  }

  // --- Kira geliri ve gayrimenkul giderleri ---
  for (const p of await loadProperties(now)) {
    const grossMonthly = Money.of(p.annualGrossRent, p.currency).dividedBy(12);
    const costMonthly = Money.of(p.annualCosts, p.currency).dividedBy(12);

    if (grossMonthly.isPositive()) {
      incomes.push({
        label: `${p.name} kirası`,
        monthlyUsd: toUsd(grossMonthly),
        source: "rent",
        passive: true,
      });
    }
    if (costMonthly.isPositive()) {
      expenses.push({
        label: `${p.name} giderleri`,
        monthlyUsd: toUsd(costMonthly),
        category: "property",
      });
    }
  }

  // --- Araç giderleri ---
  for (const v of await loadVehicles(now)) {
    const monthly = Money.of(v.annualCosts, v.currency).dividedBy(12);
    if (monthly.isPositive()) {
      expenses.push({
        label: `${v.name} giderleri`,
        monthlyUsd: toUsd(monthly),
        category: "vehicle",
      });
    }
  }

  // --- Girişimler ---
  for (const v of await loadVentures(now)) {
    const net = Money.of(v.netMonthlyBurn, v.currency);
    if (net.isPositive()) {
      // Yakıyor → gider
      expenses.push({
        label: `${v.name} yakımı`,
        monthlyUsd: toUsd(net),
        category: "venture",
      });
    } else if (net.isNegative()) {
      // Kâr ediyor → sahiplik payı kadarı gelir
      const share = net.negated().times(v.ownershipPct);
      incomes.push({
        label: `${v.name} kârı`,
        monthlyUsd: toUsd(share),
        source: "venture",
        // Girişim kârı pasif değil — işletmek emek ister
        passive: false,
      });
    }
  }

  // --- Kredi taksitleri ---
  for (const l of await loadLiabilities(now)) {
    if (l.settled) continue;
    const payment = Money.of(l.monthlyPaymentUsd, "USD");
    if (payment.isPositive()) {
      expenses.push({
        label: `${l.name} taksiti`,
        monthlyUsd: payment,
        category: "other",
      });
    }
  }

  // --- Yaşam gideri ---
  const livingCost = Money.fromDb(
    cfg?.monthlyLivingCost ?? "0",
    cfg?.livingCostCurrency ?? "USD",
  );
  const livingCostUsd = toUsd(livingCost);
  if (livingCostUsd.isPositive()) {
    expenses.push({
      label: "Yaşam gideri",
      monthlyUsd: livingCostUsd,
      category: "living",
    });
  }

  const summary = summarize(incomes, expenses, livingCostUsd);

  // Projeksiyon serbest nakitten başlar
  const startingCash = freeCash(fx.converter);

  return {
    ...summary,
    startingCash: startingCash.toDb(),
    projection: projectCash(startingCash, summary.netMonthly, 12),
  };
}

/**
 * Nakit varlıkların USD toplamı.
 *
 * Bakiye saklanmaz, işlemlerden türetilir (şemanın temel kuralı):
 * girişler artı, çıkışlar ve giderler eksi.
 */
function freeCash(converter: FxConverter): Money {
  const cashAssets = db
    .select()
    .from(assets)
    .where(eq(assets.kind, "cash"))
    .all()
    .filter((a) => a.status === "active");

  if (cashAssets.length === 0) return Money.zero("USD");

  const allTx = db.select().from(transactions).all();

  return cashAssets.reduce((total, asset) => {
    const position = computePosition(
      asset.id,
      asset.currency,
      allTx.filter((t) => t.assetId === asset.id),
    );
    const net = position.totalCost
      .plus(position.incomeReceived)
      .minus(position.costsPaid);
    return total.plus(
      converter.has(net.currency) ? converter.toBase(net) : Money.zero("USD"),
    );
  }, Money.zero("USD"));
}
