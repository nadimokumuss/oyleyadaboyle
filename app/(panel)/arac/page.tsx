import Decimal from "decimal.js";
import { PageShell, EmptyState } from "@/components/PageShell";
import { loadVehicles } from "@/lib/finance/assetService";
import { listCashAccounts } from "@/lib/services/funding";
import { DisposeButton } from "@/components/DisposeButton";
import Link from "next/link";
import { Money, formatMoney, formatPercent, formatNumber } from "@/lib/money";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

export default async function AracPage() {
  const vehicles = await loadVehicles();
  const cashAccounts = listCashAccounts();

  if (vehicles.length === 0) {
    return (
      <PageShell title="Araç" subtitle="Amortisman ve sahip olma maliyeti.">
        <EmptyState
          title="Kayıtlı araç yok"
          description="Demo senaryoyu yükleyerek örnek araçları görebilirsiniz."
          action={
            <code className="inline-block rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink-muted">
              npm run db:seed
            </code>
          }
        />
      </PageShell>
    );
  }

  const totalValue = vehicles.reduce(
    (a, v) => a.plus(Money.of(v.valueUsd, "USD")),
    Money.zero("USD"),
  );

  return (
    <PageShell
      title="Araç"
      subtitle="Değerler amortisman eğrisiyle modellenir — aracın asıl maliyeti değer kaybı artı taşıma giderleridir."
    >
      <div className="mb-4 rounded-lg border border-line bg-surface-raised p-4">
        <p className="text-xs text-ink-faint">Toplam araç değeri</p>
        <p className="num mt-1 text-xl font-semibold text-ink">{formatMoney(totalValue)}</p>
        <p className="mt-0.5 text-xs text-ink-faint">{vehicles.length} araç</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {vehicles.map((v) => {
          const dep = new Decimal(v.depreciation);
          const depRatio = v.depreciationRatio ? new Decimal(v.depreciationRatio) : null;
          const penalty = new Decimal(v.mileagePenalty);

          return (
            <article
              key={v.assetId}
              className={cn(
                "rounded-lg border bg-surface-raised p-5",
                v.basis === "model" ? "border-dashed border-ink-faint/50" : "border-line",
              )}
            >
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-ink">{v.name}</h3>
                  <p className="num mt-0.5 text-xs text-ink-faint">
                    {v.year} model · {v.segmentLabel} ·{" "}
                    {formatNumber(v.odometer, 0)} km
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded border px-1.5 py-0.5 text-[11px]",
                    v.basis === "model"
                      ? "border-dashed border-ink-faint text-ink-faint"
                      : "border-line text-ink-muted",
                  )}
                >
                  {v.basis === "model" ? "modellenmiş değer" : "elle girilen"}
                </span>
              </header>

              <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <p className="num text-2xl font-semibold text-ink">
                  {formatMoney(Money.of(v.currentValue, v.currency))}
                </p>
                <p className={cn("num text-sm", dep.isPositive() ? "text-loss" : "text-gain")}>
                  {formatMoney(Money.of(dep.negated(), v.currency), { compact: true, signed: true })}
                  {depRatio && (
                    <span className="ml-1.5">
                      ({formatPercent(depRatio.negated(), { signed: true, decimals: 1 })})
                    </span>
                  )}
                </p>
              </div>
              <p className="num mt-0.5 text-xs text-ink-faint">
                alış {formatMoney(Money.of(v.purchasePrice, v.currency), { compact: true })} ·{" "}
                {formatMoney(Money.of(v.valueUsd, "USD"), { compact: true })}
              </p>

              {/* Amortisman eğrisi */}
              <DepreciationChart
                curve={v.curve}
                currency={v.currency}
                currentYear={Number(v.vehicleAgeYears)}
              />

              {/* Gerçek maliyet */}
              <div className="mt-4 rounded-md border border-line bg-surface px-3 py-2.5">
                <p className="mb-1.5 text-xs font-medium text-ink">
                  Bu araç bana bugüne kadar kaça mal oldu?
                </p>
                <dl className="space-y-1 text-xs">
                  <CostRow
                    label="Değer kaybı"
                    value={formatMoney(Money.of(v.depreciation, v.currency), { compact: true })}
                  />
                  <CostRow
                    label="Taşıma gideri (sigorta, vergi, bakım, yakıt)"
                    value={formatMoney(Money.of(v.carryingCostToDate, v.currency), { compact: true })}
                  />
                  <div className="mt-1 border-t border-line pt-1">
                    <CostRow
                      label="Toplam"
                      value={formatMoney(Money.of(v.totalCostOfOwnership, v.currency), { compact: true })}
                      bold
                    />
                  </div>
                  {v.monthlyCostOfOwnership && (
                    <CostRow
                      label="Aylık ortalama"
                      value={formatMoney(Money.of(v.monthlyCostOfOwnership, v.currency), { compact: true })}
                    />
                  )}
                </dl>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <DisposeButton
                  kind="physical"
                  assetId={v.assetId}
                  name={v.name}
                  currency={v.currency}
                  cashAccounts={cashAccounts}
                  currentValue={v.currentValue}
                  cost={v.purchasePrice}
                />
                <Link
                  href={`/ekle/arac?id=${v.assetId}`}
                  className="rounded-md px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  Düzenle
                </Link>
              </div>

              {penalty.greaterThan(0) && (
                <p className="num mt-3 text-xs text-warn">
                  Yaşına göre fazla kilometre: değere{" "}
                  {formatPercent(penalty.negated(), { decimals: 1 })} etki
                </p>
              )}
            </article>
          );
        })}
      </div>

      <p className="mt-6 text-pretty text-xs text-ink-faint">
        Araç için ücretsiz canlı fiyat beslemesi bulunmadığından değerler segment
        bazlı üstel amortisman eğrisiyle modellenir. Gerçek bir ekspertiz veya
        piyasa değeri girerseniz model devre dışı kalır.
      </p>
    </PageShell>
  );
}

