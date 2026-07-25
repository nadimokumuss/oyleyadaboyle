import Decimal from "decimal.js";
import { Money, toDecimal } from "@/lib/money";

/**
 * Araç değerleme.
 *
 * ÖNEMLİ SINIR: araç için de ücretsiz canlı fiyat beslemesi yoktur.
 * Değer üstel amortisman eğrisiyle MODELLENİR:
 *
 *   değer(t) = P × e^(−λ·yaşYıl) × kmDüzeltmesi
 *
 * λ segmente göre değişir (lüks hızlı düşer, ekonomik yavaş, klasik
 * yükselir). Değer `residualFloor` altına inmez — hurda değeri sıfır
 * değildir.
 *
 * Ayrıca aracın asıl maliyeti değer kaybı DEĞİL, değer kaybı + taşıma
 * giderleridir. Panel "bu araç bana bugüne kadar kaça mal oldu"
 * sorusunu bu yüzden ayrı gösterir.
 */

export interface SegmentCurve {
  label: string;
  lambda: number;
  residualFloor: number;
}

export interface MileageConfig {
  referencePerYear: number;
  penaltyPer10k: number;
  maxPenalty: number;
}

export interface VehicleInput {
  purchasePrice: Money;
  purchaseDate: Date;
  /** Model yılı — amortisman aracın KENDİ yaşına göre işler. */
  modelYear: number;
  odometer: number;
  curve: SegmentCurve;
  mileage: MileageConfig;
  manualValue: Money | null;
  manualValueDate: Date | null;
  /** Yıllık gider kalemleri toplamı. */
  annualCosts: Money;
}

export interface VehicleValuation {
  currentValue: Money;
  basis: "model" | "manual";
  /** Sahip olunduğu süre (yıl). */
  ageYears: Decimal;
  /** Aracın kendi yaşı — model yılından bugüne (yıl). */
  vehicleAgeYears: Decimal;
  /** Toplam değer kaybı (pozitif sayı = kaybedilen tutar). */
  depreciation: Money;
  depreciationRatio: Decimal | null;
  /** Bugüne kadar ödenen taşıma giderleri. */
  carryingCostToDate: Money;
  /** Değer kaybı + taşıma gideri = aracın gerçek maliyeti. */
  totalCostOfOwnership: Money;
  /** Aylık ortalama gerçek maliyet. */
  monthlyCostOfOwnership: Money | null;
  /** Km fazlalığından gelen ceza oranı. */
  mileagePenalty: Decimal;
}

const MS_PER_YEAR = 365.2425 * 86_400_000;

