import Decimal from "decimal.js";
import { PageShell, EmptyState, Card } from "@/components/PageShell";
import { loadProperties } from "@/lib/finance/assetService";
import { listCashAccounts } from "@/lib/services/funding";
import { liabilitiesForAsset } from "@/lib/services/liabilities";
import { DisposeButton } from "@/components/DisposeButton";
import Link from "next/link";
import { Money, formatMoney, formatPercent } from "@/lib/money";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

export default async function GayrimenkulPage() {
  const properties = await loadProperties();
  const cashAccounts = listCashAccounts();

  if (properties.length === 0) {
    return (
      <PageShell title="Gayrimenkul" subtitle="Çoklu ülke konut portföyü.">
        <EmptyState
          title="Kayıtlı gayrimenkul yok"
          description="Demo senaryoyu yükleyerek örnek portföyü görebilirsiniz."
          action={
            <code className="inline-block rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink-muted">
              npm run db:seed
            </code>
          }
        />
      </PageShell>
    );
  }

  const totalValue = properties.reduce(
    (a, p) => a.plus(Money.of(p.valueUsd, "USD")),
    Money.zero("USD"),
  );
  const totalCost = properties.reduce(
    (a, p) => a.plus(Money.of(p.costUsd, "USD")),
    Money.zero("USD"),
  );

  const byCountry = new Map<string, Decimal>();
  for (const p of properties) {
    byCountry.set(
      p.country,
      (byCountry.get(p.country) ?? new Decimal(0)).plus(p.valueUsd),
    );
  }

  return (
    <PageShell
      title="Gayrimenkul"
      subtitle="Değerler bölgesel konut endeksiyle modellenir — canlı piyasa fiyatı değildir."
    >
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Toplam değer" value={formatMoney(totalValue)} sub={`${properties.length} mülk`} />
        <Stat label="Toplam maliyet" value={formatMoney(totalCost)} sub="tapu ve tadilat dahil" />
        <Stat
          label="Değer artışı"
          value={formatMoney(totalValue.minus(totalCost), { signed: true })}
          tone={totalValue.gt(totalCost) ? "gain" : "loss"}
        />
      </div>

      <Card title="Ülke maruziyeti" className="mb-4">
        <ul className="space-y-2">
          {[...byCountry.entries()]
            .sort((a, b) => b[1].comparedTo(a[1]))
            .map(([country, value]) => {
              const share = totalValue.isZero()
                ? new Decimal(0)
                : value.dividedBy(totalValue.amount);
              return (
                <li key={country}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-ink-muted">{COUNTRY[country] ?? country}</span>
                    <span className="num text-ink">
                      {formatMoney(Money.of(value, "USD"), { compact: true })}
                      <span className="ml-2 text-ink-faint">
                        {formatPercent(share, { decimals: 1 })}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${Math.min(100, share.toNumber() * 100)}%` }}
                    />
                  </div>
                </li>
              );
            })}
        </ul>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {properties.map((p) => {
          const gain = new Decimal(p.capitalGain);
          const netYield = p.netYield ? new Decimal(p.netYield) : null;
          const attr = p.attribution;

          return (
            <article
              key={p.assetId}
              className={cn(
                "rounded-lg border bg-surface-raised p-5",
                // Modellenmiş değer kesikli çerçeveyle ayrılır
                p.basis === "model" ? "border-dashed border-ink-faint/50" : "border-line",
              )}
            >
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-ink">{p.name}</h3>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    {p.city}, {COUNTRY[p.country] ?? p.country} ·{" "}
                    {new Date(p.purchaseDate).toLocaleDateString("tr-TR")} alım
                  </p>
                </div>
                <BasisBadge basis={p.basis} label={p.indexLabel} />
              </header>

              <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <p className="num text-2xl font-semibold text-ink">
                  {formatMoney(Money.of(p.currentValue, p.currency))}
                </p>
                <p
                  className={cn(
                    "num text-sm",
                    gain.isPositive() ? "text-gain" : gain.isNegative() ? "text-loss" : "text-ink-faint",
                  )}
                >
                  {formatMoney(Money.of(gain, p.currency), { compact: true, signed: true })}
                  {p.capitalGainRatio && (
                    <span className="ml-1.5">
                      ({formatPercent(new Decimal(p.capitalGainRatio), { signed: true, decimals: 1 })})
                    </span>
                  )}
                </p>
              </div>
              <p className="num mt-0.5 text-xs text-ink-faint">
                {formatMoney(Money.of(p.valueUsd, "USD"), { compact: true })} · maliyet{" "}
                {formatMoney(Money.of(p.totalCost, p.currency), { compact: true })}
              </p>

              {/* Kur kârı vs fiyat kârı ayrıştırması */}
              {attr ? (
                <div className="mt-4 rounded-md border border-line bg-surface px-3 py-2.5">
                  <p className="mb-1.5 text-xs font-medium text-ink">
                    Getiri nereden geldi?
                  </p>
                  <dl className="space-y-1 text-xs">
                    <AttrRow label="Fiyat artışı (yerel)" value={attr.priceReturn} />
                    <AttrRow label="Kur etkisi" value={attr.fxReturn} />
                    <AttrRow label="Çapraz terim" value={attr.crossTerm} />
                    <div className="mt-1 border-t border-line pt-1">
                      <AttrRow label="USD bazında toplam" value={attr.totalReturn} bold />
                    </div>
                  </dl>
                </div>
              ) : (
                p.currency !== "USD" && (
                  <p className="mt-3 text-pretty text-xs text-ink-faint">
                    Kur etkisi ayrıştırması için alış tarihindeki kur kaydı gerekiyor.
                    Panel her gün kur biriktirdikçe bu bölüm otomatik dolacak.
                  </p>
                )
              )}

              {/* Kira */}
              <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-3 text-xs">
                <Cell
                  label="Aylık kira"
                  value={formatMoney(Money.of(p.monthlyRent, p.currency), { compact: true })}
                />
                <Cell
                  label="Yıllık net kira"
                  value={formatMoney(Money.of(p.annualNetRent, p.currency), { compact: true })}
                  tone={new Decimal(p.annualNetRent).isNegative() ? "loss" : undefined}
                />
                <Cell
                  label="Net verim"
                  value={netYield ? formatPercent(netYield, { decimals: 2 }) : "—"}
                  tone={netYield?.isNegative() ? "loss" : "gain"}
                />
              </dl>

              {p.foregoneMonthlyRent && (
                <p className="num mt-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-pretty text-xs text-warn">
                  Bu mülk kiraya verilmemiş. Tahmini kaçırılan gelir: ayda{" "}
                  {formatMoney(Money.of(p.foregoneMonthlyRent, p.currency), { compact: true })}
                </p>
              )}

              {p.indexSource && (
                <p className="mt-3 text-xs text-ink-faint">Endeks kaynağı: {p.indexSource}</p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <DisposeButton
                  kind="physical"
                  assetId={p.assetId}
                  name={p.name}
                  currency={p.currency}
                  cashAccounts={cashAccounts}
                  currentValue={p.currentValue}
                  cost={p.totalCost}
                  outstandingLoan={loanFor(p.assetId)}
                />
                <Link
                  href={`/ekle/gayrimenkul?id=${p.assetId}`}
                  className="rounded-md px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  Düzenle
                </Link>
              </div>
            </article>
          );
        })}
      </div>

      <p className="mt-6 text-pretty text-xs text-ink-faint">
        Konut için ücretsiz canlı fiyat beslemesi bulunmadığından değerler bölgesel
        endeksle modellenir; kesikli çerçeve bunu belirtir. Gerçek bir ekspertiz
        girdiğinizde o değer çapa alınır ve sonrası oradan endekslenir.
      </p>
    </PageShell>
  );
}

/** Varlığa bağlı kalan kredi borcu — satış önizlemesi için. */
function loanFor(assetId: string): string | undefined {
  const rows = liabilitiesForAsset(assetId);
  if (rows.length === 0) return undefined;
  return rows.reduce((a, r) => a + Number(r.principal), 0).toString();
}

const COUNTRY: Record<string, string> = {
  TR: "Türkiye",
  PT: "Portekiz",
  AE: "BAE",
  US: "ABD",
  DE: "Almanya",
  GB: "Birleşik Krallık",
};

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
      {sub && <p className="mt-0.5 truncate text-xs text-ink-faint">{sub}</p>}
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
      <dt className="truncate text-ink-faint">{label}</dt>
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

function AttrRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  const v = new Decimal(value);
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={cn("text-ink-muted", bold && "font-medium text-ink")}>{label}</dt>
      <dd
        className={cn(
          "num",
          v.isPositive() && "text-gain",
          v.isNegative() && "text-loss",
          v.isZero() && "text-ink-faint",
          bold && "font-medium",
        )}
      >
        {formatPercent(v, { signed: true, decimals: 2 })}
      </dd>
    </div>
  );
}

function BasisBadge({ basis, label }: { basis: string; label: string | null }) {
  if (basis === "manual") {
    return (
      <span className="rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-muted">
        ekspertiz
      </span>
    );
  }
  if (basis === "model") {
    return (
      <span
        className="rounded border border-dashed border-ink-faint px-1.5 py-0.5 text-[11px] text-ink-faint"
        title={label ?? undefined}
      >
        modellenmiş değer
      </span>
    );
  }
  return (
    <span className="rounded border border-warn/50 px-1.5 py-0.5 text-[11px] text-warn">
      endeks yok
    </span>
  );
}