/** Amortisman eğrisi — tek seri, alan grafiği. Legend gerekmez, başlık seriyi adlandırır. */
function DepreciationChart({
  curve,
  currency,
  currentYear,
}: {
  curve: Array<{ year: number; value: string }>;
  currency: string;
  currentYear: number;
}) {
  if (curve.length < 2) return null;

  const W = 100;
  const H = 32;
  const maxV = Math.max(...curve.map((p) => Number(p.value)));
  const maxYear = curve[curve.length - 1].year;
  if (maxV <= 0 || maxYear <= 0) return null;

  const x = (year: number) => (year / maxYear) * W;
  const y = (value: number) => H - (value / maxV) * H;

  const line = curve.map((p) => `${x(p.year)},${y(Number(p.value))}`).join(" ");
  const area = `0,${H} ${line} ${W},${H}`;
  const markerX = x(Math.min(currentYear, maxYear));

  return (
    <figure className="mt-4">
      <figcaption className="mb-1.5 text-xs text-ink-faint">
        Amortisman eğrisi · {maxYear} yıl
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-16 w-full"
        role="img"
        aria-label={`Tahmini değer ${maxYear} yıl içinde ${formatMoney(
          Money.of(curve[0].value, currency),
          { compact: true },
        )} seviyesinden ${formatMoney(Money.of(curve[curve.length - 1].value, currency), {
          compact: true,
        })} seviyesine iniyor`}
      >
        <polygon points={area} className="fill-accent/15" />
        <polyline
          points={line}
          className="fill-none stroke-accent"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        {/* Bugün nerede olduğumuzu gösteren işaret */}
        <line
          x1={markerX}
          y1={0}
          x2={markerX}
          y2={H}
          className="stroke-ink-faint"
          strokeWidth={1}
          strokeDasharray="2 2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="num mt-1 flex justify-between text-[11px] text-ink-faint">
        <span>bugün</span>
        <span>
          {maxYear}. yıl:{" "}
          {formatMoney(Money.of(curve[curve.length - 1].value, currency), { compact: true })}
        </span>
      </div>
    </figure>
  );
}

function CostRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={cn("text-pretty text-ink-muted", bold && "font-medium text-ink")}>
        {label}
      </dt>
      <dd className={cn("num shrink-0 text-ink", bold && "font-medium")}>{value}</dd>
    </div>
  );
}
