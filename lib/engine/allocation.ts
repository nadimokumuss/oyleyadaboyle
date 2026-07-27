import Decimal from "decimal.js";
import { Money } from "@/lib/money";

/**
 * Dağılım önerisi.
 *
 * "10 milyon doları nasıl dağıtayım?" sorusuna gerekçeli bir cevap
 * üretir. Her oranın NEDEN o olduğu ayrıca yazılır — gerekçesiz bir
 * yüzde tablosu, kullanıcının kendi durumuna uyarlayamayacağı bir
 * dayatmadır.
 *
 * Bu bir yatırım tavsiyesi değil; yaygın kabul görmüş portföy
 * kurgularının (yaş/vade/risk profiline göre) hesaplanmış halidir.
 */

export type RiskProfile = "conservative" | "balanced" | "aggressive";

export interface AllocationInput {
  riskProfile: RiskProfile;
  /** Yatırım vadesi (yıl). */
  horizonYears: number;
  /** Aylık yaşam gideri — acil durum yastığı bundan hesaplanır. */
  monthlyLivingCost: Money;
  /** Toplam yatırılabilir servet. */
  totalWealth: Money;
  /** Girişimci mi? Kendi işine sermaye ayıracak mı? */
  hasVentures: boolean;
}

export interface AllocationSlice {
  kind: string;
  label: string;
  targetPct: Decimal;
  amount: Money;
  /** Bu oranın gerekçesi. */
  rationale: string;
}

export interface AllocationProposal {
  slices: AllocationSlice[];
  /** Acil durum yastığı (ay cinsinden). */
  emergencyMonths: number;
  emergencyAmount: Money;
  /** Genel yaklaşımın özeti. */
  summary: string;
  /** Dikkat edilmesi gerekenler. */
  caveats: string[];
}

const LABELS: Record<string, string> = {
  cash: "Nakit",
  bond: "Tahvil",
  pension: "Emeklilik",
  collectible: "Kıymetli eşya",
  deposit: "Mevduat / sabit getiri",
  equity: "Hisse ve ETF",
  crypto: "Kripto",
  realestate: "Gayrimenkul",
  venture: "Girişim",
  commodity: "Altın / emtia",
};

/**
 * Temel dağılımlar.
 *
 * Hisse ağırlığı vadeyle artar: 20 yıllık bir vadede piyasa
 * dalgalanmasını atlatacak zaman vardır, 3 yıllık vadede yoktur.
 */
const BASE: Record<RiskProfile, Record<string, number>> = {
  conservative: {
    deposit: 0.45, equity: 0.20, realestate: 0.20, commodity: 0.10, crypto: 0.00, venture: 0.00, cash: 0.05,
  },
  balanced: {
    deposit: 0.25, equity: 0.35, realestate: 0.20, commodity: 0.07, crypto: 0.05, venture: 0.03, cash: 0.05,
  },
  aggressive: {
    deposit: 0.10, equity: 0.40, realestate: 0.15, commodity: 0.05, crypto: 0.15, venture: 0.10, cash: 0.05,
  },
};

