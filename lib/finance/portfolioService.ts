import Decimal from "decimal.js";
import { db } from "@/db/client";
import { assets, transactions, accounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Money, type CurrencyCode } from "@/lib/money";
import { getFx } from "@/lib/market/fxStore";
import { getQuotes } from "@/lib/market/registry";
import { computePosition, valuePosition } from "./costbasis";
import { attributeReturn } from "@/lib/fx";
import { xirr, concentration, type CashFlow } from "./metrics";

/**
 * Piyasa portföyü görünümü: pozisyonlar, canlı değerleme, K/Z ve risk.
 *
 * Mevduat/gayrimenkul buraya girmez — burası sadece fiyatı piyasada
 * oluşan varlıklar için (hisse, kripto, emtia).
 */

const MARKET_KINDS = ["equity", "crypto", "commodity"] as const;

export interface PositionView {
  assetId: string;
  name: string;
  symbol: string | null;
  kind: string;
  country: string | null;
  institution: string | null;
  currency: CurrencyCode;

  quantity: string;
  wacPerUnit: string;
  livePrice: string | null;
  priceBasis: "live" | "stale" | "none";
  priceAgeMs: number | null;
  changePct24h: string | null;

  costLocal: string;
  valueLocal: string;
  unrealizedPnl: string;
  returnRatio: string | null;

  valueUsd: string;
  costUsd: string;
  /** Portföy içindeki ağırlık (0-1). */
  weight: string;

  realizedPnl: string;
  realizedPnlFifo: string;
  incomeReceived: string;
  /** Zarardaki lot sayısı — vergi mahsubu taraması için. */
  losingLots: number;

  /** Kur etkisi ayrıştırması (yabancı para varlıklarda). */
  attribution: {
    priceReturn: string;
    fxReturn: string;
    crossTerm: string;
    totalReturn: string;
  } | null;
}

export interface PortfolioView {
  positions: PositionView[];
  totals: {
    valueUsd: string;
    costUsd: string;
    unrealizedPnlUsd: string;
    realizedPnlUsd: string;
    incomeUsd: string;
    returnRatio: string | null;
  };
  risk: {
    /** Herfindahl yoğunlaşma endeksi (1 = tek varlık). */
    hhi: string;
    /** En büyük pozisyonun ağırlığı. */
    topWeight: string;
    topName: string | null;
    /** Etkin varlık sayısı = 1/HHI. */
    effectiveCount: string;
    /** Yoğunlaşma eşiğini aşan pozisyonlar. */
    concentrated: Array<{ name: string; weight: string }>;
  };
  /** Tüm portföyün para-ağırlıklı yıllık getirisi. */
  xirr: string | null;
  byKind: Record<string, string>;
  byCurrency: Record<string, string>;
  staleCount: number;
  fxDate: string;
  fxStale: boolean;
}

const CONCENTRATION_LIMIT = new Decimal("0.20");

