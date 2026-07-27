import type Decimal from "decimal.js";
import { Money } from "@/lib/money";
import type { NetWorth } from "@/lib/valuation";
import type { DepositView } from "@/lib/finance/depositService";
import type { PropertyView, VehicleView } from "@/lib/finance/assetService";
import type { VentureView, CashflowView } from "@/lib/finance/cashflowService";
import type { PortfolioView } from "@/lib/finance/portfolioService";
import type { Assumptions } from "@/lib/assumptions";

/**
 * Fırsat motorunun veri sözleşmesi.
 *
 * Kurallar saf fonksiyonlardır: aynı portföy durumu → aynı fırsatlar.
 * Yan etkileri yoktur, DB'ye dokunmazlar, test edilebilirler.
 */

export type Severity = "critical" | "high" | "medium" | "info";

export interface Opportunity {
  /** Kuralın kimliği — aynı kural tekrar tetiklenirse üzerine yazılır. */
  id: string;
  ruleKey: string;
  severity: Severity;
  title: string;
  /** Ne olduğu ve neden önemli olduğu — somut sayılarla. */
  detail: string;
  /** Önerilen adım. */
  action: string;
  /** Bu fırsat değerlendirilirse aylık tahmini kazanç (USD). Yoksa null. */
  estimatedMonthlyGain: Money | null;
  /** İlgili varlıklar. */
  assetIds?: string[];
}

/** Kuralların okuduğu tam portföy görüntüsü. */
export interface PortfolioState {
  netWorth: NetWorth;
  portfolio: PortfolioView;
  deposits: DepositView[];
  properties: PropertyView[];
  vehicles: VehicleView[];
  ventures: VentureView[];
  cashflow: CashflowView;
  settings: {
    idleCashThreshold: Decimal;
    concentrationThreshold: Decimal;
    riskProfile: string;
  };
  targets: Array<{ dimension: string; key: string; targetPct: Decimal; tolerancePct: Decimal }>;
  /**
   * Kullanıcının düzenleyebildiği varsayımlar (enflasyon, referans getiriler).
   * Kurallar bunları koda gömmemeli — `lib/assumptions.ts` tek kaynak.
   */
  assumptions: Assumptions;
  /**
   * Yerel para birimindeki tutarı USD'ye çevirir.
   *
   * Kurallara veriliyor çünkü `estimatedMonthlyGain` alanları toplanıyor
   * ve farklı para birimlerini toplamak `Money` tarafından engellenir.
   * Kur bilinmiyorsa sıfır döner — yanlış kurla hesaplamaktansa
   * hesaplamamak yeğdir.
   */
  toUsd: (money: Money) => Money;
  now: Date;
}

export interface Rule {
  key: string;
  label: string;
  /** null dönerse bu kural tetiklenmedi. */
  evaluate(state: PortfolioState): Opportunity[] | Opportunity | null;
}

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  info: 3,
};
