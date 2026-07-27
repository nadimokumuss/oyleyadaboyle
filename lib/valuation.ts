import Decimal from "decimal.js";
import { db } from "@/db/client";
import {
  assets, transactions, deposits, properties, vehicles, ventures,
  bonds, pensions, collectibles,
} from "@/db/schema";
import { Money, type CurrencyCode } from "@/lib/money";
import { getFx } from "@/lib/market/fxStore";
import { getQuotes } from "@/lib/market/registry";
import { computePosition, valuePosition } from "@/lib/finance/costbasis";
import { depositBalance, loadWithholdingRules } from "@/lib/finance/depositService";
import { totalOutstandingUsd } from "@/lib/services/liabilities";
import { valueProperty, sumMonthlyCosts } from "@/lib/finance/realestate";
import { valueVehicle, sumAnnualCosts, resolveCurve, DEFAULT_MILEAGE } from "@/lib/finance/vehicle";
import { valueBond, toBondTerms } from "@/lib/finance/bond";
import { valuePension, DEFAULT_VESTING_TIERS } from "@/lib/finance/pension";
import { valueCollectible, CATEGORY_LABEL } from "@/lib/finance/collectible";
import indicesJson from "@/db/seeds/indices.json";
import depreciationJson from "@/db/seeds/depreciation.json";
import type { Asset } from "@/db/schema";

/**
 * Net servet hesabının TEK kaynağı. Panelin her yeri buradan okur;
 * hiçbir sayfa kendi başına toplam hesaplamaz.
 *
 * Her varlık şu üç bilgiyle döner:
 *  - yerel para birimindeki değeri
 *  - USD karşılığı
 *  - değerin nereden geldiği (canlı fiyat / model / defter değeri)
 *
 * `basis` alanı arayüzde görsel olarak ayrıştırılır: canlı fiyattan gelen
 * değerle modellenmiş değer aynı güvenilirlikte değildir ve kullanıcı
 * bunu görmeden karar vermemeli.
 */

const HPI_SERIES = indicesJson.hpi as unknown as Record<
  string,
  { label: string; series: Record<string, number | string> }
>;
const SEGMENT_CURVES = depreciationJson.segments as unknown as Record<
  string,
  { label: string; lambda: number; residualFloor: number }
>;

export type ValuationBasis =
  | "live" // canlı piyasa fiyatı
  | "accrual" // faiz tahakkuku (formül)
  | "model" // endeks/amortisman modeli
  | "book" // defter değeri (elle girilen / maliyet)
  | "stale"; // son bilinen canlı fiyat, bayat

export interface AssetValuation {
  assetId: string;
  name: string;
  kind: Asset["kind"];
  symbol: string | null;
  country: string | null;
  liquidity: Asset["liquidity"];
  currency: CurrencyCode;
  /** Yerel para birimindeki güncel değer. */
  valueLocal: Money;
  /** USD karşılığı. */
  valueUsd: Money;
  /** Yerel para biriminde maliyet (varsa). */
  costLocal: Money | null;
  /** Gerçekleşmemiş K/Z, yerel. */
  unrealizedPnl: Money | null;
  basis: ValuationBasis;
  /** Canlı fiyatın yaşı (ms) — sadece live/stale için. */
  priceAgeMs: number | null;
  /** 24 saatlik değişim oranı. */
  changePct24h: Decimal | null;
  quantity: Decimal | null;
  note?: string;
}

export interface NetWorth {
  /** Varlıklar − borçlar. Panelin her yerinde gösterilen sayı. */
  totalUsd: Money;
  /** Borçlar düşülmeden önceki varlık toplamı. */
  grossAssetsUsd: Money;
  /** Toplam kalan borç. */
  liabilitiesUsd: Money;
  assets: AssetValuation[];
  byKind: Record<string, string>;
  byCountry: Record<string, string>;
  byCurrency: Record<string, string>;
  byLiquidity: Record<string, string>;
  /** Kur tablosu bayatsa true — tüm USD dönüşümleri şüpheli demektir. */
  fxStale: boolean;
  fxDate: string;
  /** Fiyatı bayat olan varlık sayısı. */
  staleCount: number;
  computedAt: Date;
}

