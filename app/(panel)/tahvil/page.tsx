import Link from "next/link";
import Decimal from "decimal.js";
import { PageShell, Card, EmptyState } from "@/components/PageShell";
import { loadBonds } from "@/lib/finance/otherAssetService";
import { Money, formatMoney, formatPercent } from "@/lib/money";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

export default function TahvilPage() {
  const bonds = loadBonds();

  if (bonds.length === 0) {
    return (
      <PageShell title="Tahvil" subtitle="Devlet tahvili, bono ve özel sektör tahvilleri.">
        <EmptyState
          title="Henüz tahvil yok"
          description="Tahvil eklediğinizde işlemiş faiz, kupon takvimi ve vadeye kadar getiri burada hesaplanır."
          action={
            <Link
              href="/ekle/tahvil"
              className="inline-flex items-center rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-surface transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Tahvil ekle
            </Link>
          }
        />
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Tahvil"
      subtitle="İşlemiş faiz, kupon takvimi ve vadeye kadar getiri."
      actions={
        <Link
          href="/ekle/tahvil"
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-surface transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          + Tahvil ekle
        </Link>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {bonds.map((b) => {
          const pnl = new Decimal(b.unrealizedPnl);
          return (
            <article
              key={b.assetId}
              className="rounded-lg border border-line bg-surface-raised p-5"
            >
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-medium text-ink">{b.name}</h2>
                  <p className="num mt-0.5 text-xs text-ink-faint">
                    {b.issuer} ·{" "}
                    {formatMoney(Money.of(b.faceValue, b.currency), { compact: true })}{" "}
                    nominal · {formatPercent(new Decimal(b.couponRate))} kupon
                  </p>
                </div>
                <MaturityBadge b={b} />
              </header>

              <div className="mt-4">
                <p className="text-xs text-ink-faint">Güncel değer (kirli fiyat)</p>
                <p className="num mt-0.5 text-3xl font-semibold text-ink">
                  {formatMoney(Money.of(b.dirtyValue, b.currency))}
                </p>
                <p
                  className={cn(
                    "num mt-1 text-sm",
                    pnl.isNegative() ? "text-loss" : "text-gain",
                  )}
                >
                  {formatMoney(Money.of(b.unrealizedPnl, b.currency), { signed: true })}{" "}
                  alış fiyatına göre
                </p>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 text-xs sm:grid-cols-4">
                <Cell
                  label="Temiz fiyat"
                  value={formatMoney(Money.of(b.cleanValue, b.currency), { compact: true })}
                />
                <Cell
                  label="İşlemiş faiz"
                  value={formatMoney(Money.of(b.accruedInterest, b.currency), {
                    compact: true,
                  })}
                  tone="gain"
                />
                <Cell
                  label="Yaklaşık YTM"
                  value={b.ytm ? formatPercent(new Decimal(b.ytm), { decimals: 2 }) : "—"}
                />
                <Cell
                  label="Cari verim"
                  value={
                    b.currentYield
                      ? formatPercent(new Decimal(b.currentYield), { decimals: 2 })
                      : "—"
                  }
                />
              </dl>

              <p className="mt-3 text-pretty text-xs text-ink-faint">
                Değer kaynağı:{" "}
                {b.basis === "market"
                  ? "elle girilen piyasa temiz fiyatı"
                  : "itfa maliyeti (piyasa fiyatı girilmedi)"}
                . Kirli fiyat = temiz fiyat + işlemiş faiz; alıcı bunu öder çünkü
                son kupondan bu yana biriken pay satıcıya aittir.
              </p>

              {b.remainingCoupons.length > 0 && (
                <div className="mt-4 border-t border-line pt-3">
                  <p className="mb-2 text-xs text-ink-faint">
                    Kalan kupon ödemeleri ({b.remainingCoupons.length})
                  </p>
                  <ul className="space-y-1">
                    {b.remainingCoupons.slice(0, 6).map((c) => (
                      <li
                        key={c.date}
                        className="num flex items-baseline justify-between gap-3 text-xs"
                      >
                        <span className="text-ink-muted">{c.date}</span>
                        <span className="flex items-baseline gap-3">
                          <span className="text-ink-faint">
                            brüt {formatMoney(Money.of(c.gross, b.currency), { compact: true })}
                          </span>
                          <span className="w-20 text-right text-gain">
                            {formatMoney(Money.of(c.net, b.currency), { compact: true })}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  {b.remainingCoupons.length > 6 && (
                    <p className="mt-1.5 text-xs text-ink-faint">
                      …ve {b.remainingCoupons.length - 6} ödeme daha
                    </p>
                  )}
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`/ekle/tahvil?id=${b.assetId}`}
                  className="rounded-md border border-line px-2.5 py-1.5 text-xs text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  Düzenle
                </Link>
              </div>
            </article>
          );
        })}
      </div>

      <p className="mt-6 text-pretty text-xs text-ink-faint">
        Vadeye kadar getiri (YTM) yaklaşık formülle hesaplanır ve kuponların
        aynı oranda yeniden yatırıldığını varsayar. Tahviller için canlı fiyat
        beslemesi yoktur — piyasa fiyatını elle girmezseniz değer itfa maliyeti
        üzerinden hesaplanır.
      </p>
    </PageShell>
  );
}

function MaturityBadge({
  b,
}: {
  b: { matured: boolean; daysToMaturity: number | null; maturityDate: string };
}) {
  if (b.matured) {
    return (
      <span className="shrink-0 rounded border border-warn/50 px-1.5 py-0.5 text-[11px] text-warn">
        vade doldu
      </span>
    );
  }
  const days = b.daysToMaturity ?? 0;
  return (
    <span
      className={cn(
        "num shrink-0 rounded border px-1.5 py-0.5 text-[11px]",
        days <= 30 ? "border-warn/50 text-warn" : "border-line text-ink-muted",
      )}
    >
      vadeye {days} gün
    </span>
  );
}

function Cell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "gain";
}) {
  return (
    <div>
      <dt className="truncate text-ink-faint">{label}</dt>
      <dd className={cn("num mt-0.5 font-medium", tone === "gain" ? "text-gain" : "text-ink")}>
        {value}
      </dd>
    </div>
  );
}