const RATIONALE: Record<string, Record<RiskProfile, string>> = {
  deposit: {
    conservative:
      "Ağırlığın büyük kısmı sabit getiride: sermayeyi korumak öncelik. Enflasyonun altında kalma riskine karşı reel getirisi panelde takip edilmeli.",
    balanced:
      "Dalgalanmayı yumuşatan ve nakit ihtiyacında ilk başvurulacak kısım. Vade merdiveni kurmak (farklı tarihlerde biten mevduatlar) esneklik sağlar.",
    aggressive:
      "Sadece kısa vadeli ihtiyaçları karşılayacak kadar; gerisi büyüme varlıklarında.",
  },
  equity: {
    conservative: "Sınırlı hisse ağırlığı, ağırlıklı olarak geniş endeks fonları.",
    balanced:
      "Uzun vadede enflasyonu en güvenilir yenen varlık sınıfı. Tek hisse yerine geniş endeks (S&P 500, MSCI World gibi) çekirdek olmalı.",
    aggressive:
      "Portföyün motoru. Yüksek ağırlık ancak uzun vadede ve düşüşlerde satmama disipliniyle anlamlı.",
  },
  realestate: {
    conservative: "Kira geliri düzenli nakit akışı sağlar; değer artışı ikincil.",
    balanced:
      "Enflasyona karşı doğal koruma ve kira geliri. Tek bir şehre yoğunlaşmamak önemli — panel ülke maruziyetini gösterir.",
    aggressive: "Kaldıraç kullanılıyorsa risk ciddi artar; nakit akışını mutlaka hesaplayın.",
  },
  crypto: {
    conservative: "Bu profilde önerilmiyor — oynaklık sermaye koruma hedefiyle çelişiyor.",
    balanced:
      "Küçük ve kaybedilmesi göze alınabilir bir pay. Tamamen sıfırlanması ihtimalini hesaba katın.",
    aggressive:
      "Yüksek getiri potansiyeli, yüksek kayıp riski. Bu payın tamamını kaybetseniz planınız bozulmamalı.",
  },
  venture: {
    conservative: "Bu profilde önerilmiyor — likidite yok, kayıp ihtimali yüksek.",
    balanced: "Kendi işinize sermaye ayırıyorsanız sınırlı tutun; illikit ve riskli.",
    aggressive:
      "Girişim yatırımlarının çoğu sıfırlanır, azı her şeyi karşılar. Tek bir girişime yığmayın.",
  },
  commodity: {
    conservative: "Altın kriz dönemlerinde sığınak işlevi görür.",
    balanced: "Küçük bir altın payı, kur ve kriz şoklarında dengeleyici olur.",
    aggressive: "Sınırlı — büyüme üretmez, sadece korur.",
  },
  cash: {
    conservative: "Acil durum yastığı ve fırsat nakdi.",
    balanced: "Acil durumlar ve fırsatlar için. Fazlası enflasyona yem olur.",
    aggressive: "Minimum düzeyde; atıl nakit fırsat maliyetidir.",
  },
};

