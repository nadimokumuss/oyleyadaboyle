"use client";

import { useEffect, useRef, useState } from "react";
import Decimal from "decimal.js";
import { Money, formatMoney, formatPercent } from "@/lib/money";
import { cn } from "@/lib/cn";
import { balanceAt, type DepositTerms } from "@/lib/finance/deposit";
import type { DepositView } from "@/lib/finance/depositService";

/**
 * Canlı faiz sayacı.
 *
 * Sunucudan sadece PARAMETRELER gelir, tutar değil. Sayaç tarayıcıda
 * aynı formülü çalıştırır — böylece ağ trafiği olmadan saniyede birkaç
 * kez tazelenebilir ve sunucudakiyle birebir aynı sonucu verir.
 *
 * Sekme arka plandayken durur: görünmeyen bir sayaç için pil ve CPU
 * harcamanın anlamı yok (Page Visibility API).
 */

const REFRESH_MS = 250;

function toTerms(p: DepositView["params"]): DepositTerms {
  return {
    principal: Money.of(p.principal, "XXX"), // para birimi dışarıdan basılır
    annualRate: new Decimal(p.annualRate),
    compounding: p.compounding,
    dayCount: p.dayCount,
    startDate: new Date(p.startDate),
    maturityDate: p.maturityDate ? new Date(p.maturityDate) : null,
    withholdingRate: new Decimal(p.withholdingRate),
  };
}

