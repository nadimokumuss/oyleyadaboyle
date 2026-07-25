import Decimal from "decimal.js";
import { db } from "@/db/client";
import { assets, properties, vehicles, fxRates } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { Money } from "@/lib/money";
import { getFx } from "@/lib/market/fxStore";
import { attributeReturn } from "@/lib/fx";
import {
  valueProperty, sumMonthlyCosts, estimateForegoneRent,
  type IndexSeries, type PropertyValuation,
} from "./realestate";
import {
  valueVehicle, depreciationCurve, sumAnnualCosts, resolveCurve,
  DEFAULT_MILEAGE, type VehicleValuation,
} from "./vehicle";
import indices from "@/db/seeds/indices.json";
import depreciation from "@/db/seeds/depreciation.json";

/**
 * Gayrimenkul ve araç görünümleri.
 *
 * Bu iki varlık sınıfının değeri MODELLENİR, canlı fiyattan gelmez.
 * Arayüz bunu kesikli çerçeve ve "model" rozetiyle belirtir.
 */

type HpiEntry = { label: string; source: string; currency: string; series: IndexSeries };
const HPI = indices.hpi as unknown as Record<string, HpiEntry>;
const SEGMENTS = depreciation.segments as unknown as Record<
  string,
  { label: string; lambda: number; residualFloor: number }
>;
const MILEAGE = depreciation.mileage
  ? {
      referencePerYear: depreciation.mileage.referencePerYear,
      penaltyPer10k: depreciation.mileage.penaltyPer10k,
      maxPenalty: depreciation.mileage.maxPenalty,
    }
  : DEFAULT_MILEAGE;

export interface PropertyView {
  assetId: string;
  name: string;
  city: string;
  country: string;
  currency: string;
  lat: number | null;
  lng: number | null;
  status: string;
  indexLabel: string | null;
  indexSource: string | null;

  purchasePrice: string;
  purchaseDate: string;
  totalCost: string;
  currentValue: string;
  capitalGain: string;
  capitalGainRatio: string | null;
  basis: PropertyValuation["basis"];
  indexGrowth: string | null;

  monthlyRent: string;
  occupancyRate: string;
  annualGrossRent: string;
  annualCosts: string;
  annualNetRent: string;
  netYield: string | null;
  grossYield: string | null;
  yieldOnCost: string | null;

  valueUsd: string;
  costUsd: string;
  /** Kur etkisi ayrıştırması: fiyat kârı mı, kur kârı mı? */
  attribution: {
    priceReturn: string;
    fxReturn: string;
    crossTerm: string;
    totalReturn: string;
  } | null;
  /** Kiraya verilmemişse kaçırılan aylık gelir tahmini. */
  foregoneMonthlyRent: string | null;
}

export type StatusFilter = "active" | "planned";

