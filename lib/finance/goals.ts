import Decimal from "decimal.js";

/**
 * Hedefe ulaşma analizi.
 *
 * Monte Carlo zaten bir olasılık dağılımı üretiyordu; eksik olan onu bir
 * hedefe bağlamaktı. "20 yıl sonra 4–11 milyon arası" bilgi verir,
 * "emeklilik hedefine ulaşma olasılığın %72" karar verdirir.
 *
 * Bu dosya saf: simülasyon yollarını alır, hedefle karşılaştırır.
 * DB'ye dokunmaz, test edilebilir.
 */

export interface GoalInput {
  targetAmount: Decimal;
  /** Hedefe kalan yıl. Geçmişse 0 veya negatif olabilir. */
  yearsRemaining: number;
  currentValue: Decimal;
}

export interface GoalProgress {
  /** Bugünkü değerin hedefe oranı (0–1+). */
  progress: Decimal;
  /** Hedefe kalan tutar. Ulaşıldıysa sıfır. */
  shortfall: Decimal;
  achieved: boolean;
  /** Hedef tarihi geçmiş mi? */
  overdue: boolean;
  /**
   * Hedefe zamanında ulaşmak için gereken yıllık bileşik getiri.
   * Süre kalmadıysa veya hedefe ulaşıldıysa null.
   */
  requiredAnnualReturn: Decimal | null;
  /**
   * Getiri varsaymadan, yalnızca birikimle ulaşmak için gereken aylık
   * tasarruf. Süre kalmadıysa null.
   */
  requiredMonthlySaving: Decimal | null;
}

export function analyzeGoal(input: GoalInput): GoalProgress {
  const { targetAmount, currentValue, yearsRemaining } = input;

  const progress = targetAmount.isZero()
    ? new Decimal(0)
    : currentValue.dividedBy(targetAmount);
  const achieved = currentValue.greaterThanOrEqualTo(targetAmount);
  const shortfall = achieved ? new Decimal(0) : targetAmount.minus(currentValue);
  const overdue = yearsRemaining <= 0;

  let requiredAnnualReturn: Decimal | null = null;
  let requiredMonthlySaving: Decimal | null = null;

  if (!achieved && yearsRemaining > 0) {
    // Bileşik getiri: (hedef/bugün)^(1/yıl) − 1
    // Bugünkü değer sıfırsa hiçbir getiri oranı yetmez — birikim şart.
    if (currentValue.greaterThan(0)) {
      const ratio = targetAmount.dividedBy(currentValue);
      requiredAnnualReturn = new Decimal(
        Math.pow(ratio.toNumber(), 1 / yearsRemaining) - 1,
      );
    }
    requiredMonthlySaving = shortfall.dividedBy(yearsRemaining * 12);
  }

  return {
    progress,
    shortfall,
    achieved,
    overdue,
    requiredAnnualReturn,
    requiredMonthlySaving,
  };
}

/**
 * Simülasyon sonuçlarından hedefe ulaşma olasılığı.
 *
 * `finalValues` Monte Carlo'nun dönem sonu değerleri. Olasılık, hedefi
 * tutturan yol oranıdır — bandın ortasına bakıp "yeter" demekten çok
 * daha dürüst bir cevap.
 */
export function probabilityOfReaching(
  finalValues: number[],
  target: Decimal,
): Decimal {
  if (finalValues.length === 0) return new Decimal(0);
  const t = target.toNumber();
  const hits = finalValues.filter((v) => v >= t).length;
  return new Decimal(hits).dividedBy(finalValues.length);
}

/**
 * Finansal bağımsızlık tarihi.
 *
 * Pasif gelir yaşam giderini karşıladığında ulaşılmış sayılır. Basit bir
 * projeksiyon: mevcut tasarruf oranı ve varsayılan getiri devam ederse
 * portföyün ne zaman gereken büyüklüğe ulaşacağı.
 *
 * `withdrawalRate` güvenli çekim oranı — %4 yaygın bir kabuldür ama
 * tartışmalıdır ve yüksek enflasyonlu ülkelerde geçerliliği şüphelidir.
 */
export interface IndependenceInput {
  currentNetWorth: Decimal;
  monthlyLivingCost: Decimal;
  monthlySaving: Decimal;
  annualReturn: Decimal;
  withdrawalRate: Decimal;
}

export interface IndependenceResult {
  /** Bağımsızlık için gereken portföy büyüklüğü. */
  targetNetWorth: Decimal;
  /** Kaç yıl kaldığı. Ulaşıldıysa 0, ulaşılamıyorsa null. */
  yearsToIndependence: number | null;
  alreadyIndependent: boolean;
  /** Tasarruf oranı: aylık tasarruf / (tasarruf + gider). */
  savingsRate: Decimal | null;
}

const MAX_PROJECTION_YEARS = 100;

export function analyzeIndependence(input: IndependenceInput): IndependenceResult {
  const { currentNetWorth, monthlyLivingCost, monthlySaving, annualReturn, withdrawalRate } =
    input;

  const annualCost = monthlyLivingCost.times(12);
  const targetNetWorth = withdrawalRate.isZero()
    ? new Decimal(0)
    : annualCost.dividedBy(withdrawalRate);

  const alreadyIndependent =
    !targetNetWorth.isZero() && currentNetWorth.greaterThanOrEqualTo(targetNetWorth);

  const totalMonthlyFlow = monthlySaving.plus(monthlyLivingCost);
  const savingsRate = totalMonthlyFlow.isZero()
    ? null
    : monthlySaving.dividedBy(totalMonthlyFlow);

  if (alreadyIndependent) {
    return { targetNetWorth, yearsToIndependence: 0, alreadyIndependent: true, savingsRate };
  }

  // Ne birikim ne getiri varsa hedefe hiç ulaşılmaz.
  if (monthlySaving.lessThanOrEqualTo(0) && annualReturn.lessThanOrEqualTo(0)) {
    return { targetNetWorth, yearsToIndependence: null, alreadyIndependent: false, savingsRate };
  }

  // Yıl yıl ilerlet — kapalı form çözüm yerine döngü, çünkü okunması
  // kolay ve 100 yinelemeden fazlası zaten anlamsız.
  let value = currentNetWorth;
  const annualSaving = monthlySaving.times(12);

  for (let year = 1; year <= MAX_PROJECTION_YEARS; year++) {
    value = value.times(annualReturn.plus(1)).plus(annualSaving);
    if (value.greaterThanOrEqualTo(targetNetWorth)) {
      return {
        targetNetWorth,
        yearsToIndependence: year,
        alreadyIndependent: false,
        savingsRate,
      };
    }
  }

  return { targetNetWorth, yearsToIndependence: null, alreadyIndependent: false, savingsRate };
}
