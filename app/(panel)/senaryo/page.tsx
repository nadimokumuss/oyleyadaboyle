import Decimal from "decimal.js";
import { PageShell, Card, ScrollTable } from "@/components/PageShell";
import { computeNetWorth } from "@/lib/valuation";
import {
  simulate, runStressTest, STRESS_SCENARIOS, DEFAULT_ASSUMPTIONS,
  type AssetClassAssumption, type StressAsset,
} from "@/lib/engine/montecarlo";
import { Money, formatMoney, formatPercent } from "@/lib/money";
import { cn } from "@/lib/cn";
import { loadGoals } from "@/lib/services/goals";
import { GoalsForm, type GoalRow } from "@/components/forms/GoalsForm";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  equity: "Hisse", crypto: "Kripto", commodity: "Emtia", deposit: "Mevduat",
  realestate: "Gayrimenkul", vehicle: "Araç", venture: "Girişim", cash: "Nakit",
};

const HORIZON = 20;

export default async function SenaryoPage() {
  const nw = await computeNetWorth();
  const total = nw.totalUsd;

  // Mevcut dağılımdan varsayım tablosu kur
  const assumptions: AssetClassAssumption[] = Object.entries(nw.byKind)
    .filter(([, v]) => new Decimal(v).greaterThan(0))
    .map(([kind, value]) => {
      const a = DEFAULT_ASSUMPTIONS[kind] ?? { expectedReturn: 0.03, volatility: 0.1 };
      return {
        key: kind,
        label: KIND_LABEL[kind] ?? kind,
        weight: total.isZero()
          ? 0
          : new Decimal(value).dividedBy(total.amount).toNumber(),
        expectedReturn: a.expectedReturn,
        volatility: a.volatility,
      };
    })
    .sort((a, b) => b.weight - a.weight);

  // Hedefler simülasyondan ÖNCE yüklenir: her hedefin ulaşma olasılığı
  // aynı simülasyonun kendi yılındaki değerlerinden çıkarılır, ayrı bir
  // koşu gerekmez.
  const goals = await loadGoals();

  const sim = simulate({
    initialValue: total.toNumber(),
    assumptions,
    years: HORIZON,
    paths: 10_000,
    seed: 42,
    goalTargets: goals.map((g) => ({
      amount: Number(g.targetUsd),
      year: Math.max(0, g.yearsRemaining),
    })),
  });

  const goalRows: GoalRow[] = goals.map((g, i) => ({
    id: g.id,
    name: g.name,
    kind: g.kind,
    targetAmount: g.targetAmount,
    currency: g.currency,
    targetDate: g.targetDate,
    currentUsd: g.currentUsd,
    targetUsd: g.targetUsd,
    yearsRemaining: g.yearsRemaining,
    progressRatio: g.progress.progress.toFixed(),
    achieved: g.progress.achieved,
    overdue: g.progress.overdue,
    shortfallUsd: g.progress.shortfall.toFixed(),
    requiredAnnualReturn: g.progress.requiredAnnualReturn?.toFixed() ?? null,
    requiredMonthlySaving: g.progress.requiredMonthlySaving?.toFixed() ?? null,
    probability: sim.goalProbabilities[i] ?? null,
  }));

  const stressAssets: StressAsset[] = nw.assets.map((a) => ({
    name: a.name,
    kind: a.kind,
    currency: a.currency,
    valueUsd: a.valueUsd,
  }));

  const stress = STRESS_SCENARIOS.map((s) => runStressTest(stressAssets, s));

  return (
    <PageShell
      title="Senaryo"
      subtitle={`${HORIZON} yıllık Monte Carlo simülasyonu ve kriz stres testleri.`}
    >
      {/* --- Monte Carlo --- */}
      <Card
        title={`${HORIZON} yıl sonra ne olurum?`}
        hint={`${sim.paths.toLocaleString("tr-TR")} simülasyon`}
        className="mb-4"
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Outcome
            label="Kötümser (p10)"
            value={sim.finalP10}
            current={total}
            tone="loss"
          />
          <Outcome
            label="Orta (medyan)"
            value={sim.finalP50}
            current={total}
            emphasis
          />
          <Outcome
            label="İyimser (p90)"
            value={sim.finalP90}
            current={total}
            tone="gain"
          />
        </div>

        <FanChart percentiles={sim.percentiles} />

        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-3 text-xs">
          <Meta
            label="Portföy beklenen getirisi"
            value={formatPercent(new Decimal(sim.portfolioReturn), { decimals: 2 })}
          />
          <Meta
            label="Portföy volatilitesi"
            value={formatPercent(new Decimal(sim.portfolioVolatility), { decimals: 2 })}
          />
          <Meta
            label="Bugünkü değerin altına düşme olasılığı"
            value={formatPercent(new Decimal(sim.probabilityOfLoss), { decimals: 1 })}
          />
        </dl>

        <p className="mt-3 text-pretty text-xs text-ink-faint">
          Getiriler reel (enflasyondan arındırılmış) varsayılmıştır. Volatilite
          sınıflar arası korelasyon hesaba katılmadan ağırlıklı toplanır — bu,
          çeşitlendirmenin faydasını yok sayar ve riski olduğundan büyük gösterir.
          Yanılma yönü bilinçli olarak temkinli tarafta bırakılmıştır.
        </p>
      </Card>

      {/* --- Varsayımlar --- */}
      <Card title="Kullanılan varsayımlar" hint="mevcut dağılımınıza göre" className="mb-4">
        <ScrollTable label="Stres testi sonuçları">
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-faint">
                <th className="py-2 pr-4 font-medium">Varlık sınıfı</th>
                <th className="py-2 pr-4 text-right font-medium">Ağırlık</th>
                <th className="py-2 pr-4 text-right font-medium">Beklenen getiri</th>
                <th className="py-2 text-right font-medium">Volatilite</th>
              </tr>
            </thead>
            <tbody>
              {assumptions.map((a) => (
                <tr key={a.key} className="border-b border-line/50 last:border-0">
                  <td className="py-2 pr-4 text-ink">{a.label}</td>
                  <td className="num py-2 pr-4 text-right text-ink-muted">
                    {formatPercent(a.weight, { decimals: 1 })}
                  </td>
                  <td
                    className={cn(
                      "num py-2 pr-4 text-right",
                      a.expectedReturn > 0 ? "text-gain" : "text-loss",
                    )}
                  >
                    {formatPercent(a.expectedReturn, { signed: true, decimals: 1 })}
                  </td>
                  <td className="num py-2 text-right text-ink-muted">
                    {formatPercent(a.volatility, { decimals: 1 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollTable>
      </Card>

      {/* --- Stres testi --- */}
      <Card title="Kriz stres testleri" hint="anlık şok">
        <ul className="space-y-3">
          {stress.map((s) => {
            const ratio = new Decimal(s.lossRatio);
            return (
              <li key={s.key} className="rounded-md border border-line bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium text-ink">{s.label}</h3>
                    <p className="mt-0.5 text-pretty text-xs text-ink-faint">
                      {s.description}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="num text-sm font-medium text-loss">
                      {formatMoney(Money.of(s.loss, "USD").negated(), { compact: true })}
                    </p>
                    <p className="num text-xs text-ink-faint">
                      {formatPercent(ratio.negated(), { decimals: 1 })}
                    </p>
                  </div>
                </div>

                {/* Kalan servet çubuğu */}
                <div className="mt-3">
                  <div className="h-1.5 overflow-hidden rounded-full bg-loss/30">
                    <div
                      className="h-full rounded-full bg-gain"
                      style={{
                        width: `${Math.max(0, Math.min(100, (1 - ratio.toNumber()) * 100))}%`,
                      }}
                    />
                  </div>
                  <p className="num mt-1.5 text-xs text-ink-muted">
                    {formatMoney(Money.of(s.before, "USD"), { compact: true })} →{" "}
                    <span className="text-ink">
                      {formatMoney(Money.of(s.after, "USD"), { compact: true })}
                    </span>
                  </p>
                </div>

                {s.impacts.length > 0 && (
                  <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {s.impacts.map((i) => (
                      <li key={i.name} className="num text-ink-faint">
                        {i.name}{" "}
                        <span className="text-loss">
                          {formatMoney(Money.of(i.loss, "USD").negated(), { compact: true })}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <p className="mt-6 text-pretty text-xs text-ink-faint">
        Simülasyonlar hesaplamaya dayalı bilgilendirmedir, yatırım tavsiyesi
        değildir. Geçmiş getiriler gelecek performansı garanti etmez ve buradaki
        varsayımlar temsilîdir.
      </p>
      <Card
        title="Finansal hedefler"
        hint="olasılıklar yukarıdaki simülasyondan"
        className="mt-4"
      >
        <GoalsForm goals={goalRows} />
        <p className="mt-3 text-pretty text-xs text-ink-faint">
          Ulaşma olasılığı, 10.000 simülasyon yolunun kaçının hedefi
          <strong className="text-ink-muted"> hedef tarihinde </strong>
          tutturduğudur. Bandın ortasına bakıp &ldquo;yeter&rdquo; demekten
          daha dürüst bir cevaptır, ama yine de bir modeldir: getiri ve
          volatilite varsayımları değişirse sonuç da değişir.
        </p>
      </Card>
    </PageShell>
  );
}

/** Huni grafiği: p10–p90 bandı, ortada medyan çizgisi. */
function FanChart({
  percentiles,
}: {
  percentiles: Array<{ year: number; p10: string; p25: string; p50: string; p75: string; p90: string }>;
}) {
  if (percentiles.length < 2) return null;

  const W = 100;
  const H = 40;
  const maxV = Math.max(...percentiles.map((p) => Number(p.p90)));
  const maxYear = percentiles[percentiles.length - 1].year;
  if (maxV <= 0) return null;

  const x = (year: number) => (year / maxYear) * W;
  const y = (v: number) => H - (v / maxV) * H;

  const band = (lo: keyof (typeof percentiles)[0], hi: keyof (typeof percentiles)[0]) => {
    const up = percentiles.map((p) => `${x(p.year)},${y(Number(p[hi]))}`);
    const down = [...percentiles].reverse().map((p) => `${x(p.year)},${y(Number(p[lo]))}`);
    return [...up, ...down].join(" ");
  };

  const median = percentiles.map((p) => `${x(p.year)},${y(Number(p.p50))}`).join(" ");

  return (
    <figure className="mt-4">
      <figcaption className="mb-1.5 text-xs text-ink-faint">
        Olası servet aralığı · koyu bant %50, açık bant %80 olasılık
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-40 w-full"
        role="img"
        aria-label={`${maxYear} yıllık projeksiyon: medyan ${formatMoney(
          Money.of(percentiles[percentiles.length - 1].p50, "USD"),
          { compact: true },
        )}, aralık ${formatMoney(Money.of(percentiles[percentiles.length - 1].p10, "USD"), {
          compact: true,
        })} ile ${formatMoney(Money.of(percentiles[percentiles.length - 1].p90, "USD"), {
          compact: true,
        })} arasında`}
      >
        <polygon points={band("p10", "p90")} className="fill-accent/12" />
        <polygon points={band("p25", "p75")} className="fill-accent/25" />
        <polyline
          points={median}
          className="fill-none stroke-accent"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="num mt-1 flex justify-between text-xs text-ink-faint">
        <span>bugün</span>
        <span>{maxYear} yıl sonra</span>
      </div>
    </figure>
  );
}

function Outcome({
  label,
  value,
  current,
  tone,
  emphasis,
}: {
  label: string;
  value: string;
  current: Money;
  tone?: "gain" | "loss";
  emphasis?: boolean;
}) {
  const v = Money.of(value, "USD");
  const multiple = current.isZero() ? null : v.ratioTo(current);

  return (
    <div>
      <p className="truncate text-xs text-ink-faint">{label}</p>
      <p
        className={cn(
          "num mt-1 font-semibold",
          emphasis ? "text-2xl text-ink" : "text-xl",
          tone === "gain" && "text-gain",
          tone === "loss" && "text-loss",
          !tone && !emphasis && "text-ink",
        )}
      >
        {formatMoney(v, { compact: true })}
      </p>
      {multiple && (
        <p className="num mt-0.5 text-xs text-ink-faint">
          bugünün {multiple.toDecimalPlaces(2).toFixed().replace(".", ",")}× katı
        </p>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-ink-faint">{label}</dt>
      <dd className="num text-ink">{value}</dd>
    </div>
  );
}
