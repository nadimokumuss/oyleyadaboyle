import { PageShell, Card } from "@/components/PageShell";
import { computeNetWorth } from "@/lib/valuation";
import { ensureSettingsRow } from "@/lib/auth";
import { proposeAllocation, compareToCurrent } from "@/lib/engine/allocation";
import { Money, formatMoney, formatPercent } from "@/lib/money";
import { cn } from "@/lib/cn";
import { CompareLab } from "@/components/CompareLab";
import { ApplyTargetsButton } from "@/components/ApplyTargetsButton";

export const dynamic = "force-dynamic";

export default async function KarsilastirPage() {
  const cfg = ensureSettingsRow();
  const nw = await computeNetWorth();

  const hasVentures = Object.keys(nw.byKind).includes("venture");

  const proposal = proposeAllocation({
    riskProfile: cfg.riskProfile,
    horizonYears: cfg.horizonYears ?? 20,
    monthlyLivingCost: Money.fromDb(
      cfg.monthlyLivingCost,
      cfg.livingCostCurrency ?? "USD",
    ),
    totalWealth: nw.totalUsd,
    hasVentures,
  });

  const gaps = compareToCurrent(proposal, nw.byKind, nw.totalUsd);
  const needsAction = gaps.filter((g) => g.action !== "uygun");

  return (
    <PageShell
      title="Karşılaştır"
      subtitle="Dağılım önerisi ve aday yatırımların yan yana simülasyonu."
    >
      {/* --- Dağılım önerisi --- */}
      <Card
        title="Size önerilen dağılım"
        hint={`${cfg.riskProfile === "conservative" ? "Temkinli" : cfg.riskProfile === "aggressive" ? "Atak" : "Dengeli"} · ${cfg.horizonYears ?? 20} yıl`}
        className="mb-4"
      >
        <p className="mb-4 text-pretty text-sm text-ink-muted">{proposal.summary}</p>

        <ul className="space-y-3">
          {proposal.slices.map((s) => {
            const gap = gaps.find((g) => g.kind === s.kind);
            return (
              <li key={s.kind} className="border-b border-line/50 pb-3 last:border-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-ink">{s.label}</span>
                  <span className="num flex items-baseline gap-3 text-sm">
                    <span className="text-ink">
                      {formatPercent(s.targetPct, { decimals: 0 })}
                    </span>
                    <span className="text-ink-faint">
                      {formatMoney(s.amount, { compact: true })}
                    </span>
                  </span>
                </div>

                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${s.targetPct.toNumber() * 100}%` }}
                  />
                </div>

                {gap && (
                  <p
                    className={cn(
                      "num mt-1.5 text-xs",
                      gap.action === "uygun" && "text-gain",
                      gap.action === "artır" && "text-warn",
                      gap.action === "azalt" && "text-warn",
                    )}
                  >
                    Şu an {formatPercent(gap.currentPct, { decimals: 0 })} —{" "}
                    {gap.action === "uygun"
                      ? "hedefe uygun"
                      : `${formatMoney(gap.delta.abs(), { compact: true })} ${gap.action}`}
                  </p>
                )}

                <p className="mt-1 text-pretty text-xs text-ink-faint">{s.rationale}</p>
              </li>
            );
          })}
        </ul>

        <div className="mt-4 rounded-md border border-line bg-surface px-3 py-2.5">
          <p className="text-xs font-medium text-ink">
            Acil durum yastığı: {proposal.emergencyMonths} ay ·{" "}
            <span className="num">{formatMoney(proposal.emergencyAmount)}</span>
          </p>
          <p className="mt-1 text-pretty text-xs text-ink-muted">
            Nakit payının en azından bu kadarı her zaman elde kalmalı — yatırım
            değil, hayat sigortası.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <ApplyTargetsButton
            targets={proposal.slices.map((s) => ({
              kind: s.kind,
              pct: s.targetPct.toFixed(),
            }))}
          />
          {needsAction.length > 0 && (
            <span className="text-xs text-ink-faint">
              {needsAction.length} sınıfta ayarlama gerekiyor
            </span>
          )}
        </div>

        <ul className="mt-4 space-y-1.5 border-t border-line pt-3">
          {proposal.caveats.map((c, i) => (
            <li key={i} className="text-pretty text-xs text-ink-faint">
              · {c}
            </li>
          ))}
        </ul>
      </Card>

      {/* --- Yatırım karşılaştırma --- */}
      <Card
        title="Yatırım karşılaştırma"
        hint="aynı para, farklı yerlerde"
      >
        <CompareLab defaultAmount={pickDefaultAmount(nw.totalUsd)} />
      </Card>

      <p className="mt-6 text-pretty text-xs text-ink-faint">
        Bu sayfa hesaplamaya dayalı bilgilendirme üretir; yatırım tavsiyesi
        değildir. Dağılım önerisi genel portföy kurgularına dayanır ve kişisel
        vergi durumunuzu, borçlarınızı veya gelir güvenliğinizi hesaba katmaz.
      </p>
    </PageShell>
  );
}

/** Karşılaştırma için makul bir başlangıç tutarı seç. */
function pickDefaultAmount(total: Money): string {
  if (total.isZero()) return "1000000";
  // Servetin onda biri, yuvarlanmış
  const tenth = total.dividedBy(10).toNumber();
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(1000, tenth))));
  return String(Math.round(tenth / magnitude) * magnitude);
}