export async function computeNetWorth(): Promise<NetWorth> {
  const fx = await getFx();
  const allAssets = db.select().from(assets).all().filter((a) => a.status === "active");

  // Canlı fiyat gereken sembolleri tek seferde topla — sembol başına
  // ayrı çağrı rate limit'i anında doldururdu.
  const symbols = allAssets
    .filter((a) => a.symbol && ["equity", "crypto", "commodity"].includes(a.kind))
    .map((a) => a.symbol!);
  const quotes = await getQuotes(symbols);
  const quoteBySymbol = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));

  const allTx = db.select().from(transactions).all();
  const txByAsset = new Map<string, typeof allTx>();
  for (const tx of allTx) {
    const list = txByAsset.get(tx.assetId);
    if (list) list.push(tx);
    else txByAsset.set(tx.assetId, [tx]);
  }

  const depositRows = new Map(
    db.select().from(deposits).all().map((d) => [d.assetId, d]),
  );
  const propertyRows = new Map(
    db.select().from(properties).all().map((p) => [p.assetId, p]),
  );
  const vehicleRows = new Map(
    db.select().from(vehicles).all().map((v) => [v.assetId, v]),
  );
  const ventureRows = new Map(
    db.select().from(ventures).all().map((v) => [v.assetId, v]),
  );
  const bondRows = new Map(
    db.select().from(bonds).all().map((b) => [b.assetId, b]),
  );
  const pensionRows = new Map(
    db.select().from(pensions).all().map((p) => [p.assetId, p]),
  );
  const collectibleRows = new Map(
    db.select().from(collectibles).all().map((c) => [c.assetId, c]),
  );
  const whRules = loadWithholdingRules();

  const valuations: AssetValuation[] = [];

  for (const asset of allAssets) {
    const tx = txByAsset.get(asset.id) ?? [];
    const v = valueAsset(asset, tx, {
      quote: asset.symbol ? quoteBySymbol.get(asset.symbol.toUpperCase()) : undefined,
      deposit: depositRows.get(asset.id),
      property: propertyRows.get(asset.id),
      vehicle: vehicleRows.get(asset.id),
      venture: ventureRows.get(asset.id),
      bond: bondRows.get(asset.id),
      pension: pensionRows.get(asset.id),
      collectible: collectibleRows.get(asset.id),
      whRules,
    });
    if (!v) continue;

    const valueUsd = fx.converter.has(v.valueLocal.currency)
      ? fx.converter.toBase(v.valueLocal)
      : Money.zero("USD");

    valuations.push({ ...v, valueUsd });
  }

  const grossAssetsUsd = valuations.reduce(
    (acc, v) => acc.plus(v.valueUsd),
    Money.zero("USD"),
  );

  // Net servet = varlıklar − borçlar. Borcu göz ardı etmek, 3M'lik evi
  // 1M peşinatla alan birini 3M zengin sanmak demektir.
  const liabilitiesUsd = await totalOutstandingUsd();
  const totalUsd = grossAssetsUsd.minus(liabilitiesUsd);

  return {
    totalUsd,
    grossAssetsUsd,
    liabilitiesUsd,
    assets: valuations,
    byKind: groupSum(valuations, (v) => v.kind),
    byCountry: groupSum(valuations, (v) => v.country ?? "bilinmiyor"),
    byCurrency: groupSum(valuations, (v) => v.currency),
    byLiquidity: groupSum(valuations, (v) => v.liquidity),
    fxStale: fx.stale,
    fxDate: fx.date,
    staleCount: valuations.filter((v) => v.basis === "stale").length,
    computedAt: new Date(),
  };
}

type Extras = {
  quote?: { price: string; currency: string; changePct24h: string | null; ageMs: number; stale: boolean };
  deposit?: typeof deposits.$inferSelect;
  property?: typeof properties.$inferSelect;
  vehicle?: typeof vehicles.$inferSelect;
  venture?: typeof ventures.$inferSelect;
  bond?: typeof bonds.$inferSelect;
  pension?: typeof pensions.$inferSelect;
  collectible?: typeof collectibles.$inferSelect;
  whRules?: ReturnType<typeof loadWithholdingRules>;
};

