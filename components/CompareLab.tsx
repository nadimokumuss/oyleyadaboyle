"use client";

import { useMemo, useState } from "react";
import Decimal from "decimal.js";
import { Money, formatMoney, formatPercent } from "@/lib/money";
import { simulate, DEFAULT_ASSUMPTIONS } from "@/lib/engine/montecarlo";
import { MoneyInput, Field, TextInput } from "@/components/form/Field";
import { Button } from "@/components/form/Button";
import { cn } from "@/lib/cn";

/**
 * Yatırım karşılaştırma laboratuvarı.
 *
 * "Bu evi alırsam mı, aynı parayı borsaya koyarsam mı?" sorusunun
 * cevabı. Aynı sermaye, aynı vade, farklı varlık sınıfları —
 * Monte Carlo ile olasılık aralıklarıyla birlikte.
 *
 * Tarayıcıda hesaplanıyor: kaydırıcıyı oynattıkça sunucuya gitmeden
 * sonuç güncelleniyor.
 */

const CANDIDATES = [
  { key: "deposit", label: "Mevduat", desc: "Sabit getiri, düşük risk" },
  { key: "equity", label: "Hisse / ETF", desc: "Geniş endeks fonu" },
  { key: "realestate", label: "Gayrimenkul", desc: "Kira + değer artışı" },
  { key: "crypto", label: "Kripto", desc: "Yüksek risk, yüksek oynaklık" },
  { key: "commodity", label: "Altın", desc: "Enflasyon koruması" },
  { key: "venture", label: "Girişim", desc: "İllikit, ya hep ya hiç" },
] as const;

const PATHS = 4000;