export function valueVehicle(
  input: VehicleInput,
  now: Date = new Date(),
): VehicleValuation {
  const ageYears = Decimal.max(
    0,
    new Decimal(now.getTime() - input.purchaseDate.getTime()).dividedBy(MS_PER_YEAR),
  );

  // Aracın KENDİ yaşı: model yılı başından bugüne. Amortisman ve km
  // beklentisi buna göre ölçülür — sahip olma süresine göre değil.
  // Aksi halde ikinci el alınan bir araç, alındığı gün "0 yaşında ama
  // 80.000 km'de" sayılıp haksız yere cezalandırılırdı.
  const modelYearStart = Date.UTC(input.modelYear, 0, 1);
  const vehicleAgeYears = Decimal.max(
    0,
    new Decimal(now.getTime() - modelYearStart).dividedBy(MS_PER_YEAR),
  );
  const vehicleAgeAtPurchase = Decimal.max(
    0,
    new Decimal(input.purchaseDate.getTime() - modelYearStart).dividedBy(MS_PER_YEAR),
  );

  // --- Km düzeltmesi ---
  // Beklenen km aracın yaşına göre; en az 1 yıllık tolerans tanınır ki
  // sıfır kilometreye yakın yeni araçlar cezalandırılmasın.
  const expectedKm = new Decimal(input.mileage.referencePerYear).times(
    Decimal.max(1, vehicleAgeYears),
  );
  const excessKm = Decimal.max(0, new Decimal(input.odometer).minus(expectedKm));
  const mileagePenalty = Decimal.min(
    input.mileage.maxPenalty,
    excessKm.dividedBy(10_000).times(input.mileage.penaltyPer10k),
  );

  // --- Değer ---
  let currentValue: Money;
  let basis: VehicleValuation["basis"];

  if (input.manualValue) {
    currentValue = input.manualValue;
    basis = "manual";
  } else {
    const lambda = new Decimal(input.curve.lambda);
    // Alış fiyatı, aracın alış anındaki yaşındaki değerini temsil eder.
    // Bugünkü değer o noktadan eğri boyunca ilerletilerek bulunur:
    //   değer = P × e^(−λ·(yaşBugün − yaşAlışta))
    // Böylece alış anında değer tam olarak alış fiyatına eşit çıkar.
    const elapsedOnCurve = vehicleAgeYears.minus(vehicleAgeAtPurchase);
    const decayFactor = lambda.negated().times(elapsedOnCurve).exp();
    const afterMileage = decayFactor.times(new Decimal(1).minus(mileagePenalty));
    // Taban: alış fiyatının değil, aracın orijinal değerinin oranı olarak
    // uygulanır; burada alış fiyatına göre sadeleştirilmiş hali kullanılır.
    const floor = new Decimal(input.curve.residualFloor);
    const factor = Decimal.max(floor, afterMileage);
    currentValue = input.purchasePrice.times(factor);
    basis = "model";
  }

  const depreciation = input.purchasePrice.minus(currentValue);
  const depreciationRatio = input.purchasePrice.isZero()
    ? null
    : depreciation.ratioTo(input.purchasePrice);

  const carryingCostToDate = input.annualCosts.times(ageYears);
  const totalCostOfOwnership = depreciation.plus(carryingCostToDate);

  const months = ageYears.times(12);
  const monthlyCostOfOwnership = months.greaterThan("0.1")
    ? totalCostOfOwnership.dividedBy(months)
    : null;

  return {
    currentValue,
    basis,
    ageYears,
    vehicleAgeYears,
    depreciation,
    depreciationRatio,
    carryingCostToDate,
    totalCostOfOwnership,
    monthlyCostOfOwnership,
    mileagePenalty,
  };
}

/** Gelecek yıllar için amortisman eğrisi noktaları (grafik için). */
export function depreciationCurve(
  input: VehicleInput,
  years = 10,
): Array<{ year: number; value: string }> {
  const out: Array<{ year: number; value: string }> = [];
  const lambda = new Decimal(input.curve.lambda);
  const floor = new Decimal(input.curve.residualFloor);

  for (let y = 0; y <= years; y++) {
    const factor = Decimal.max(floor, lambda.negated().times(y).exp());
    out.push({ year: y, value: input.purchasePrice.times(factor).toDb() });
  }
  return out;
}

/** Yıllık gider kalemlerini tek tutara indirger. */
export function sumAnnualCosts(
  costs: Record<string, string | undefined> | null | undefined,
  currency: string,
): Money {
  if (!costs) return Money.zero(currency);
  return Object.values(costs)
    .filter((v): v is string => Boolean(v))
    .reduce((acc, v) => acc.plus(Money.of(v, currency)), Money.zero(currency));
}

export const DEFAULT_MILEAGE: MileageConfig = {
  referencePerYear: 15_000,
  penaltyPer10k: 0.035,
  maxPenalty: 0.35,
};

export function resolveCurve(
  segments: Record<string, SegmentCurve>,
  key: string | null | undefined,
): SegmentCurve {
  return segments[key ?? "mid"] ?? segments.mid ?? { label: "Orta segment", lambda: 0.15, residualFloor: 0.12 };
}

/** Kullanılmayan aracın aylık taşıma maliyeti — "uyuyan varlık" kuralı için. */
export function idleVehicleCost(input: VehicleInput, now = new Date()): Money {
  const v = valueVehicle(input, now);
  // Bir sonraki yılın tahmini değer kaybı + yıllık giderler
  const lambda = new Decimal(input.curve.lambda);
  const nextYearValue = v.currentValue.times(lambda.negated().exp());
  const annualDepreciation = v.currentValue.minus(nextYearValue);
  return annualDepreciation.plus(input.annualCosts).dividedBy(12);
}