function valueAsset(
  asset: Asset,
  tx: (typeof transactions.$inferSelect)[],
  extras: Extras,
): Omit<AssetValuation, "valueUsd"> | null {
  const base = {
    assetId: asset.id,
    name: asset.name,
    kind: asset.kind,
    symbol: asset.symbol,
    country: asset.country,
    liquidity: asset.liquidity,
    currency: asset.currency,
  };

  switch (asset.kind) {
    case "equity":
    case "crypto":
    case "commodity": {
      const position = computePosition(asset.id, asset.currency, tx);
      const q = extras.quote;
      if (!q) {
        // Fiyat hiç yok — maliyeti göster, ama defter değeri olduğunu belirt
        return {
          ...base,
          valueLocal: position.totalCost,
          costLocal: position.totalCost,
          unrealizedPnl: null,
          basis: "book",
          priceAgeMs: null,
          changePct24h: null,
          quantity: position.quantity,
          note: "Fiyat alınamadı — maliyet gösteriliyor",
        };
      }
      const price = Money.of(q.price, q.currency);
      const valued = valuePosition(position, price);
      return {
        ...base,
        currency: q.currency,
        valueLocal: valued.marketValue,
        costLocal: position.totalCost,
        unrealizedPnl: valued.unrealizedPnl,
        basis: q.stale ? "stale" : "live",
        priceAgeMs: q.ageMs,
        changePct24h: q.changePct24h ? new Decimal(q.changePct24h) : null,
        quantity: position.quantity,
      };
    }

    case "cash": {
      const position = computePosition(asset.id, asset.currency, tx);
      // Nakit için "miktar" yok, net akış var
      const net = position.totalCost
        .plus(position.incomeReceived)
        .minus(position.costsPaid);
      return {
        ...base,
        valueLocal: net,
        costLocal: null,
        unrealizedPnl: null,
        basis: "book",
        priceAgeMs: null,
        changePct24h: null,
        quantity: null,
      };
    }

    case "deposit": {
      const d = extras.deposit;
      if (!d) return null;
      const principal = Money.fromDb(d.principal, asset.currency);
      // Net bakiye kullanılır: stopaj kesildikten sonra cebe girecek tutar.
      // Brüt göstermek serveti olduğundan büyük gösterirdi.
      const { netBalance } = depositBalance(
        d,
        asset.currency,
        extras.whRules ?? [],
      );
      return {
        ...base,
        valueLocal: netBalance,
        costLocal: principal,
        unrealizedPnl: netBalance.minus(principal),
        basis: "accrual",
        priceAgeMs: null,
        changePct24h: null,
        quantity: null,
        note: "Stopaj sonrası net tahakkuk",
      };
    }

    case "realestate": {
      const p = extras.property;
      if (!p) return null;
      const hpi = p.indexKey ? HPI_SERIES[p.indexKey] : undefined;
      const v = valueProperty({
        purchasePrice: Money.of(p.purchasePrice, asset.currency),
        purchaseDate: new Date(p.purchaseDate),
        closingCosts: Money.fromDb(p.closingCosts, asset.currency),
        renovationCost: Money.fromDb(p.renovationCost, asset.currency),
        manualValue: p.manualValue ? Money.of(p.manualValue, asset.currency) : null,
        manualValueDate: p.manualValueDate ? new Date(p.manualValueDate) : null,
        monthlyRent: Money.fromDb(p.monthlyRent, asset.currency),
        occupancyRate: new Decimal(p.occupancyRate ?? "1"),
        monthlyCosts: sumMonthlyCosts(p.monthlyCosts, asset.currency),
        indexSeries: hpi?.series ?? null,
      });
      return {
        ...base,
        valueLocal: v.currentValue,
        costLocal: v.totalCost,
        unrealizedPnl: v.capitalGain,
        basis: v.basis === "manual" ? "book" : "model",
        priceAgeMs: null,
        changePct24h: null,
        quantity: null,
        note:
          v.basis === "manual"
            ? "Elle girilen ekspertizden endekslendi"
            : v.basis === "model"
              ? `${hpi?.label ?? "Konut endeksi"} ile modellendi`
              : "Endeks yok — maliyet gösteriliyor",
      };
    }

    case "vehicle": {
      const v = extras.vehicle;
      if (!v) return null;
      const cost = Money.of(v.purchasePrice, asset.currency);
      const val = valueVehicle({
        purchasePrice: cost,
        purchaseDate: new Date(v.purchaseDate),
        modelYear: v.year,
        odometer: v.odometer ?? 0,
        curve: resolveCurve(SEGMENT_CURVES, v.segment),
        mileage: DEFAULT_MILEAGE,
        manualValue: v.manualValue ? Money.of(v.manualValue, asset.currency) : null,
        manualValueDate: v.manualValueDate ? new Date(v.manualValueDate) : null,
        annualCosts: sumAnnualCosts(v.annualCosts, asset.currency),
      });
      return {
        ...base,
        valueLocal: val.currentValue,
        costLocal: cost,
        unrealizedPnl: val.depreciation.negated(),
        basis: val.basis === "manual" ? "book" : "model",
        priceAgeMs: null,
        changePct24h: null,
        quantity: null,
        note:
          val.basis === "manual"
            ? "Elle girilen değer"
            : `${resolveCurve(SEGMENT_CURVES, v.segment).label} amortisman eğrisi`,
      };
    }

    case "venture": {
      const v = extras.venture;
      if (!v) return null;
      const called = Money.fromDb(v.calledCapital, asset.currency);
      // Değerleme varsa sahiplik payı kadarı bizim
      const value = v.valuation
        ? Money.fromDb(v.valuation, asset.currency).times(v.ownershipPct)
        : called;
      return {
        ...base,
        valueLocal: value,
        costLocal: called,
        unrealizedPnl: value.minus(called),
        basis: "book",
        priceAgeMs: null,
        changePct24h: null,
        quantity: null,
        note: v.valuation ? "Son tur değerlemesi" : "Ödenen sermaye",
      };
    }

    case "bond": {
      const b = extras.bond;
      if (!b) return null;

      const terms = toBondTerms(b, asset.currency);
      const val = valueBond(terms, new Date(), b.marketPricePct);

      return {
        ...base,
        // Kirli değer: temiz fiyat + işlemiş faiz. Elde gerçekte olan budur.
        valueLocal: val.dirtyValue,
        costLocal: terms.purchasePrice,
        unrealizedPnl: val.unrealizedPnl,
        // Piyasa fiyatı elle girilmiş bir kotasyondur, canlı besleme değil —
        // "canlı" demek yanıltıcı olurdu.
        basis: val.basis === "market" ? "book" : "accrual",
        priceAgeMs: null,
        changePct24h: null,
        quantity: null,
        note: val.matured
          ? "Vade doldu — nominal"
          : val.basis === "market"
            ? `Piyasa fiyatı + işlemiş faiz${
                val.nextCoupon ? ` · sıradaki kupon ${val.nextCoupon.date}` : ""
              }`
            : `İtfa maliyeti + işlemiş faiz${
                val.daysToMaturity !== null ? ` · vadeye ${val.daysToMaturity} gün` : ""
              }`,
      };
    }

    case "pension": {
      const p = extras.pension;
      if (!p) return null;

      const tiers =
        p.vestingTiers && p.vestingTiers.length > 0 ? p.vestingTiers : DEFAULT_VESTING_TIERS;

      const val = valuePension(
        {
          participantBalance: Money.of(p.participantBalance, asset.currency),
          stateContribution: Money.of(p.stateContribution, asset.currency),
          startDate: new Date(p.startDate),
          retirementDate: p.retirementDate ? new Date(p.retirementDate) : null,
          tiers,
          monthlyContribution: Money.of(p.monthlyContribution ?? "0", asset.currency),
        },
        new Date(),
      );

      // Servete yalnızca HAK EDİLMİŞ tutar yazılır. Hak edilmemiş devlet
      // katkısı henüz sizin değil; onu saymak "planlanan varlık servete
      // sayılmaz" kuralının aynısını çiğnemek olurdu.
      return {
        ...base,
        valueLocal: val.vestedValue,
        costLocal: Money.of(p.participantBalance, asset.currency),
        unrealizedPnl: val.vestedState,
        basis: "book",
        priceAgeMs: null,
        changePct24h: null,
        quantity: null,
        note: val.retired
          ? "Emeklilik hakkı kazanıldı — katkının tamamı hak edildi"
          : val.unvestedState.isZero()
            ? "Devlet katkısı tamamen hak edildi"
            : `Devlet katkısının %${val.vestedRatio.times(100).toDecimalPlaces(0)} hak edildi` +
              (val.nextTier
                ? ` · ${val.nextTier.yearsRemaining.toDecimalPlaces(1)} yıl sonra %${new Decimal(
                    val.nextTier.pct,
                  ).times(100).toDecimalPlaces(0)}`
                : ""),
      };
    }

    case "collectible": {
      const c = extras.collectible;
      if (!c) return null;

      const cost = Money.of(c.purchasePrice, asset.currency);
      const val = valueCollectible(
        {
          purchasePrice: cost,
          purchaseDate: new Date(c.purchaseDate),
          appraisalValue: c.appraisalValue
            ? Money.of(c.appraisalValue, asset.currency)
            : null,
          appraisalDate: c.appraisalDate ? new Date(c.appraisalDate) : null,
          annualCosts: Money.of(c.annualCosts ?? "0", asset.currency),
        },
        new Date(),
      );

      // Burada "model" rozeti hiç kullanılmaz: bir tablonun değeri
      // endeksten türetilemez. Ya ekspertiz ya defter değeri.
      return {
        ...base,
        valueLocal: val.currentValue,
        costLocal: cost,
        unrealizedPnl: val.unrealizedPnl,
        basis: "book",
        priceAgeMs: null,
        changePct24h: null,
        quantity: null,
        note:
          val.basis === "appraisal"
            ? `Ekspertiz${
                val.appraisalAgeDays !== null ? ` · ${val.appraisalAgeDays} gün önce` : ""
              }`
            : `${CATEGORY_LABEL[c.category] ?? "Kıymetli eşya"} — alış fiyatı, ekspertiz girilmedi`,
      };
    }

    default:
      return null;
  }
}

function groupSum(
  items: AssetValuation[],
  keyFn: (v: AssetValuation) => string,
): Record<string, string> {
  const out = new Map<string, Money>();
  for (const item of items) {
    const key = keyFn(item);
    out.set(key, (out.get(key) ?? Money.zero("USD")).plus(item.valueUsd));
  }
  return Object.fromEntries([...out.entries()].map(([k, v]) => [k, v.toDb()]));
}
