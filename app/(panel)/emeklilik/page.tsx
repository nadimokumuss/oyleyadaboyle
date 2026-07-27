import Link from "next/link";
import Decimal from "decimal.js";
import { PageShell, EmptyState } from "@/components/PageShell";
import { loadPensions } from "@/lib/finance/otherAssetService";
import { Money, formatMoney, formatPercent } from "@/lib/money";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

export default function EmeklilikPage() {
  const rows = loadPensions();

  if (rows.length === 0) {
    return (
      <PageShell title="Emeklilik" subtitle="BES ve benzeri emeklilik hesapları.">
        <EmptyState
          title="Henüz emeklilik hesabı yok"
          description="Hesap eklediğinizde devlet katkısının ne kadarını hak ettiğiniz ve net servetinize ne yazıldığı burada görünür."
          action={
            <Link
              href="/ekle/emeklilik"
              className="inline-flex items-center rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-surface transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Emeklilik hesabı ekle
            </Link>
          }
        />
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Emeklilik"
      subtitle="Devlet katkısının hak edilen kısmı ve sisteme kalan süre."
      actions={
        <Link
          href="/ekle/emeklilik"
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-surface transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          + Hesap ekle
        </Link>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map((p) => {
          const ratio = new Decimal(p.vestedRatio);
          const pct = Math.min(100, Math.max(0, ratio.times(100).toNumber()));

          return (
            <article
              key={p.assetId}
              className="rounded-lg border border-line bg-surface-raised p-5"
            >
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-medium text-ink">{p.name}</h2>
                  <p className="num mt-0.5 text-xs text-ink-faint">
                    {p.provider} · sistemde {p.yearsInSystem} yıl
                  </p>
                </div>
                {p.retired ? (
                  <span className="shrink-0 rounded border border-gain/50 px-1.5 py-0.5 text-[11px] text-gain">
                    emeklilik hakkı
                  </span>
                ) : (
                  <span className="num shrink-0 rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-muted">
                    %{ratio.times(100).toDecimalPlaces(0).toFixed()} hak edildi
                  </span>
                )}
              </header>

              <div className="mt-4">
                <p className="text-xs text-ink-faint">Net servete yazılan</p>
                <p className="num mt-0.5 text-3xl font-semibold text-ink">
                  {formatMoney(Money.of(p.vestedValue, p.currency))}
                </p>
              </div>

              <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-3 text-xs">
                <div>
                  <dt className="truncate text-ink-faint">Kendi birikiminiz</dt>
                  <dd className="num mt-0.5 font-medium text-ink">
                    {formatMoney(Money.of(p.participantBalance, p.currency), {
                      compact: true,
                    })}
                  </dd>
                </div>
                <div>
                  <dt className="truncate text-ink-faint">Hak edilen katkı</dt>
                  <dd className="num mt-0.5 font-medium text-gain">
                    {formatMoney(Money.of(p.vestedState, p.currency), { compact: true })}
                  </dd>
                </div>
                <div>
                  <dt className="truncate text-ink-faint">Hak edilmemiş</dt>
                  <dd className="num mt-0.5 font-medium text-warn">
                    {formatMoney(Money.of(p.unvestedState, p.currency), { compact: true })}
                  </dd>
                </div>
              </dl>

              {/* Hak ediş ilerlemesi */}
              <div className="mt-4">
                <div
                  className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover"
                  role="progressbar"
                  aria-valuenow={Math.round(pct)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${p.name} hak ediş oranı`}
                >
                  <div
                    className={cn("h-full rounded-full", p.retired ? "bg-gain" : "bg-accent")}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {p.nextTier && (
                  <p className="num mt-1.5 text-xs text-ink-faint">
                    {p.nextTier.yearsRemaining} yıl sonra katkının %
                    {new Decimal(p.nextTier.pct).times(100).toDecimalPlaces(0).toFixed()}
                    &apos;i hak edilecek
                  </p>
                )}
              </div>

              {!new Decimal(p.unvestedState).isZero() && (
                <div className="mt-4 rounded-md border border-warn/40 bg-warn/10 px-3 py-2.5">
                  <p className="num text-pretty text-xs text-ink-muted">
                    Şu an çıkarsanız{" "}
                    <span className="text-loss">
                      {formatMoney(Money.of(p.unvestedState, p.currency), { compact: true })}
                    </span>{" "}
                    devlet katkısını alamazsınız. Bu tutar net servetinize dahil
                    edilmiyor — henüz sizin değil.
                  </p>
                </div>
              )}

              {Number(p.monthlyContribution) > 0 && (
                <p className="num mt-3 text-xs text-ink-faint">
                  Aylık katkı{" "}
                  {formatMoney(Money.of(p.monthlyContribution, p.currency), {
                    compact: true,
                  })}
                </p>
              )}

              <div className="mt-4">
                <Link
                  href={`/ekle/emeklilik?id=${p.assetId}`}
                  className="rounded-md border border-line px-2.5 py-1.5 text-xs text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  Bakiyeyi güncelle
                </Link>
              </div>
            </article>
          );
        })}
      </div>

      <p className="mt-6 text-pretty text-xs text-ink-faint">
        Hak ediş kademeleri Türkiye&apos;nin bugünkü düzenine göre varsayılan
        alınmıştır (3/6/10 yıl → %15/35/60) ve <strong>temsilîdir</strong>;
        mevzuat değişebilir. Bakiye kurumdan otomatik çekilmez — arada bir
        bakıp buradan güncellemeniz gerekir.
      </p>
    </PageShell>
  );
}
