import Decimal from "decimal.js";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { assets, transactions, deposits } from "@/db/schema";
import { Money } from "@/lib/money";
import { getFx } from "@/lib/market/fxStore";
import { getQuotes } from "@/lib/market/registry";
import { computePosition } from "@/lib/finance/costbasis";
import { computeNetWorth } from "@/lib/valuation";
import { loadProperties, loadVehicles } from "@/lib/finance/assetService";
import { loadVentures } from "@/lib/finance/cashflowService";

/**
 * Planlanan varlıklar.
 *
 * Bu sayfanın cevapladığı soru: "almayı düşündüklerimi alırsam ne olur,
 * ve nakdim yetiyor mu?"
 *
 * Planlananlar net servete DAHİL DEĞİL — sahip olmadığınız bir evi
 * servetinize saymak, kendinizi olduğunuzdan zengin sanmanıza yol açar.
 * Burada ayrı hesaplanır ve "gerçekleşirse" senaryosu gösterilir.
 */

export interface PlannedItem {
  assetId: string;
  name: string;
  kind: string;
  currency: string;
  /** Planlanan alımın maliyeti, yerel para. */
  costLocal: string;
  costUsd: string;
  /** Varsa ek bilgi: konum, model, sembol… */
  detail: string | null;
  /** Alındıktan sonra aylık gelir katkısı (kira vb.). */
  monthlyIncomeUsd: string;
  /** Alındıktan sonra aylık gider yükü (aidat, sigorta vb.). */
  monthlyCostUsd: string;
  editHref: string;
}

export interface PlanView {
  items: PlannedItem[];
  totalCostUsd: string;

  /** Elde bulunan likit varlık (nakit + anında nakde çevrilebilir). */
  availableCashUsd: string;
  /** Nakit yeterli mi? */
  affordable: boolean;
  /** Yetmiyorsa açık. */
  shortfallUsd: string;

  /** Mevcut net servet. */
  currentNetWorthUsd: string;
  /**
   * Hepsi gerçekleşirse net servet.
   * Nakit varlığa dönüştüğü için toplam DEĞİŞMEZ — değişen, dağılım
   * ve likidite. Bunu göstermek önemli: "10M harcadım, hâlâ 10M'im var
   * ama artık nakit değil."
   */
  projectedNetWorthUsd: string;
  /** Alım sonrası kalan nakit. */
  remainingCashUsd: string;

  /** Aylık nakit akışına net etki. */
  monthlyIncomeDeltaUsd: string;
  monthlyCostDeltaUsd: string;
  monthlyNetDeltaUsd: string;

  /** Alım sonrası varlık sınıfı dağılımı. */
  projectedByKind: Record<string, string>;
  currentByKind: Record<string, string>;

  /** Nakdin düşüleceği hesap seçenekleri. */
  cashAccounts: Array<{ id: string; name: string; currency: string; balanceUsd: string }>;
}

