import Decimal from "decimal.js";
import { Money, toDecimal } from "@/lib/money";

/**
 * Bireysel emeklilik (BES) ve benzeri emeklilik hesapları.
 *
 * ## Neden ayrı bir modül
 *
 * BES bakiyesi iki parçadan oluşur ve ikisi **aynı ölçüde sizin değildir**:
 *
 *  - **Katılımcı birikimi**: her an sizindir, çıkarsanız tamamını alırsınız
 *  - **Devlet katkısı**: sistemde kalma sürenize göre kademeli hak edilir
 *
 * Hak edilmemiş devlet katkısını net servete yazmak, sahip olmadığınız
 * parayı servetinize eklemek olur — panelin "planlanan varlık servete
 * sayılmaz" kuralıyla aynı gerekçe.
 *
 * ## Neden kademeler koda gömülü değil
 *
 * Hak ediş oranları mevzuatla değişir. Varsayılanlar Türkiye'nin bugünkü
 * düzenine göre yazıldı ama her hesap kendi kademelerini taşıyabilir.
 */

export interface VestingTier {
  /** Bu kademe için gereken sistemde kalma yılı. */
  years: number;
  /** Hak edilen devlet katkısı oranı (0.15 = %15). */
  pct: string;
}

/**
 * Türkiye BES varsayılan hak ediş kademeleri.
 *
 * TEMSİLÎdir ve mevzuat değiştiğinde güncellenmelidir. 3 yıldan önce
 * ayrılan devlet katkısının hiçbirini alamaz; emeklilik hakkı
 * kazanıldığında (56 yaş + 10 yıl) tamamı hak edilir.
 */
export const DEFAULT_VESTING_TIERS: VestingTier[] = [
  { years: 3, pct: "0.15" },
  { years: 6, pct: "0.35" },
  { years: 10, pct: "0.60" },
];

const MS_PER_YEAR = 365.25 * 86_400_000;

/** Sistemde geçen süre (yıl). */
export function yearsInSystem(startDate: Date, now: Date): Decimal {
  const ms = now.getTime() - startDate.getTime();
  if (ms <= 0) return new Decimal(0);
  return new Decimal(ms).dividedBy(MS_PER_YEAR);
}

/**
 * Devlet katkısının hak edilen oranı.
 *
 * Emeklilik tarihi geldiyse %100 — kademelere bakılmaz. Aksi halde
 * dolan en yüksek kademe geçerlidir; kademeler arası **ara değer
 * verilmez**, çünkü hak ediş eşik tabanlıdır: 5 yıl 11 ay ile 3 yıl aynı
 * orana tabidir.
 */
export function vestedRatio(
  startDate: Date,
  now: Date,
  tiers: VestingTier[] = DEFAULT_VESTING_TIERS,
  retirementDate: Date | null = null,
): Decimal {
  if (retirementDate && now >= retirementDate) return new Decimal(1);

  const years = yearsInSystem(startDate, now);
  let ratio = new Decimal(0);

  // Kademeler sıralı gelmeyebilir; en yüksek dolanı bulmak için hepsine bak.
  for (const tier of tiers) {
    if (years.greaterThanOrEqualTo(tier.years)) {
      const pct = toDecimal(tier.pct);
      if (pct.greaterThan(ratio)) ratio = pct;
    }
  }

  return Decimal.min(new Decimal(1), ratio);
}

export interface PensionTerms {
  participantBalance: Money;
  stateContribution: Money;
  startDate: Date;
  retirementDate: Date | null;
  tiers: VestingTier[];
  monthlyContribution: Money;
}

export interface PensionValuation {
  /** Net servete yazılan tutar: birikim + hak edilmiş katkı. */
  vestedValue: Money;
  /** Hak edilmiş devlet katkısı. */
  vestedState: Money;
  /** Henüz hak edilmemiş — sistemde kalırsanız kazanacağınız. */
  unvestedState: Money;
  vestedRatio: Decimal;
  yearsInSystem: Decimal;
  /** Bir sonraki kademe ve ona kalan süre. Hepsi dolduysa null. */
  nextTier: { years: number; pct: string; yearsRemaining: Decimal } | null;
  /** Şu an çıkarsanız elinize geçecek (hak edilmemiş katkı yanar). */
  earlyExitValue: Money;
  retired: boolean;
}

/**
 * BES hesabının değerlemesi.
 *
 * `vestedValue` net servete girer. `unvestedState` ayrı gösterilir —
 * kayıp değil, henüz kazanılmamış bir tutardır ve bunu görmek sistemde
 * kalma kararını etkiler.
 */
export function valuePension(terms: PensionTerms, now: Date): PensionValuation {
  const years = yearsInSystem(terms.startDate, now);
  const ratio = vestedRatio(terms.startDate, now, terms.tiers, terms.retirementDate);

  const vestedState = terms.stateContribution.times(ratio);
  const unvestedState = terms.stateContribution.minus(vestedState);
  const vestedValue = terms.participantBalance.plus(vestedState);

  // Sıradaki kademe: henüz dolmamışların en yakını.
  const pending = terms.tiers
    .filter((t) => years.lessThan(t.years))
    .sort((a, b) => a.years - b.years);

  const nextTier = pending[0]
    ? {
        years: pending[0].years,
        pct: pending[0].pct,
        yearsRemaining: new Decimal(pending[0].years).minus(years),
      }
    : null;

  return {
    vestedValue,
    vestedState,
    unvestedState,
    vestedRatio: ratio,
    yearsInSystem: years,
    nextTier,
    // Erken çıkışta hak edilmemiş katkı devlete geri döner.
    earlyExitValue: vestedValue,
    retired: terms.retirementDate !== null && now >= terms.retirementDate,
  };
}

/**
 * Emekliliğe kadar projeksiyon.
 *
 * Basit bir birikim modeli: aylık katkı + varsayılan yıllık getiri.
 * Devlet katkısı katkı payının yüzdesi olarak eklenir (Türkiye'de %30).
 *
 * Bu bir tahmindir; fon performansı garanti edilmez.
 */
export function projectPension(
  terms: PensionTerms,
  now: Date,
  targetDate: Date,
  annualReturn: Decimal | string,
  stateMatchRate: Decimal | string = "0.30",
): { finalBalance: Money; totalContributed: Money; totalStateMatch: Money } {
  const currency = terms.participantBalance.currency;
  const months = Math.max(
    0,
    Math.round((targetDate.getTime() - now.getTime()) / (MS_PER_YEAR / 12)),
  );

  const monthlyReturn = toDecimal(annualReturn).dividedBy(12);
  const matchRate = toDecimal(stateMatchRate);

  let balance = terms.participantBalance.plus(terms.stateContribution);
  let contributed = Money.zero(currency);
  let stateMatch = Money.zero(currency);

  for (let m = 0; m < months; m++) {
    balance = balance.times(monthlyReturn.plus(1)).plus(terms.monthlyContribution);
    const match = terms.monthlyContribution.times(matchRate);
    balance = balance.plus(match);
    contributed = contributed.plus(terms.monthlyContribution);
    stateMatch = stateMatch.plus(match);
  }

  return { finalBalance: balance, totalContributed: contributed, totalStateMatch: stateMatch };
}
