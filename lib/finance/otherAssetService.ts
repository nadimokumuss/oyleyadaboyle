import Decimal from "decimal.js";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { assets, bonds, pensions, collectibles } from "@/db/schema";
import { Money, type CurrencyCode } from "@/lib/money";
import { valueBond, toBondTerms, approximateYtm, currentYield, couponDates } from "./bond";
import { valuePension, DEFAULT_VESTING_TIERS } from "./pension";
import { valueCollectible, STALE_APPRAISAL_DAYS } from "./collectible";

/**
 * Tahvil, emeklilik ve kıymetli eşya için okuma katmanı.
 *
 * Üçü tek dosyada çünkü hiçbiri tek başına `assetService.ts` kadar
 * büyümüyor ve aynı deseni paylaşıyorlar: varlık satırı + uzantı satırı
 * → saf matematik modülü → arayüzün ihtiyaç duyduğu düz nesne.
 */

/* ------------------------------------------------------------------ */
/* Tahvil                                                              */
/* ------------------------------------------------------------------ */

export interface BondView {
  assetId: string;
  name: string;
  issuer: string;
  currency: string;
  faceValue: string;
  couponRate: string;
  couponsPerYear: number;
  purchasePrice: string;
  purchaseDate: string;
  maturityDate: string;
  cleanValue: string;
  accruedInterest: string;
  dirtyValue: string;
  basis: "market" | "amortized";
  matured: boolean;
  daysToMaturity: number | null;
  nextCoupon: { date: string; amount: string } | null;
  unrealizedPnl: string;
  /** Yaklaşık vadeye kadar getiri. */
  ytm: string | null;
  currentYield: string | null;
  withholdingRate: string;
  /** Kalan kupon ödemeleri — gelir takvimi için. */
  remainingCoupons: Array<{ date: string; gross: string; net: string }>;
}