export async function loadPlan(now = new Date()): Promise<PlanView> {
  const fx = await getFx();
  const nw = await computeNetWorth();

  const toUsd = (m: Money): Money =>
    fx.converter.has(m.currency) ? fx.converter.toBase(m) : Money.zero("USD");

  const plannedAssets = db
    .select()
    .from(assets)
    .where(eq(assets.status, "planned"))
    .all();

  const items: PlannedItem[] = [];

  /* --- Piyasa pozisyonları --- */
  const marketPlanned = plannedAssets.filter((a) =>
    ["equity", "crypto", "commodity"].includes(a.kind),
  );
  if (marketPlanned.length > 0) {
    const allTx = db.select().from(transactions).all();
    const symbols = marketPlanned.map((a) => a.symbol).filter((s): s is string => Boolean(s));
    const quotes = await getQuotes(symbols);
    const bySymbol = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));

    for (const a of marketPlanned) {
      const tx = allTx.filter((t) => t.assetId === a.id);
      const position = computePosition(a.id, a.currency, tx);
      const q = a.symbol ? bySymbol.get(a.symbol.toUpperCase()) : undefined;

      // Planlanan alımın maliyeti: girdiğiniz fiyat üzerinden.
      // Güncel fiyat farklıysa detayda gösterilir.
      const cost = position.totalCost;
      const currentPrice = q ? Money.of(q.price, q.currency) : null;
      const currentValue = currentPrice ? currentPrice.times(position.quantity) : null;

      let detail = a.symbol ?? null;
      if (currentValue && !cost.isZero()) {
        const diff = currentValue.minus(cost).ratioTo(cost);
        const pct = diff.times(100).toDecimalPlaces(1).toFixed();
        detail = `${a.symbol} · planladığınız fiyata göre şu an %${pct.replace(".", ",")}`;
      }

      items.push({
        assetId: a.id,
        name: a.name,
        kind: a.kind,
        currency: a.currency,
        costLocal: cost.toDb(),
        costUsd: toUsd(cost).toDb(),
        detail,
        monthlyIncomeUsd: "0",
        monthlyCostUsd: "0",
        editHref: `/ekle/pozisyon?id=${a.id}`,
      });
    }
  }

  /* --- Gayrimenkul --- */
  for (const p of await loadProperties(now, "planned")) {
    const cost = Money.of(p.totalCost, p.currency);
    const income = Money.of(p.annualGrossRent, p.currency).dividedBy(12);
    const costs = Money.of(p.annualCosts, p.currency).dividedBy(12);

    items.push({
      assetId: p.assetId,
      name: p.name,
      kind: "realestate",
      currency: p.currency,
      costLocal: cost.toDb(),
      costUsd: toUsd(cost).toDb(),
      detail: `${p.city}${p.indexLabel ? ` · ${p.indexLabel}` : ""}`,
      monthlyIncomeUsd: toUsd(income).toDb(),
      monthlyCostUsd: toUsd(costs).toDb(),
      editHref: `/ekle/gayrimenkul?id=${p.assetId}`,
    });
  }

  /* --- Araç --- */
  for (const v of await loadVehicles(now, "planned")) {
    const cost = Money.of(v.purchasePrice, v.currency);
    const costs = Money.of(v.annualCosts, v.currency).dividedBy(12);

    items.push({
      assetId: v.assetId,
      name: v.name,
      kind: "vehicle",
      currency: v.currency,
      costLocal: cost.toDb(),
      costUsd: toUsd(cost).toDb(),
      detail: `${v.make} ${v.model} · ${v.year} · ${v.segmentLabel}`,
      monthlyIncomeUsd: "0",
      monthlyCostUsd: toUsd(costs).toDb(),
      editHref: `/ekle/arac?id=${v.assetId}`,
    });
  }

  /* --- Girişim --- */
  for (const v of await loadVentures(now, "planned")) {
    const cost = Money.of(v.committedCapital, v.currency);
    const burn = Money.of(v.netMonthlyBurn, v.currency);

    items.push({
      assetId: v.assetId,
      name: v.name,
      kind: "venture",
      currency: v.currency,
      costLocal: cost.toDb(),
      costUsd: toUsd(cost).toDb(),
      detail: `${v.legalName}${v.stage ? ` · ${v.stage}` : ""}`,
      monthlyIncomeUsd: burn.isNegative() ? toUsd(burn.negated()).toDb() : "0",
      monthlyCostUsd: burn.isPositive() ? toUsd(burn).toDb() : "0",
      editHref: `/ekle/girisim?id=${v.assetId}`,
    });
  }

  /* --- Mevduat (planlanan) --- */
  const plannedDeposits = plannedAssets.filter((a) => a.kind === "deposit");
  for (const a of plannedDeposits) {
    const d = db.select().from(deposits).where(eq(deposits.assetId, a.id)).get();
    if (!d) continue;
    const cost = Money.of(d.principal, a.currency);
    items.push({
      assetId: a.id,
      name: a.name,
      kind: "deposit",
      currency: a.currency,
      costLocal: cost.toDb(),
      costUsd: toUsd(cost).toDb(),
      detail: `%${(Number(d.annualRate) * 100).toFixed(1).replace(".", ",")} faiz`,
      monthlyIncomeUsd: "0",
      monthlyCostUsd: "0",
      editHref: `/ekle/mevduat?id=${a.id}`,
    });
  }

  items.sort((a, b) => Number(b.costUsd) - Number(a.costUsd));

  /* --- Toplamlar --- */
  const totalCost = items.reduce(
    (acc, i) => acc.plus(Money.of(i.costUsd, "USD")),
    Money.zero("USD"),
  );

  // Likit varlık: nakit + anında nakde çevrilebilir olanlar
  const liquid = nw.assets
    .filter((a) => a.kind === "cash" || a.liquidity === "instant")
    .reduce((acc, a) => acc.plus(a.valueUsd), Money.zero("USD"));

  const shortfall = totalCost.minus(liquid);
  const affordable = !shortfall.isPositive();

  const monthlyIncome = items.reduce(
    (acc, i) => acc.plus(Money.of(i.monthlyIncomeUsd, "USD")),
    Money.zero("USD"),
  );
  const monthlyCost = items.reduce(
    (acc, i) => acc.plus(Money.of(i.monthlyCostUsd, "USD")),
    Money.zero("USD"),
  );

  /* --- Alım sonrası dağılım --- */
  const projectedByKind: Record<string, Decimal> = {};
  for (const [kind, value] of Object.entries(nw.byKind)) {
    projectedByKind[kind] = new Decimal(value);
  }
  // Nakit azalır, hedef sınıflar artar
  projectedByKind.cash = (projectedByKind.cash ?? new Decimal(0)).minus(
    totalCost.amount,
  );
  for (const item of items) {
    projectedByKind[item.kind] = (projectedByKind[item.kind] ?? new Decimal(0)).plus(
      item.costUsd,
    );
  }

  const cashAccounts = nw.assets
    .filter((a) => a.kind === "cash")
    .map((a) => ({
      id: a.assetId,
      name: a.name,
      currency: a.currency,
      balanceUsd: a.valueUsd.toDb(),
    }));

  return {
    items,
    totalCostUsd: totalCost.toDb(),
    availableCashUsd: liquid.toDb(),
    affordable,
    shortfallUsd: shortfall.isPositive() ? shortfall.toDb() : "0",
    currentNetWorthUsd: nw.totalUsd.toDb(),
    // Nakit varlığa dönüşür: toplam servet aynı kalır
    projectedNetWorthUsd: nw.totalUsd.toDb(),
    remainingCashUsd: liquid.minus(totalCost).toDb(),
    monthlyIncomeDeltaUsd: monthlyIncome.toDb(),
    monthlyCostDeltaUsd: monthlyCost.toDb(),
    monthlyNetDeltaUsd: monthlyIncome.minus(monthlyCost).toDb(),
    projectedByKind: Object.fromEntries(
      Object.entries(projectedByKind).map(([k, v]) => [k, v.toFixed()]),
    ),
    currentByKind: nw.byKind,
    cashAccounts,
  };
}
