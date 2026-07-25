import Link from "next/link";
import Decimal from "decimal.js";
import { PageShell, EmptyState, Card } from "@/components/PageShell";
import { loadPlan } from "@/lib/services/plan";
import { Money, formatMoney, formatPercent } from "@/lib/money";
import { cn } from "@/lib/cn";
import { PurchaseButton } from "@/components/PurchaseButton";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  equity: "Hisse", crypto: "Kripto", commodity: "Emtia", deposit: "Mevduat",
  realestate: "Gayrimenkul", vehicle: "Araç", venture: "Girişim", cash: "Nakit",
};

export default async function PlanPage() {
  const plan = await loadPlan();

  if (plan.items.length === 0) {
    return (
      <PageShell
        title="Plan"
        subtitle="Almayı düşündüğünüz varlıklar burada toplanır."
      >
        <EmptyState
          title="Planlanan varlık yok"
          description="Bir varlık eklerken 'henüz almadım, almayı planlıyorum' kutusunu işaretlerseniz burada görünür. Net servetinize dahil edilmez; nakdinizin yetip yetmediği hesaplanır."
          action={
            <Link
              href="/ekle"
              className="inline-flex items-center rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-surface transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Varlık ekle
            </Link>
          }
        />
      </PageShell>
    );
  }

  const total = Money.of(plan.totalCostUsd, "USD");
  const available = Money.of(plan.availableCashUsd, "USD");
  const shortfall = Money.of(plan.shortfallUsd, "USD");
  const remaining = Money.of(plan.remainingCashUsd, "USD");
  const netDelta = Money.of(plan.monthlyNetDeltaUsd, "USD");

  return (
    <PageShell
      title="Plan"
      subtitle="Bu alımlar gerçekleşirse ne olur — ve nakdiniz yetiyor mu?"
      actions={
        <Link
          href="/ekle"
          className="rounded-md border border-line bg-surface-raised px-3 py-1.5 text-xs text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          + Plana ekle
        </Link>
      }
    >
      {/* Nakit yeterlilik — en kritik bilgi en üstte */}
      <section
        className={cn(
          "mb-4 rounded-lg border p-5",
          plan.affordable
            ? "border-gain/50 bg-gain/10"
            : "border-loss/50 bg-loss/10",
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium text-ink-muted">
              Planlanan toplam alım
            </h2>
            <p className="num mt-1 text-3xl font-semibold text-ink">
              {formatMoney(total)}
            </p>
            <p className="num mt-1 text-sm text-ink-muted">
              {plan.items.length} kalem · likit varlığınız {formatMoney(available)}
            </p>
          </div>

          <div className="text-right">
            {plan.affordable ? (
              <>
                <p className="text-sm font-medium text-gain">Nakdiniz yetiyor</p>
                <p className="num mt-1 text-sm text-ink-muted">
                  Alım sonrası kalan: {formatMoney(remaining)}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-loss">Nakit yetmiyor</p>
                <p className="num mt-1 text-sm text-loss">
                  {formatMoney(shortfall)} açık
                </p>
              </>
            )}
          </div>
        </div>

        {/* Kullanılan nakit oranı */}
        <div className="mt-4">
          <div className="h-2 overflow-hidden rounded-full bg-surface">
            <div
              className={cn(
                "h-full rounded-full",
                plan.affordable ? "bg-gain" : "bg-loss",
              )}
              style={{
                width: `${Math.min(
                  100,
                  available.isZero()
                    ? 100
                    : total.ratioTo(available).toNumber() * 100,
                )}%`,
              }}
            />
          </div>
          <p className="num mt-1.5 text-xs text-ink-faint">
            Likit varlığınızın{" "}
            {available.isZero()
              ? "tamamından fazlası"
              : formatPercent(total.ratioTo(available), { decimals: 0 })}{" "}
            kullanılacak
          </p>
        </div>

        {!plan.affordable && (
          <p className="mt-3 text-pretty text-sm text-ink-muted">
            Bu planı gerçekleştirmek için ya {formatMoney(shortfall)} daha nakde
            ihtiyacınız var, ya da kalemlerden bazılarını çıkarmanız gerekiyor.
            Likit olmayan varlıklarınızı (gayrimenkul, girişim) satmak da bir
            seçenek ama zaman alır.
          </p>
        )}
      </section>

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat
          label="Servete etkisi"
          value="değişmez"
          sub={`${formatMoney(Money.of(plan.currentNetWorthUsd, "USD"), { compact: true })} olarak kalır`}
        />
        <Stat
          label="Aylık gelir artışı"
          value={formatMoney(Money.of(plan.monthlyIncomeDeltaUsd, "USD"))}
          sub="kira, girişim kârı"
          tone={Number(plan.monthlyIncomeDeltaUsd) > 0 ? "gain" : undefined}
        />
        <Stat
          label="Aylık gider artışı"
          value={formatMoney(Money.of(plan.monthlyCostDeltaUsd, "USD"))}
          sub="aidat, sigorta, yakım"
          tone={Number(plan.monthlyCostDeltaUsd) > 0 ? "loss" : undefined}
        />
      </div>

      <p className="mb-4 text-pretty text-sm text-ink-muted">
        Net servetiniz değişmez çünkü nakit varlığa dönüşür — 10 milyon dolarla
        ev alırsanız hâlâ 10 milyon dolarınız vardır, ama artık nakit değildir.
        Değişen şey <strong className="text-ink">likidite</strong> ve{" "}
        <strong className="text-ink">aylık nakit akışı</strong>:{" "}
        <span
          className={cn(
            "num",
            netDelta.isPositive() ? "text-gain" : netDelta.isNegative() ? "text-loss" : "",
          )}
        >
          {formatMoney(netDelta, { signed: true })}/ay
        </span>
        .
      </p>

      {/* Kalemler */}
      <div className="mb-4 space-y-3">
        {plan.items.map((item) => (
          <article
            key={item.assetId}
            className="rounded-lg border border-dashed border-ink-faint/50 bg-surface-raised p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-sm font-medium text-ink">{item.name}</h3>
                  <span className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-faint">
                    {KIND_LABEL[item.kind] ?? item.kind}
                  </span>
                </div>
                {item.detail && (
                  <p className="num mt-0.5 truncate text-xs text-ink-faint">
                    {item.detail}
                  </p>
                )}
                {(Number(item.monthlyIncomeUsd) > 0 ||
                  Number(item.monthlyCostUsd) > 0) && (
                  <p className="num mt-1 text-xs">
                    {Number(item.monthlyIncomeUsd) > 0 && (
                      <span className="text-gain">
                        +{formatMoney(Money.of(item.monthlyIncomeUsd, "USD"), { compact: true })}/ay gelir
                      </span>
                    )}
                    {Number(item.monthlyIncomeUsd) > 0 &&
                      Number(item.monthlyCostUsd) > 0 && (
                        <span className="text-ink-faint"> · </span>
                      )}
                    {Number(item.monthlyCostUsd) > 0 && (
                      <span className="text-loss">
                        −{formatMoney(Money.of(item.monthlyCostUsd, "USD"), { compact: true })}/ay gider
                      </span>
                    )}
                  </p>
                )}
              </div>

              <div className="shrink-0 text-right">
                <p className="num text-sm font-medium text-ink">
                  {formatMoney(Money.of(item.costUsd, "USD"))}
                </p>
                {item.currency !== "USD" && (
                  <p className="num text-xs text-ink-faint">
                    {formatMoney(Money.of(item.costLocal, item.currency), { compact: true })}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <PurchaseButton
                assetId={item.assetId}
                name={item.name}
                costUsd={item.costUsd}
                cashAccounts={plan.cashAccounts}
              />
              <Link
                href={item.editHref}
                className="rounded-md px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Düzenle
              </Link>
            </div>
          </article>
        ))}
      </div>

      {/* Alım sonrası dağılım */}
      <Card title="Alım sonrası dağılım" hint="hepsi gerçekleşirse">
        <AllocationCompare
          current={plan.currentByKind}
          projected={plan.projectedByKind}
        />
      </Card>
    </PageShell>
  );
}

function AllocationCompare({
  current,
  projected,
}: {
  current: Record<string, string>;
  projected: Record<string, string>;
}) {
  const keys = [...new Set([...Object.keys(current), ...Object.keys(projected)])];

  const currentTotal = Object.values(current).reduce(
    (a, v) => a.plus(v),
    new Decimal(0),
  );
  const projectedTotal = Object.values(projected).reduce(
    (a, v) => a.plus(Decimal.max(0, new Decimal(v))),
    new Decimal(0),
  );

  const rows = keys
    .map((k) => {
      const now = new Decimal(current[k] ?? 0);
      const then = new Decimal(projected[k] ?? 0);
      return {
        key: k,
        nowPct: currentTotal.isZero() ? new Decimal(0) : now.dividedBy(currentTotal),
        thenPct: projectedTotal.isZero()
          ? new Decimal(0)
          : Decimal.max(0, then).dividedBy(projectedTotal),
      };
    })
    .filter((r) => r.nowPct.greaterThan(0) || r.thenPct.greaterThan(0))
    .sort((a, b) => b.thenPct.comparedTo(a.thenPct));

  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const delta = r.thenPct.minus(r.nowPct);
        return (
          <li key={r.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-ink-muted">{KIND_LABEL[r.key] ?? r.key}</span>
              <span className="num flex items-baseline gap-2">
                <span className="text-ink-faint">
                  {formatPercent(r.nowPct, { decimals: 0 })}
                </span>
                <span className="text-ink-faint">→</span>
                <span className="text-ink">{formatPercent(r.thenPct, { decimals: 0 })}</span>
                <span
                  className={cn(
                    "w-14 text-right text-xs",
                    delta.isPositive() && "text-gain",
                    delta.isNegative() && "text-loss",
                    delta.isZero() && "text-ink-faint",
                  )}
                >
                  {delta.isZero() ? "—" : formatPercent(delta, { signed: true, decimals: 0 })}
                </span>
              </span>
            </div>
            <div className="mt-1 flex gap-0.5">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface">
                <div
                  className="h-full rounded-full bg-ink-faint"
                  style={{ width: `${Math.min(100, r.nowPct.toNumber() * 100)}%` }}
                />
              </div>
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.min(100, r.thenPct.toNumber() * 100)}%` }}
                />
              </div>
            </div>
          </li>
        );
      })}
      <li className="flex gap-4 pt-1 text-xs text-ink-faint">
        <span className="flex items-center gap-1.5">
          <span className="h-1 w-4 rounded-full bg-ink-faint" /> şimdi
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1 w-4 rounded-full bg-accent" /> alım sonrası
        </span>
      </li>
    </ul>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "gain" | "loss";
}) {
  return (
    <div className="rounded-lg border border-line bg-surface-raised p-4">
      <p className="truncate text-xs text-ink-faint">{label}</p>
      <p
        className={cn(
          "num mt-1 text-xl font-semibold",
          tone === "gain" && "text-gain",
          tone === "loss" && "text-loss",
          !tone && "text-ink",
        )}
      >
        {value}
      </p>
      {sub && <p className="num mt-0.5 truncate text-xs text-ink-faint">{sub}</p>}
    </div>
  );
}