export function proposeAllocation(input: AllocationInput): AllocationProposal {
  const base = { ...BASE[input.riskProfile] };

  // --- Vadeye göre ayarlama ---
  // Kısa vadede hisse azalır, sabit getiri artar: 3 yıl içinde paraya
  // ihtiyacınız varsa borsanın toparlanmasını bekleyecek vaktiniz yok.
  const horizon = input.horizonYears;
  if (horizon < 5) {
    const shift = Math.min(0.20, (5 - horizon) * 0.05);
    base.equity = Math.max(0, base.equity - shift);
    base.crypto = Math.max(0, base.crypto - shift / 2);
    base.deposit += shift + shift / 2;
  } else if (horizon > 20) {
    const shift = Math.min(0.10, (horizon - 20) * 0.005);
    base.deposit = Math.max(0, base.deposit - shift);
    base.equity += shift;
  }

  // --- Girişim tercihi ---
  if (!input.hasVentures && base.venture > 0) {
    base.equity += base.venture;
    base.venture = 0;
  }

  // --- Acil durum yastığı ---
  // Nakit payı en az 6 aylık gideri karşılamalı; büyük servetlerde bu
  // oran zaten küçük kalır ama küçük servetlerde belirleyici olur.
  const emergencyMonths = input.riskProfile === "conservative" ? 12 : 6;
  const emergencyAmount = input.monthlyLivingCost.times(emergencyMonths);

  if (!input.totalWealth.isZero()) {
    const neededCashPct = emergencyAmount.ratioTo(input.totalWealth).toNumber();
    if (neededCashPct > base.cash) {
      const extra = Math.min(0.3, neededCashPct) - base.cash;
      base.cash += extra;
      // Farkı en riskli kalemlerden düş
      for (const k of ["crypto", "venture", "equity", "realestate"]) {
        if (extra <= 0) break;
        const take = Math.min(base[k] ?? 0, extra);
        base[k] = (base[k] ?? 0) - take;
      }
    }
  }

  // Normalize: toplam tam 1 olsun
  const total = Object.values(base).reduce((a, b) => a + b, 0);
  const slices: AllocationSlice[] = Object.entries(base)
    .map(([kind, pct]) => ({ kind, pct: total > 0 ? pct / total : 0 }))
    .filter((s) => s.pct > 0.001)
    .sort((a, b) => b.pct - a.pct)
    .map((s) => ({
      kind: s.kind,
      label: LABELS[s.kind] ?? s.kind,
      targetPct: new Decimal(s.pct),
      amount: input.totalWealth.times(s.pct),
      rationale:
        RATIONALE[s.kind]?.[input.riskProfile] ?? "Dengeleyici bir pay.",
    }));

  const caveats = [
    "Bu dağılım genel portföy kurgularına dayanır; kişisel vergi durumunuzu, borçlarınızı ve gelir güvenliğinizi hesaba katmaz.",
    "Tek seferde değil, kademeli geçiş genelde daha az pişmanlık üretir.",
    "Hedefleri kaydederseniz Fırsatlar sayfası sapmaları otomatik takip eder.",
  ];

  if (input.horizonYears < 5) {
    caveats.push(
      `Vadeniz ${input.horizonYears} yıl — kısa. Hisse ağırlığı bu yüzden düşürüldü; paraya ihtiyaç duyduğunuzda piyasa düşükte olabilir.`,
    );
  }
  if (input.riskProfile === "aggressive") {
    caveats.push(
      "Atak profilde portföyün yarıya inmesi ihtimali gerçektir. Böyle bir düşüşte satmayacağınızdan emin değilseniz dengeli profili seçin.",
    );
  }

  const summary =
    input.riskProfile === "conservative"
      ? `${input.horizonYears} yıllık vade ve temkinli profil için sermaye korumaya ağırlık veren bir dağılım.`
      : input.riskProfile === "aggressive"
        ? `${input.horizonYears} yıllık vade ve atak profil için büyümeye ağırlık veren, dalgalanması yüksek bir dağılım.`
        : `${input.horizonYears} yıllık vade ve dengeli profil için büyüme ve güvenliği birlikte gözeten bir dağılım.`;

  return { slices, emergencyMonths, emergencyAmount, summary, caveats };
}

/* ------------------------------------------------------------------ */
/* Mevcut durumla karşılaştırma                                        */
/* ------------------------------------------------------------------ */

export interface AllocationGap {
  kind: string;
  label: string;
  currentPct: Decimal;
  targetPct: Decimal;
  /** Hedefe ulaşmak için gereken tutar (pozitif = ekle, negatif = azalt). */
  delta: Money;
  action: "artır" | "azalt" | "uygun";
}

export function compareToCurrent(
  proposal: AllocationProposal,
  currentByKind: Record<string, string>,
  totalWealth: Money,
  tolerance = 0.05,
): AllocationGap[] {
  const total = Object.values(currentByKind).reduce(
    (a, v) => a.plus(v),
    new Decimal(0),
  );

  const kinds = new Set([
    ...proposal.slices.map((s) => s.kind),
    ...Object.keys(currentByKind),
  ]);

  return [...kinds]
    .map((kind) => {
      const slice = proposal.slices.find((s) => s.kind === kind);
      const targetPct = slice?.targetPct ?? new Decimal(0);
      const currentPct = total.isZero()
        ? new Decimal(0)
        : new Decimal(currentByKind[kind] ?? 0).dividedBy(total);

      const diff = targetPct.minus(currentPct);
      const delta = totalWealth.times(diff);

      return {
        kind,
        label: LABELS[kind] ?? kind,
        currentPct,
        targetPct,
        delta,
        action: (diff.abs().lessThanOrEqualTo(tolerance)
          ? "uygun"
          : diff.isPositive()
            ? "artır"
            : "azalt") as AllocationGap["action"],
      };
    })
    .filter((g) => g.targetPct.greaterThan(0) || g.currentPct.greaterThan(0))
    .sort((a, b) => b.delta.amount.abs().comparedTo(a.delta.amount.abs()));
}
