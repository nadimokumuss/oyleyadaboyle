import Link from "next/link";
import Decimal from "decimal.js";
import { PageShell, EmptyState, Card } from "@/components/PageShell";
import { loadLiabilities, scheduleFor } from "@/lib/services/liabilities";
import { computeNetWorth } from "@/lib/valuation";
import { Money, formatMoney, formatPercent, formatNumber } from "@/lib/money";
import { cn } from "@/lib/cn";
import { SettleLoanButton } from "@/components/SettleLoanButton";
import { AutopayForm } from "@/components/forms/AutopayForm";
import { db } from "@/db/client";
import { assets } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function BorclarPage() {
  const loans = await loadLiabilities();
  const nw = await computeNetWorth();

  const cashAccounts = db
    .select({ id: assets.id, name: assets.name, currency: assets.currency })
    .from(assets)
    .where(eq(assets.kind, "cash"))
    .all();

  if (loans.length === 0) {
    return (
      <PageShell title="Borçlar" subtitle="Kredi ve ipotekleriniz.">
        <EmptyState
          title="Borcunuz yok"
          description="Bir varlık eklerken 'kredi ile al' seçeneğini kullanırsanız borç kaydı burada oluşur. Net servetiniz varlıklardan borçlar düşülerek hesaplanır."
          action={
            <Link
              href="/ekle"
              className="inline-flex items-center rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Varlık ekle
            </Link>
          }
        />
      </PageShell>
    );
  }

  const totalRemaining = loans.reduce(
    (a, l) => a.plus(Money.of(l.remainingUsd, "USD")),
    Money.zero("USD"),
  );
  const totalMonthly = loans.reduce(
    (a, l) => a.plus(Money.of(l.monthlyPaymentUsd, "USD")),
    Money.zero("USD"),
  );

  // Kaldıraç: borç / varlık. Yükseldikçe bir düşüşte kırılganlık artar.
  const leverage = nw.grossAssetsUsd.isZero()
    ? new Decimal(0)
    : nw.liabilitiesUsd.ratioTo(nw.grossAssetsUsd);

  return (
    <PageShell
      title="Borçlar"
      subtitle="Net servetiniz varlıklardan bu borçlar düşülerek hesaplanır."
    >
      <div className="mb-4 grid gap-4 sm:grid-cols-4">
        <Stat label="Toplam kalan borç" value={formatMoney(totalRemaining)} tone="loss" />
        <Stat label="Aylık taksit yükü" value={formatMoney(totalMonthly)} tone="loss" sub="nakit akışından çıkar" />
        <Stat
          label="Kaldıraç oranı"
          value={formatPercent(leverage, { decimals: 1 })}
          sub="borç / varlık"
          tone={leverage.greaterThan("0.5") ? "loss" : undefined}
        />
        <Stat
          label="Net servet"
          value={formatMoney(nw.totalUsd)}
          sub={`${formatMoney(nw.grossAssetsUsd, { compact: true })} varlık`}
        />
      </div>

      {leverage.greaterThan("0.5") && (
        <p className="mb-4 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-pretty text-sm text-ink-muted">
          <strong className="text-warn">Kaldıraç yüksek.</strong> Varlıklarınızın{" "}
          {formatPercent(leverage, { decimals: 0 })} kadarı borçla finanse
          edilmiş. Varlık değerlerinde %20&apos;lik bir düşüş net servetinizi{" "}
          {formatPercent(leverage.times("0.2").plus("0.2"), { decimals: 0 })}{" "}
          azaltır — kaldıraç kayıpları da büyütür.
        </p>
      )}

      <div className="space-y-4">
        {loans.map((l) => {
          const progress =
            l.termMonths > 0 ? new Decimal(l.paymentsMade).dividedBy(l.termMonths) : new Decimal(0);
          const schedule = scheduleFor(l.id) ?? [];

          return (
            <article key={l.id} className="rounded-lg border border-line bg-surface-raised p-5">
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-medium text-ink">{l.name}</h2>
                  <p className="num mt-0.5 text-xs text-ink-faint">
                    {l.lender && `${l.lender} · `}
                    {formatPercent(new Decimal(l.annualRate), { decimals: 2 })} ·{" "}
                    {l.termMonths} ay
                    {l.assetName && ` · ${l.assetName}`}
                  </p>
                </div>
                <span className="num rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-muted">
                  {l.paymentsMade}/{l.termMonths} taksit
                </span>
              </header>

              <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <p className="num text-2xl font-semibold text-loss">
                  {formatMoney(Money.of(l.remaining, l.currency))}
                </p>
                <p className="num text-sm text-ink-muted">
                  kalan · aylık {formatMoney(Money.of(l.monthlyPayment, l.currency))}
                </p>
              </div>

              {/* Ödeme ilerlemesi */}
              <div className="mt-3">
                <div className="h-2 overflow-hidden rounded-full bg-surface">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${Math.min(100, progress.toNumber() * 100)}%` }}
                  />
                </div>
                <p className="num mt-1.5 text-xs text-ink-faint">
                  {formatPercent(progress, { decimals: 0 })} ödendi ·{" "}
                  {l.paymentsRemaining} taksit kaldı ·{" "}
                  {new Date(l.endsAt).toLocaleDateString("tr-TR", {
                    month: "long",
                    year: "numeric",
                  })}{" "}
                  biter
                </p>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 text-xs sm:grid-cols-4">
                <Cell label="Çekilen anapara" value={formatMoney(Money.of(l.principal, l.currency), { compact: true })} />
                <Cell label="Ödenen anapara" value={formatMoney(Money.of(l.principalPaid, l.currency), { compact: true })} tone="gain" />
                <Cell label="Ödenen faiz" value={formatMoney(Money.of(l.interestPaid, l.currency), { compact: true })} tone="loss" />
                <Cell
                  label="Toplam faiz maliyeti"
                  value={formatMoney(Money.of(l.totalInterest, l.currency), { compact: true })}
                  tone="loss"
                />
              </dl>

              <p className="num mt-2 text-pretty text-xs text-ink-muted">
                Bu kredinin gerçek fiyatı{" "}
                <span className="text-loss">
                  {formatMoney(Money.of(l.totalInterest, l.currency), { compact: true })}
                </span>{" "}
                — anaparanın{" "}
                {formatPercent(
                  new Decimal(l.totalInterest).dividedBy(l.principal),
                  { decimals: 0 },
                )}{" "}
                kadarı faize gidiyor.
              </p>

              {schedule.length > 0 && (
                <BalanceChart schedule={schedule} paymentsMade={l.paymentsMade} currency={l.currency} />
              )}

              {/* Erken kapatma */}
              <div className="mt-4 rounded-md border border-line bg-surface px-3 py-2.5">
                <p className="text-xs font-medium text-ink">Erken kapatma</p>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
                  <Cell
                    label="Kalan anapara"
                    value={formatMoney(Money.of(l.earlySettlement.balance, l.currency), { compact: true })}
                  />
                  <Cell
                    label="Komisyon (%2)"
                    value={formatMoney(Money.of(l.earlySettlement.penalty, l.currency), { compact: true })}
                    tone="loss"
                  />
                  <Cell
                    label="Kurtulacağınız faiz"
                    value={formatMoney(Money.of(l.earlySettlement.interestSaved, l.currency), { compact: true })}
                    tone="gain"
                  />
                </dl>
                <p className="num mt-2 text-pretty text-xs text-ink-muted">
                  Bugün{" "}
                  <strong className="text-ink">
                    {formatMoney(Money.of(l.earlySettlement.total, l.currency))}
                  </strong>{" "}
                  ödeyerek kapatırsanız{" "}
                  <span className="text-gain">
                    {formatMoney(Money.of(l.earlySettlement.interestSaved, l.currency), { compact: true })}
                  </span>{" "}
                  faizden kurtulursunuz.
                </p>
                <div className="mt-3">
                  <SettleLoanButton id={l.id} name={l.name} />
                </div>

                <div className="mt-3 border-t border-line pt-3">
                  <AutopayForm
                    loanId={l.id}
                    autoPay={l.autoPay}
                    paymentAssetId={l.paymentAssetId}
                    accounts={cashAccounts}
                  />
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <p className="mt-6 text-pretty text-xs text-ink-faint">
        Ödenen taksit sayısı başlangıç tarihinden bugüne göre otomatik
        hesaplanır. Erken kapatma komisyonu Türkiye&apos;de konut kredilerinde
        kalan anaparanın %2&apos;sini geçemez; panel bu oranı varsayar.
      </p>
    </PageShell>
  );
}

/** Kalan borç eğrisi — bugünün nerede olduğunu gösterir. */
function BalanceChart({
  schedule,
  paymentsMade,
  currency,
}: {
  schedule: Array<{ month: number; balance: string }>;
  paymentsMade: number;
  currency: string;
}) {
  const W = 100;
  const H = 24;
  const max = Number(schedule[0]?.balance ?? 0);
  if (max <= 0) return null;

  const x = (m: number) => (m / schedule.length) * W;
  const y = (v: number) => H - (v / max) * H;

  const line = schedule.map((r) => `${x(r.month)},${y(Number(r.balance))}`).join(" ");

  return (
    <figure className="mt-4">
      <figcaption className="mb-1.5 text-xs text-ink-faint">Kalan borç seyri</figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-16 w-full"
        role="img"
        aria-label={`Borç ${formatMoney(Money.of(String(max), currency), { compact: true })} seviyesinden ${schedule.length} ayda sıfıra iniyor`}
      >
        <polygon points={`0,${H} ${line} ${W},${H}`} className="fill-loss/12" />
        <polyline
          points={line}
          className="fill-none stroke-loss"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={x(paymentsMade)}
          y1={0}
          x2={x(paymentsMade)}
          y2={H}
          className="stroke-ink-faint"
          strokeWidth={1}
          strokeDasharray="2 2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="num mt-1 flex justify-between text-[11px] text-ink-faint">
        <span>bugün</span>
        <span>{formatNumber(schedule.length / 12, 1)} yıl sonra biter</span>
      </div>
    </figure>
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

function Cell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "gain" | "loss";
}) {
  return (
    <div>
      <dt className="truncate text-xs text-ink-faint">{label}</dt>
      <dd
        className={cn(
          "num mt-0.5 font-medium",
          tone === "gain" && "text-gain",
          tone === "loss" && "text-loss",
          !tone && "text-ink",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