export async function loadPortfolio(): Promise<PortfolioView> {
  const fx = await getFx();

  const rows = db
    .select({ asset: assets, account: accounts })
    .from(assets)
    .leftJoin(accounts, eq(assets.accountId, accounts.id))
    .all()
    .filter(
      (r) =>
        r.asset.status === "active" &&
        (MARKET_KINDS as readonly string[]).includes(r.asset.kind),
    );

  const symbols = rows.map((r) => r.asset.symbol).filter((s): s is string => Boolean(s));
  const quotes = await getQuotes(symbols);
  const quoteBySymbol = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));

  const allTx = db.select().from(transactions).all();
  const txByAsset = new Map<string, typeof allTx>();
  for (const tx of allTx) {
    const list = txByAsset.get(tx.assetId);
    if (list) list.push(tx);
    else txByAsset.set(tx.assetId, [tx]);
  }

  const drafts: Array<Omit<PositionView, "weight">> = [];
  const portfolioFlows: CashFlow[] = [];

  for (const { asset, account } of rows) {
    const tx = txByAsset.get(asset.id) ?? [];
    const position = computePosition(asset.id, asset.currency, tx);

    // Kapanmış pozisyonları listeleme (miktar sıfır ve gerçekleşmiş K/Z yok)
    if (position.quantity.lessThanOrEqualTo(0) && position.realizedPnl.isZero()) {
      continue;
    }

    const q = asset.symbol ? quoteBySymbol.get(asset.symbol.toUpperCase()) : undefined;
    const priceCurrency = q?.currency ?? asset.currency;
    const livePrice = q ? Money.of(q.price, priceCurrency) : null;

    // Maliyet, fiyatın para biriminde.
    //
    // Varlığın kayıtlı para birimi ile fiyatın geldiği para birimi
    // farklı olabilir — örneğin USD olarak kaydedilmiş bir BIST hissesinin
    // kotasyonu TRY gelir. Eskiden burada `withCurrency` çağrılıyordu ama
    // o yalnızca etiketi değiştirir, tutarı çevirmez: USD maliyet TRY
    // sanılıp piyasa değerinden çıkarılıyor, gerçekleşmemiş K/Z anlamsız
    // bir sayı oluyordu. Artık gerçek çevrim yapılır.
    const costInPriceCcy =
      position.totalCost.currency === priceCurrency
        ? position.totalCost
        : fx.converter.has(position.totalCost.currency) && fx.converter.has(priceCurrency)
          ? fx.converter.convert(position.totalCost, priceCurrency)
          : null;

    // Kur bilinmiyorsa maliyet karşılaştırılamaz; piyasa değeri yine de
    // gösterilir, yalnızca K/Z boş kalır.
    const valued =
      livePrice && costInPriceCcy
        ? valuePosition(
            { ...position, currency: priceCurrency, totalCost: costInPriceCcy },
            livePrice,
          )
        : null;

    const valueLocal =
      (livePrice ? livePrice.times(position.quantity) : null) ??
      costInPriceCcy ??
      position.totalCost;
    const costLocal = costInPriceCcy ?? position.totalCost;
    const valueUsd = fx.converter.has(valueLocal.currency)
      ? fx.converter.toBase(valueLocal)
      : Money.zero("USD");
    const costUsd = fx.converter.has(position.totalCost.currency)
      ? fx.converter.toBase(position.totalCost)
      : Money.zero("USD");

    // Kur etkisi: varlık yabancı paraysa fiyat kârı ile kur kârını ayır.
    //
    // Maliyetin kayıtlı para birimi fiyatınkinden farklıysa ayrıştırma
    // yapılmaz. attributeReturn maliyeti varlığın *alış anındaki* yerel
    // değeriyle ister; bugünkü kurla çevrilmiş bir maliyet fiyat getirisini
    // bozar — ki ayrıştırmanın tüm amacı o iki etkiyi ayırmaktır. Elimizde
    // diller arası tarihsel kur olmadığı için uydurmak yerine atlıyoruz.
    let attribution: PositionView["attribution"] = null;
    if (
      valueLocal.currency !== "USD" &&
      position.totalCost.currency === valueLocal.currency &&
      !position.totalCost.isZero() &&
      fx.converter.has(valueLocal.currency)
    ) {
      // Alış anındaki kur: işlemlerde saklıysa onu kullan, yoksa atla
      const firstBuy = tx.find((t) => t.type === "buy" && t.fxRateToUsd);
      if (firstBuy?.fxRateToUsd) {
        const fxNow = fx.converter.rate(valueLocal.currency, "USD");
        const a = attributeReturn(
          position.totalCost,
          valueLocal,
          firstBuy.fxRateToUsd,
          fxNow,
        );
        attribution = {
          priceReturn: a.priceReturn.toFixed(),
          fxReturn: a.fxReturn.toFixed(),
          crossTerm: a.crossTerm.toFixed(),
          totalReturn: a.totalReturn.toFixed(),
        };
      }
    }

    // XIRR için nakit akışları (USD bazında)
    for (const t of tx) {
      const amt = Money.fromDb(t.amount, t.currency);
      if (!fx.converter.has(t.currency)) continue;
      const usd = fx.converter.toBase(amt).amount;
      if (t.type === "buy") portfolioFlows.push({ date: new Date(t.date), amount: usd.negated() });
      else if (t.type === "sell") portfolioFlows.push({ date: new Date(t.date), amount: usd });
      else if (["dividend", "interest", "staking"].includes(t.type))
        portfolioFlows.push({ date: new Date(t.date), amount: usd });
    }

    const losingLots = livePrice
      ? position.lots.filter((l) => new Decimal(l.price).greaterThan(livePrice.amount)).length
      : 0;

    drafts.push({
      assetId: asset.id,
      name: asset.name,
      symbol: asset.symbol,
      kind: asset.kind,
      country: asset.country,
      institution: account?.institution ?? null,
      currency: valueLocal.currency,
      quantity: position.quantity.toFixed(),
      wacPerUnit: position.wacPerUnit.toDb(),
      livePrice: livePrice?.toDb() ?? null,
      priceBasis: q ? (q.stale ? "stale" : "live") : "none",
      priceAgeMs: q?.ageMs ?? null,
      changePct24h: q?.changePct24h ?? null,
      // costLocal ve valueLocal aynı `currency` etiketiyle gösteriliyor —
      // ikisinin de o para biriminde olması şart
      costLocal: costLocal.toDb(),
      valueLocal: valueLocal.toDb(),
      unrealizedPnl: valued?.unrealizedPnl.toDb() ?? "0",
      returnRatio: valued?.returnRatio?.toFixed() ?? null,
      valueUsd: valueUsd.toDb(),
      costUsd: costUsd.toDb(),
      realizedPnl: position.realizedPnl.toDb(),
      realizedPnlFifo: position.realizedPnlFifo.toDb(),
      incomeReceived: position.incomeReceived.toDb(),
      losingLots,
      attribution,
    });
  }

  const totalValueUsd = drafts.reduce(
    (a, p) => a.plus(Money.of(p.valueUsd, "USD")),
    Money.zero("USD"),
  );
  const totalCostUsd = drafts.reduce(
    (a, p) => a.plus(Money.of(p.costUsd, "USD")),
    Money.zero("USD"),
  );

  const positions: PositionView[] = drafts
    .map((p) => ({
      ...p,
      weight: totalValueUsd.isZero()
        ? "0"
        : new Decimal(p.valueUsd).dividedBy(totalValueUsd.amount).toFixed(),
    }))
    .sort((a, b) => Number(b.valueUsd) - Number(a.valueUsd));

  const weights = positions.map((p) => new Decimal(p.weight));
  const hhi = concentration(weights);
  const top = positions[0];

  // Açık pozisyonların bugünkü değeri son nakit akışı gibi sayılır
  if (totalValueUsd.isPositive()) {
    portfolioFlows.push({ date: new Date(), amount: totalValueUsd.amount });
  }

  const unrealizedUsd = totalValueUsd.minus(totalCostUsd);
  const realizedUsd = drafts.reduce((a, p) => {
    const m = Money.of(p.realizedPnl, p.currency);
    return a.plus(fx.converter.has(p.currency) ? fx.converter.toBase(m) : Money.zero("USD"));
  }, Money.zero("USD"));
  const incomeUsd = drafts.reduce((a, p) => {
    const m = Money.of(p.incomeReceived, p.currency);
    return a.plus(fx.converter.has(p.currency) ? fx.converter.toBase(m) : Money.zero("USD"));
  }, Money.zero("USD"));

  return {
    positions,
    totals: {
      valueUsd: totalValueUsd.toDb(),
      costUsd: totalCostUsd.toDb(),
      unrealizedPnlUsd: unrealizedUsd.toDb(),
      realizedPnlUsd: realizedUsd.toDb(),
      incomeUsd: incomeUsd.toDb(),
      returnRatio: totalCostUsd.isZero()
        ? null
        : unrealizedUsd.ratioTo(totalCostUsd).toFixed(),
    },
    risk: {
      hhi: hhi.toFixed(),
      topWeight: top?.weight ?? "0",
      topName: top?.name ?? null,
      effectiveCount: hhi.isZero() ? "0" : new Decimal(1).dividedBy(hhi).toFixed(2),
      concentrated: positions
        .filter((p) => new Decimal(p.weight).greaterThan(CONCENTRATION_LIMIT))
        .map((p) => ({ name: p.name, weight: p.weight })),
    },
    xirr: xirr(portfolioFlows)?.toFixed() ?? null,
    byKind: groupSum(positions, (p) => p.kind),
    byCurrency: groupSum(positions, (p) => p.currency),
    staleCount: positions.filter((p) => p.priceBasis === "stale").length,
    fxDate: fx.date,
    fxStale: fx.stale,
  };
}

function groupSum(
  items: PositionView[],
  keyFn: (p: PositionView) => string,
): Record<string, string> {
  const out = new Map<string, Decimal>();
  for (const item of items) {
    const key = keyFn(item);
    out.set(key, (out.get(key) ?? new Decimal(0)).plus(item.valueUsd));
  }
  return Object.fromEntries([...out.entries()].map(([k, v]) => [k, v.toFixed()]));
}
