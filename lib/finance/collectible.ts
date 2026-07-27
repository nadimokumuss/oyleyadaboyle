import Decimal from "decimal.js";
import { Money } from "@/lib/money";

/**
 * Kıymetli eşya — sanat, saat, mücevher, koleksiyon.
 *
 * ## Neden burada model yok
 *
 * Gayrimenkul ve araç için bir endeks veya amortisman eğrisi kullanmak
 * savunulabilir: aynı şehirdeki konutlar benzer hareket eder, aynı segment
 * araçlar benzer değer kaybeder. Bir tablo veya saat için böyle bir şey
 * yoktur — sanatçının bir yapıtı ikiye katlarken diğeri değer kaybedebilir.
 *
 * Bu yüzden burada **model rozeti hiç kullanılmaz**. Değer ya alış
 * fiyatıdır ya da elle girdiğiniz ekspertiz. Uydurma bir endeks üretip
 * ona "model" demek, panelin veri kaynağı konusundaki dürüstlüğünü
 * bozardı.
 *
 * ## Taşıma maliyeti görünür olmalı
 *
 * Sigorta, saklama ve bakım kıymetli eşyada ciddi tutarlara ulaşır ve
 * getiriyi sessizce yer. Panelin bunu göstermesi gerekir.
 */

export interface CollectibleTerms {
  purchasePrice: Money;
  purchaseDate: Date;
  appraisalValue: Money | null;
  appraisalDate: Date | null;
  annualCosts: Money;
}

export interface CollectibleValuation {
  currentValue: Money;
  /** Değer nereden geldi? Model asla kullanılmaz. */
  basis: "appraisal" | "book";
  /** Alış fiyatına göre değer değişimi. */
  unrealizedPnl: Money;
  /** Elde tutma süresi (yıl). */
  holdingYears: Decimal;
  /** Bugüne kadar biriken taşıma maliyeti. */
  cumulativeCosts: Money;
  /**
   * Taşıma maliyeti düşülmüş net sonuç.
   *
   * Bir tablo %20 değerlendiyse ama sigortası her yıl %3 yediyse gerçek
   * kazanç sandığınızdan azdır.
   */
  netResult: Money;
  /** Yıllık bileşik getiri; süre veya maliyet sıfırsa null. */
  annualizedReturn: Decimal | null;
  /** Ekspertizin üzerinden geçen gün — eskiyse arayüz uyarır. */
  appraisalAgeDays: number | null;
}

const MS_PER_YEAR = 365.25 * 86_400_000;
const MS_PER_DAY = 86_400_000;

export function valueCollectible(
  terms: CollectibleTerms,
  now: Date,
): CollectibleValuation {
  const holdingMs = Math.max(0, now.getTime() - terms.purchaseDate.getTime());
  const holdingYears = new Decimal(holdingMs).dividedBy(MS_PER_YEAR);

  const currentValue = terms.appraisalValue ?? terms.purchasePrice;
  const basis: "appraisal" | "book" = terms.appraisalValue ? "appraisal" : "book";

  const unrealizedPnl = currentValue.minus(terms.purchasePrice);
  const cumulativeCosts = terms.annualCosts.times(holdingYears);
  const netResult = unrealizedPnl.minus(cumulativeCosts);

  // Yıllık bileşik getiri: (bugün/alış)^(1/yıl) − 1
  let annualizedReturn: Decimal | null = null;
  if (holdingYears.greaterThan(0) && terms.purchasePrice.isPositive()) {
    const ratio = currentValue.ratioTo(terms.purchasePrice);
    if (ratio.greaterThan(0)) {
      annualizedReturn = new Decimal(
        Math.pow(ratio.toNumber(), 1 / holdingYears.toNumber()) - 1,
      );
    }
  }

  return {
    currentValue,
    basis,
    unrealizedPnl,
    holdingYears,
    cumulativeCosts,
    netResult,
    annualizedReturn,
    appraisalAgeDays: terms.appraisalDate
      ? Math.max(
          0,
          Math.floor((now.getTime() - terms.appraisalDate.getTime()) / MS_PER_DAY),
        )
      : null,
  };
}

export const CATEGORY_LABEL: Record<string, string> = {
  art: "Sanat eseri",
  watch: "Saat",
  jewelry: "Mücevher",
  vehicle_classic: "Klasik araç",
  wine: "Şarap",
  other: "Diğer",
};

/** Ekspertiz bu süreden eskiyse arayüz tazelenmesini önerir. */
export const STALE_APPRAISAL_DAYS = 730;