export async function loadProperties(
  now = new Date(),
  status: StatusFilter = "active",
): Promise<PropertyView[]> {
  const fx = await getFx();

  const rows = db
    .select({ p: properties, a: assets })
    .from(properties)
    .innerJoin(assets, eq(properties.assetId, assets.id))
    .all()
    .filter((r) => r.a.status === status);

  return rows.map(({ p, a }) => {
    const hpi = p.indexKey ? HPI[p.indexKey] : undefined;
    const currency = a.currency;

    const v = valueProperty(
      {
        purchasePrice: Money.of(p.purchasePrice, currency),
        purchaseDate: new Date(p.purchaseDate),
        closingCosts: Money.fromDb(p.closingCosts, currency),
        renovationCost: Money.fromDb(p.renovationCost, currency),
        manualValue: p.manualValue ? Money.of(p.manualValue, currency) : null,
        manualValueDate: p.manualValueDate ? new Date(p.manualValueDate) : null,
        monthlyRent: Money.fromDb(p.monthlyRent, currency),
        occupancyRate: new Decimal(p.occupancyRate ?? "1"),
        monthlyCosts: sumMonthlyCosts(p.monthlyCosts, currency),
        indexSeries: hpi?.series ?? null,
      },
      now,
    );

    const valueUsd = fx.converter.has(currency)
      ? fx.converter.toBase(v.currentValue)
      : Money.zero("USD");
    const costUsd = fx.converter.has(currency)
      ? fx.converter.toBase(v.totalCost)
      : Money.zero("USD");

    // Kur etkisi: alış tarihindeki kur bilinmiyorsa hesaplanmaz.
    // Burada bugünkü kur tablosundan tarihsel kur türetilemez, o yüzden
    // sadece TRY gibi kuru bilinen durumlarda anlamlı olur — kur geçmişi
    // biriktikçe (fx_rates tablosu) bu otomatik doğrulaşacak.
    let attribution: PropertyView["attribution"] = null;
    if (currency !== "USD" && fx.converter.has(currency) && !v.totalCost.isZero()) {
      const histRate = historicalRate(currency, new Date(p.purchaseDate));
      if (histRate) {
        const a2 = attributeReturn(
          v.totalCost,
          v.currentValue,
          histRate,
          fx.converter.rate(currency, "USD"),
        );
        attribution = {
          priceReturn: a2.priceReturn.toFixed(),
          fxReturn: a2.fxReturn.toFixed(),
          crossTerm: a2.crossTerm.toFixed(),
          totalReturn: a2.totalReturn.toFixed(),
        };
      }
    }

    const isVacant = Money.fromDb(p.monthlyRent, currency).isZero();

    return {
      assetId: a.id,
      name: a.name,
      city: p.city,
      country: p.country,
      currency,
      lat: p.lat,
      lng: p.lng,
      status: a.status,
      indexLabel: hpi?.label ?? null,
      indexSource: hpi?.source ?? null,
      purchasePrice: p.purchasePrice,
      purchaseDate: p.purchaseDate,
      totalCost: v.totalCost.toDb(),
      currentValue: v.currentValue.toDb(),
      capitalGain: v.capitalGain.toDb(),
      capitalGainRatio: v.capitalGainRatio?.toFixed() ?? null,
      basis: v.basis,
      indexGrowth: v.indexGrowth?.toFixed() ?? null,
      monthlyRent: p.monthlyRent ?? "0",
      occupancyRate: p.occupancyRate ?? "1",
      annualGrossRent: v.annualGrossRent.toDb(),
      annualCosts: v.annualCosts.toDb(),
      annualNetRent: v.annualNetRent.toDb(),
      netYield: v.netYield?.toFixed() ?? null,
      grossYield: v.grossYield?.toFixed() ?? null,
      yieldOnCost: v.yieldOnCost?.toFixed() ?? null,
      valueUsd: valueUsd.toDb(),
      costUsd: costUsd.toDb(),
      attribution,
      foregoneMonthlyRent: isVacant
        ? estimateForegoneRent(v.currentValue).toDb()
        : null,
    };
  });
}

/**
 * Alış tarihine en yakın tarihteki "1 birim yerel para = kaç USD" kurunu
 * fx_rates tablosundan okur.
 *
 * Kayıt yoksa null döner ve kur ayrıştırması hiç gösterilmez — uydurma
 * bir kurla "kur kârı" hesaplamak yanıltıcı olurdu. Panel her gün kur
 * çektikçe bu tablo dolar ve geçmiş alımlar için ayrıştırma kendiliğinden
 * doğrulaşır.
 */