export function AccrualTicker({ deposit }: { deposit: DepositView }) {
  const { currency, params } = deposit;
  const termsRef = useRef<DepositTerms | null>(null);
  if (!termsRef.current) {
    const t = toTerms(params);
    termsRef.current = { ...t, principal: Money.of(params.principal, currency) };
  }
  const terms = termsRef.current;

  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    let running = true;

    const loop = (ts: number) => {
      if (!running) return;
      if (ts - last >= REFRESH_MS) {
        last = ts;
        setNow(new Date());
      }
      raf = requestAnimationFrame(loop);
    };

    const start = () => {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);
    raf = requestAnimationFrame(loop);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // İlk render'da sunucu anlık görüntüsü kullanılır (hydration uyumu için)
  const gross = now
    ? balanceAt(terms, now).minus(terms.principal)
    : Money.of(deposit.snapshot.grossInterest, currency);
  const withholding = gross.times(terms.withholdingRate);
  const net = gross.minus(withholding);
  const netBalance = terms.principal.plus(net);

  const matured = deposit.snapshot.matured;
  const real = new Decimal(deposit.real.realAnnual);

  return (
    <article className="rounded-lg border border-line bg-surface-raised p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-ink">{deposit.name}</h3>
          <p className="num mt-0.5 text-xs text-ink-faint">
            {formatMoney(terms.principal, { compact: true })} anapara ·{" "}
            {formatPercent(terms.annualRate)} brüt · {COMPOUND_LABEL[params.compounding]}
          </p>
        </div>
        <MaturityBadge deposit={deposit} />
      </header>

      {/* Ana sayaç: stopaj sonrası eldeki toplam.
          Saniyede dört kez değiştiği için ekran okuyucudan gizlenir —
          canlı bölge yapılsaydı hiç susmazdı. Yerine hemen altında,
          sunucu anlık görüntüsünden türeyen sabit bir özet sunulur. */}
      <div className="mt-4">
        <p className="text-xs text-ink-faint">Net bakiye (stopaj sonrası)</p>
        <div aria-hidden="true">
          <p className="num mt-0.5 text-3xl font-semibold tabular-nums text-ink">
            {formatMoney(netBalance)}
          </p>
          <p className="num mt-1 text-sm text-gain">
            {formatMoney(net, { signed: true })} net kazanç
          </p>
        </div>
        <p className="sr-only">
          {formatMoney(
            Money.of(deposit.snapshot.grossInterest, currency)
              .times(new Decimal(1).minus(terms.withholdingRate))
              .plus(terms.principal),
          )}
          , sayfa açıldığı andaki değer. Sayaç canlı ilerliyor; güncel tutar için
          sayfayı yenileyin.
        </p>
      </div>

      {/* Brüt → stopaj → net kırılımı */}
      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-3 text-xs">
        <Cell label="Brüt kazanç" value={formatMoney(gross, { compact: true })} />
        <Cell
          label={`Stopaj (${formatPercent(terms.withholdingRate, { decimals: 0 })})`}
          value={formatMoney(withholding.negated(), { compact: true })}
          tone="loss"
        />
        <Cell label="Net kazanç" value={formatMoney(net, { compact: true })} tone="gain" />
      </dl>

      {/* Çoklu ölçekli kazanç hızı — asıl istenen özellik */}
      <div className="mt-4 border-t border-line pt-3">
        <p className="mb-2 text-xs text-ink-faint">
          Net kazanç hızı {matured && <span className="text-warn">(vade doldu, faiz durdu)</span>}
        </p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          <Rate label="saniyede" value={deposit.rates.perSecond} currency={currency} decimals={4} />
          <Rate label="saatte" value={deposit.rates.perHour} currency={currency} />
          <Rate label="günde" value={deposit.rates.perDay} currency={currency} />
          <Rate label="haftada" value={deposit.rates.perWeek} currency={currency} />
          <Rate label="ayda" value={deposit.rates.perMonth} currency={currency} />
          <Rate label="yılda" value={deposit.rates.perYear} currency={currency} />
        </dl>
      </div>

      {/* Reel getiri — enflasyon gerçeği */}
      <div
        className={cn(
          "mt-4 rounded-md border px-3 py-2.5",
          deposit.real.losingToInflation
            ? "border-loss/40 bg-loss/10"
            : "border-gain/40 bg-gain/10",
        )}
      >
        <p className="text-xs font-medium text-ink">
          Reel getiri:{" "}
          <span className={cn("num", deposit.real.losingToInflation ? "text-loss" : "text-gain")}>
            {formatPercent(real, { signed: true })}
          </span>
          <span className="ml-1 font-normal text-ink-faint">
            (yıllık, %{new Decimal(deposit.real.inflationAssumed).times(100).toFixed(1)} enflasyon
            varsayımıyla)
          </span>
        </p>
        <p className="num mt-1 text-pretty text-xs text-ink-muted">
          {deposit.real.losingToInflation ? (
            <>
              Nominal olarak kazanıyor, satın alma gücü olarak{" "}
              <span className="text-loss">
                yılda {formatMoney(Money.of(deposit.real.purchasingPowerChange, currency).abs(), { compact: true })}
              </span>{" "}
              kaybediyorsunuz.
            </>
          ) : (
            <>
              Enflasyonun üzerinde: yılda{" "}
              {formatMoney(Money.of(deposit.real.purchasingPowerChange, currency), { compact: true })}{" "}
              reel kazanç.
            </>
          )}
        </p>
      </div>

      {/* Karşı-olgusal */}
      <div className="mt-4 border-t border-line pt-3">
        <p className="mb-2 text-xs text-ink-faint">Aynı para başka yerde olsaydı</p>
        <ul className="space-y-1">
          {deposit.counterfactuals.map((c) => {
            const delta = new Decimal(c.delta);
            return (
              <li key={c.key} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="text-ink-muted">{c.label}</span>
                <span className="num flex items-baseline gap-2">
                  <span className="text-ink">
                    {formatMoney(Money.of(c.value, currency), { compact: true })}
                  </span>
                  <span
                    className={cn(
                      "w-20 text-right",
                      delta.isPositive() ? "text-gain" : "text-loss",
                    )}
                  >
                    {formatMoney(Money.of(delta, currency), { compact: true, signed: true })}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </article>
  );
}

const COMPOUND_LABEL: Record<string, string> = {
  simple: "basit faiz",
  daily: "günlük bileşik",
  monthly: "aylık bileşik",
  quarterly: "3 aylık bileşik",
  annual: "yıllık bileşik",
  continuous: "sürekli bileşik",
};

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

function Rate({
  label,
  value,
  currency,
  decimals,
}: {
  label: string;
  value: string;
  currency: string;
  decimals?: number;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="num text-xs font-medium text-ink">
        {formatMoney(Money.of(value, currency), { decimals, compact: !decimals })}
      </dd>
    </div>
  );
}

function MaturityBadge({ deposit }: { deposit: DepositView }) {
  const { daysToMaturity, matured } = deposit.snapshot;

  if (matured) {
    return (
      <span className="rounded border border-warn/50 px-1.5 py-0.5 text-[11px] text-warn">
        vade doldu
      </span>
    );
  }
  if (daysToMaturity === null) {
    return (
      <span className="rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-muted">
        vadesiz
      </span>
    );
  }
  return (
    <span
      className={cn(
        "num rounded border px-1.5 py-0.5 text-[11px]",
        daysToMaturity <= 14 ? "border-warn/50 text-warn" : "border-line text-ink-muted",
      )}
    >
      vadeye {daysToMaturity} gün
    </span>
  );
}