export function loadBonds(now = new Date()): BondView[] {
  const rows = db
    .select({ bond: bonds, asset: assets })
    .from(bonds)
    .innerJoin(assets, eq(bonds.assetId, assets.id))
    .all()
    .filter((r) => r.asset.status === "active");

  return rows.map(({ bond, asset }) => {
    const currency = asset.currency as CurrencyCode;
    const terms = toBondTerms(bond, currency);
    const val = valueBond(terms, now, bond.marketPricePct);
    const wh = new Decimal(bond.withholdingRate);

    const remainingCoupons = couponDates(terms)
      .filter((d) => d > now)
      .map((d) => {
        const gross = terms.faceValue
          .times(terms.couponRate)
          .dividedBy(terms.couponsPerYear || 1);
        return {
          date: d.toISOString().slice(0, 10),
          gross: gross.toDb(),
          net: gross.times(new Decimal(1).minus(wh)).toDb(),
        };
      });

    return {
      assetId: asset.id,
      name: asset.name,
      issuer: bond.issuer,
      currency,
      faceValue: bond.faceValue,
      couponRate: bond.couponRate,
      couponsPerYear: bond.couponsPerYear,
      purchasePrice: bond.purchasePrice,
      purchaseDate: bond.purchaseDate,
      maturityDate: bond.maturityDate,
      cleanValue: val.cleanValue.toDb(),
      accruedInterest: val.accruedInterest.toDb(),
      dirtyValue: val.dirtyValue.toDb(),
      basis: val.basis,
      matured: val.matured,
      daysToMaturity: val.daysToMaturity,
      nextCoupon: val.nextCoupon,
      unrealizedPnl: val.unrealizedPnl.toDb(),
      ytm: approximateYtm(terms, now, val.cleanValue)?.toFixed() ?? null,
      currentYield: currentYield(terms, val.cleanValue)?.toFixed() ?? null,
      withholdingRate: bond.withholdingRate,
      remainingCoupons,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Emeklilik                                                           */
/* ------------------------------------------------------------------ */

export interface PensionView {
  assetId: string;
  name: string;
  provider: string;
  currency: string;
  startDate: string;
  participantBalance: string;
  stateContribution: string;
  monthlyContribution: string;
  vestedValue: string;
  vestedState: string;
  unvestedState: string;
  vestedRatio: string;
  yearsInSystem: string;
  nextTier: { years: number; pct: string; yearsRemaining: string } | null;
  retired: boolean;
  retirementDate: string | null;
}

export function loadPensions(now = new Date()): PensionView[] {
  const rows = db
    .select({ pension: pensions, asset: assets })
    .from(pensions)
    .innerJoin(assets, eq(pensions.assetId, assets.id))
    .all()
    .filter((r) => r.asset.status === "active");

  return rows.map(({ pension, asset }) => {
    const currency = asset.currency as CurrencyCode;
    const tiers =
      pension.vestingTiers && pension.vestingTiers.length > 0
        ? pension.vestingTiers
        : DEFAULT_VESTING_TIERS;

    const val = valuePension(
      {
        participantBalance: Money.of(pension.participantBalance, currency),
        stateContribution: Money.of(pension.stateContribution, currency),
        startDate: new Date(pension.startDate),
        retirementDate: pension.retirementDate ? new Date(pension.retirementDate) : null,
        tiers,
        monthlyContribution: Money.of(pension.monthlyContribution ?? "0", currency),
      },
      now,
    );

    return {
      assetId: asset.id,
      name: asset.name,
      provider: pension.provider,
      currency,
      startDate: pension.startDate,
      participantBalance: pension.participantBalance,
      stateContribution: pension.stateContribution,
      monthlyContribution: pension.monthlyContribution ?? "0",
      vestedValue: val.vestedValue.toDb(),
      vestedState: val.vestedState.toDb(),
      unvestedState: val.unvestedState.toDb(),
      vestedRatio: val.vestedRatio.toFixed(),
      yearsInSystem: val.yearsInSystem.toFixed(1),
      nextTier: val.nextTier
        ? {
            years: val.nextTier.years,
            pct: val.nextTier.pct,
            yearsRemaining: val.nextTier.yearsRemaining.toFixed(1),
          }
        : null,
      retired: val.retired,
      retirementDate: pension.retirementDate,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Kıymetli eşya                                                       */
/* ------------------------------------------------------------------ */

export interface CollectibleView {
  assetId: string;
  name: string;
  category: string;
  maker: string | null;
  year: number | null;
  currency: string;
  purchasePrice: string;
  purchaseDate: string;
  currentValue: string;
  basis: "appraisal" | "book";
  unrealizedPnl: string;
  holdingYears: string;
  annualCosts: string;
  cumulativeCosts: string;
  netResult: string;
  annualizedReturn: string | null;
  appraisalAgeDays: number | null;
  /** Ekspertiz eskiyse arayüz tazelenmesini önerir. */
  appraisalStale: boolean;
}

export function loadCollectibles(now = new Date()): CollectibleView[] {
  const rows = db
    .select({ item: collectibles, asset: assets })
    .from(collectibles)
    .innerJoin(assets, eq(collectibles.assetId, assets.id))
    .all()
    .filter((r) => r.asset.status === "active");

  return rows.map(({ item, asset }) => {
    const currency = asset.currency as CurrencyCode;
    const val = valueCollectible(
      {
        purchasePrice: Money.of(item.purchasePrice, currency),
        purchaseDate: new Date(item.purchaseDate),
        appraisalValue: item.appraisalValue
          ? Money.of(item.appraisalValue, currency)
          : null,
        appraisalDate: item.appraisalDate ? new Date(item.appraisalDate) : null,
        annualCosts: Money.of(item.annualCosts ?? "0", currency),
      },
      now,
    );

    return {
      assetId: asset.id,
      name: asset.name,
      category: item.category,
      maker: item.maker,
      year: item.year,
      currency,
      purchasePrice: item.purchasePrice,
      purchaseDate: item.purchaseDate,
      currentValue: val.currentValue.toDb(),
      basis: val.basis,
      unrealizedPnl: val.unrealizedPnl.toDb(),
      holdingYears: val.holdingYears.toFixed(1),
      annualCosts: item.annualCosts ?? "0",
      cumulativeCosts: val.cumulativeCosts.toDb(),
      netResult: val.netResult.toDb(),
      annualizedReturn: val.annualizedReturn?.toFixed() ?? null,
      appraisalAgeDays: val.appraisalAgeDays,
      appraisalStale:
        val.appraisalAgeDays !== null && val.appraisalAgeDays > STALE_APPRAISAL_DAYS,
    };
  });
}