function historicalRate(currency: string, date: Date): string | null {
  const iso = date.toISOString().slice(0, 10);

  const row = db
    .select()
    .from(fxRates)
    .where(and(eq(fxRates.base, "USD"), eq(fxRates.quote, currency.toUpperCase())))
    .all()
    // Hedef tarihe en yakın kaydı seç
    .sort(
      (a, b) =>
        Math.abs(new Date(a.date).getTime() - new Date(iso).getTime()) -
        Math.abs(new Date(b.date).getTime() - new Date(iso).getTime()),
    )[0];

  if (!row) return null;

  // 30 günden uzak bir kur, o tarihi temsil etmez
  const gapDays =
    Math.abs(new Date(row.date).getTime() - new Date(iso).getTime()) / 86_400_000;
  if (gapDays > 30) return null;

  // Tabloda 1 USD = X yerel; bize 1 yerel = kaç USD lazım
  const perUsd = new Decimal(row.rate);
  if (perUsd.lessThanOrEqualTo(0)) return null;
  return new Decimal(1).dividedBy(perUsd).toFixed();
}

/* ------------------------------------------------------------------ */

export interface VehicleView {
  assetId: string;
  name: string;
  make: string;
  model: string;
  year: number;
  country: string;
  currency: string;
  status: string;
  segment: string;
  segmentLabel: string;
  odometer: number;

  purchasePrice: string;
  purchaseDate: string;
  currentValue: string;
  basis: VehicleValuation["basis"];
  depreciation: string;
  depreciationRatio: string | null;
  ageYears: string;
  vehicleAgeYears: string;
  mileagePenalty: string;

  annualCosts: string;
  carryingCostToDate: string;
  totalCostOfOwnership: string;
  monthlyCostOfOwnership: string | null;

  valueUsd: string;
  curve: Array<{ year: number; value: string }>;
}

export async function loadVehicles(
  now = new Date(),
  status: StatusFilter = "active",
): Promise<VehicleView[]> {
  const fx = await getFx();

  const rows = db
    .select({ v: vehicles, a: assets })
    .from(vehicles)
    .innerJoin(assets, eq(vehicles.assetId, assets.id))
    .all()
    .filter((r) => r.a.status === status);

  return rows.map(({ v, a }) => {
    const currency = a.currency;
    const curve = resolveCurve(SEGMENTS, v.segment);
    const annualCosts = sumAnnualCosts(v.annualCosts, currency);

    const input = {
      purchasePrice: Money.of(v.purchasePrice, currency),
      purchaseDate: new Date(v.purchaseDate),
      modelYear: v.year,
      odometer: v.odometer ?? 0,
      curve,
      mileage: MILEAGE,
      manualValue: v.manualValue ? Money.of(v.manualValue, currency) : null,
      manualValueDate: v.manualValueDate ? new Date(v.manualValueDate) : null,
      annualCosts,
    };

    const val = valueVehicle(input, now);
    const valueUsd = fx.converter.has(currency)
      ? fx.converter.toBase(val.currentValue)
      : Money.zero("USD");

    return {
      assetId: a.id,
      name: a.name,
      make: v.make,
      model: v.model,
      year: v.year,
      country: v.country,
      currency,
      status: a.status,
      segment: v.segment,
      segmentLabel: curve.label,
      odometer: v.odometer ?? 0,
      purchasePrice: v.purchasePrice,
      purchaseDate: v.purchaseDate,
      currentValue: val.currentValue.toDb(),
      basis: val.basis,
      depreciation: val.depreciation.toDb(),
      depreciationRatio: val.depreciationRatio?.toFixed() ?? null,
      ageYears: val.ageYears.toFixed(),
      vehicleAgeYears: val.vehicleAgeYears.toFixed(),
      mileagePenalty: val.mileagePenalty.toFixed(),
      annualCosts: annualCosts.toDb(),
      carryingCostToDate: val.carryingCostToDate.toDb(),
      totalCostOfOwnership: val.totalCostOfOwnership.toDb(),
      monthlyCostOfOwnership: val.monthlyCostOfOwnership?.toDb() ?? null,
      valueUsd: valueUsd.toDb(),
      curve: depreciationCurve(input, 10),
    };
  });
}

export { HPI, SEGMENTS };
