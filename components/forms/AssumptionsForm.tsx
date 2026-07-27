"use client";

import { useActionState } from "react";
import { saveAssumptionsAction } from "@/app/actions/settings";
import type { FormState } from "@/app/actions/assets";
import { Field, PercentInput } from "@/components/form/Field";
import { SubmitButton } from "@/components/form/Button";

const initial: FormState = {};

const CURRENCIES = [
  { code: "TRY", hint: "TÜİK yıllık TÜFE" },
  { code: "USD", hint: "BLS CPI" },
  { code: "EUR", hint: "Eurostat HICP" },
  { code: "GBP", hint: "ONS CPI" },
  { code: "CHF", hint: "BFS LIK" },
] as const;

const BENCHMARKS = [
  { key: "usd_deposit", label: "USD mevduat" },
  { key: "gold", label: "Altın" },
  { key: "sp500", label: "S&P 500" },
] as const;

/**
 * Enflasyon ve referans getiri varsayımları.
 *
 * Bu sayılar ölçülmez, kabul edilir — ve reel getiriyi doğrudan üretirler.
 * Koda gömülüyken kullanıcı kendi ülkesinin gerçeğini yansıtamıyordu.
 */
export function AssumptionsForm({
  inflation,
  benchmarks,
  capitalGainsRate,
}: {
  inflation: Record<string, string>;
  benchmarks: Record<string, string>;
  capitalGainsRate: string;
}) {
  const [state, action] = useActionState(saveAssumptionsAction, initial);
  const err = state.fieldErrors ?? {};

  return (
    <form action={action} className="space-y-5">
      {state.error && (
        <p className="rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">
          {state.error}
        </p>
      )}
      {state.savedId && !state.error && (
        <p className="rounded-md border border-gain/40 bg-gain/10 px-3 py-2 text-sm text-gain">
          Varsayımlar kaydedildi. Reel getiri ve karşılaştırmalar güncellendi.
        </p>
      )}

      <div>
        <p className="mb-2.5 text-xs font-medium uppercase tracking-wide text-ink-faint">
          Yıllık enflasyon
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          {CURRENCIES.map(({ code, hint }) => (
            <Field
              key={code}
              label={code}
              htmlFor={`inflation${code}`}
              error={err[`inflation${code}`]}
              hint={hint}
            >
              <PercentInput
                id={`inflation${code}`}
                name={`inflation${code}`}
                defaultValue={inflation[code] ?? "0"}
                error={err[`inflation${code}`]}
                max={5}
              />
            </Field>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2.5 text-xs font-medium uppercase tracking-wide text-ink-faint">
          Referans yıllık getiriler
        </p>
        <p className="mb-2.5 text-pretty text-xs text-ink-faint">
          Mevduat sayfasındaki &ldquo;aynı para başka yerde olsaydı&rdquo;
          karşılaştırması bunları kullanır.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          {BENCHMARKS.map(({ key, label }) => (
            <Field
              key={key}
              label={label}
              htmlFor={`benchmark_${key}`}
              error={err[`benchmark_${key}`]}
            >
              <PercentInput
                id={`benchmark_${key}`}
                name={`benchmark_${key}`}
                defaultValue={benchmarks[key] ?? "0"}
                error={err[`benchmark_${key}`]}
                max={5}
              />
            </Field>
          ))}
        </div>
      </div>

      <div className="border-t border-line pt-4">
        <Field
          label="Sermaye kazancı vergi oranı"
          htmlFor="capitalGainsRate"
          error={err.capitalGainsRate}
          hint="Boş bırakılırsa (0) vergi tasarrufu tahmini yapılmaz. Panel vergi hesaplamaz — bu oran yalnızca fırsat önerilerinde kullanılır."
        >
          <PercentInput
            id="capitalGainsRate"
            name="capitalGainsRate"
            defaultValue={capitalGainsRate}
            error={err.capitalGainsRate}
            max={1}
          />
        </Field>
      </div>

      <SubmitButton>Varsayımları kaydet</SubmitButton>

      <p className="text-pretty text-xs text-ink-faint">
        Bu sayılar <strong className="font-medium text-ink-muted">temsilîdir</strong>{" "}
        ve resmî kaynaktan güncellenmelidir. Konut fiyat endeksleri ile araç
        amortisman eğrileri henüz buradan düzenlenemiyor —{" "}
        <code className="text-ink-muted">db/seeds/</code> altındaki dosyalarda
        duruyorlar ve onlar da temsilî. Model rozetiyle işaretlenen her değer
        bu varsayımlardan türer.
      </p>
    </form>
  );
}