export function CompareLab({ defaultAmount }: { defaultAmount: string }) {
  const [amount, setAmount] = useState(defaultAmount);
  const [years, setYears] = useState(10);
  const [selected, setSelected] = useState<string[]>(["deposit", "equity", "realestate"]);

  const results = useMemo(() => {
    const principal = Number(amount);
    if (!Number.isFinite(principal) || principal <= 0) return [];

    return selected.map((key) => {
      const a = DEFAULT_ASSUMPTIONS[key] ?? { expectedReturn: 0.03, volatility: 0.1 };
      const sim = simulate({
        initialValue: principal,
        assumptions: [
          {
            key,
            label: key,
            weight: 1,
            expectedReturn: a.expectedReturn,
            volatility: a.volatility,
          },
        ],
        years,
        paths: PATHS,
        // Sabit tohum: kaydırıcıyı oynatınca sonuçlar zıplamasın,
        // sadece parametre değişiminin etkisi görünsün
        seed: 20260725,
      });

      const meta = CANDIDATES.find((c) => c.key === key)!;
      return {
        key,
        label: meta.label,
        desc: meta.desc,
        expectedReturn: a.expectedReturn,
        volatility: a.volatility,
        p10: sim.finalP10,
        p50: sim.finalP50,
        p90: sim.finalP90,
        lossProb: sim.probabilityOfLoss,
        principal,
      };
    });
  }, [amount, years, selected]);

  const best = results.reduce<(typeof results)[number] | null>(
    (acc, r) => (!acc || Number(r.p50) > Number(acc.p50) ? r : acc),
    null,
  );
  const maxP90 = Math.max(...results.map((r) => Number(r.p90)), 1);

  return (
    <div>
      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <Field label="Yatırılacak tutar" htmlFor="compare-amount">
          <MoneyInput
            id="compare-amount"
            name="compareAmount"
            currency="USD"
            defaultValue={defaultAmount}
            onValueChange={setAmount}
          />
        </Field>

        <Field label={`Vade: ${years} yıl`} htmlFor="compare-years">
          <input
            id="compare-years"
            type="range"
            min={1}
            max={30}
            value={years}
            onChange={(e) => setYears(Number(e.target.value))}
            className="w-full accent-[var(--color-accent)]"
          />
          <div className="num mt-1 flex justify-between text-xs text-ink-faint">
            <span>1 yıl</span>
            <span>30 yıl</span>
          </div>
        </Field>
      </div>

      <fieldset className="mb-4">
        <legend className="mb-2 text-xs text-ink-faint">
          Karşılaştırılacak seçenekler (en az 1, en fazla 4)
        </legend>
        <div className="flex flex-wrap gap-2">
          {CANDIDATES.map((c) => {
            const on = selected.includes(c.key);
            const disabled = !on && selected.length >= 4;
            return (
              <Button
                key={c.key}
                type="button"
                variant={on ? "primary" : "secondary"}
                disabled={disabled}
                onClick={() =>
                  setSelected((s) =>
                    on
                      ? s.length > 1
                        ? s.filter((x) => x !== c.key)
                        : s
                      : [...s, c.key],
                  )
                }
                className="text-xs"
              >
                {c.label}
              </Button>
            );
          })}
        </div>
      </fieldset>

      {results.length === 0 ? (
        <p className="text-sm text-ink-muted">Karşılaştırmak için bir tutar girin.</p>
      ) : (
        <>
          <ul className="space-y-4">
            {results.map((r) => {
              const p50 = Number(r.p50);
              const multiple = p50 / r.principal;
              const isBest = best?.key === r.key;

              return (
                <li
                  key={r.key}
                  className={cn(
                    "rounded-md border p-4",
                    isBest ? "border-accent/50 bg-accent/5" : "border-line bg-surface",
                  )}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <span className="text-sm font-medium text-ink">{r.label}</span>
                      <span className="ml-2 text-xs text-ink-faint">{r.desc}</span>
                    </div>
                    <span className="num text-xs text-ink-faint">
                      beklenen {formatPercent(r.expectedReturn, { signed: true, decimals: 1 })}/yıl ·
                      oynaklık {formatPercent(r.volatility, { decimals: 0 })}
                    </span>
                  </div>

                  {/* Olasılık aralığı çubuğu */}
                  <div className="mt-3">
                    <div className="relative h-6">
                      <div className="absolute inset-y-2 left-0 right-0 rounded-full bg-surface-hover" />
                      <div
                        className="absolute inset-y-2 rounded-full bg-accent/30"
                        style={{
                          left: `${(Number(r.p10) / maxP90) * 100}%`,
                          width: `${((Number(r.p90) - Number(r.p10)) / maxP90) * 100}%`,
                        }}
                      />
                      <div
                        className="absolute inset-y-0 w-0.5 rounded bg-accent"
                        style={{ left: `${(p50 / maxP90) * 100}%` }}
                      />
                    </div>
                  </div>

                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                    <Cell
                      label="Kötümser (p10)"
                      value={formatMoney(Money.of(r.p10, "USD"), { compact: true })}
                      tone={Number(r.p10) < r.principal ? "loss" : undefined}
                    />
                    <Cell
                      label="Medyan"
                      value={formatMoney(Money.of(r.p50, "USD"), { compact: true })}
                      emphasis
                    />
                    <Cell
                      label="İyimser (p90)"
                      value={formatMoney(Money.of(r.p90, "USD"), { compact: true })}
                      tone="gain"
                    />
                    <Cell
                      label="Zarar olasılığı"
                      value={formatPercent(new Decimal(r.lossProb), { decimals: 0 })}
                      tone={Number(r.lossProb) > 0.3 ? "loss" : undefined}
                    />
                  </dl>

                  <p className="num mt-2 text-xs text-ink-muted">
                    Medyan senaryoda paranız {multiple.toFixed(2).replace(".", ",")}× olur.
                  </p>
                </li>
              );
            })}
          </ul>

          <p className="mt-4 text-pretty text-xs text-ink-faint">
            Açık bant %80 olasılık aralığını, dikey çizgi medyanı gösterir.
            Getiriler reel (enflasyondan arındırılmış) varsayılmıştır ve
            temsilîdir; geçmiş performans geleceği garanti etmez. Gayrimenkulde
            kira geliri ve işlem maliyetleri, girişimde toplam kayıp ihtimali bu
            basit modelde ayrıca modellenmemiştir.
          </p>
        </>
      )}
    </div>
  );
}

function Cell({
  label,
  value,
  tone,
  emphasis,
}: {
  label: string;
  value: string;
  tone?: "gain" | "loss";
  emphasis?: boolean;
}) {
  return (
    <div>
      <dt className="truncate text-xs text-ink-faint">{label}</dt>
      <dd
        className={cn(
          "num mt-0.5",
          emphasis ? "font-semibold text-ink" : "font-medium",
          tone === "gain" && "text-gain",
          tone === "loss" && "text-loss",
          !tone && !emphasis && "text-ink",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
