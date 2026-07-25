"use client";

import { useActionState, useState } from "react";
import { saveTargetsAction } from "@/app/actions/settings";
import type { FormState } from "@/app/actions/assets";
import { Field, PercentInput } from "@/components/form/Field";
import { SubmitButton } from "@/components/form/Button";
import { cn } from "@/lib/cn";

const initial: FormState = {};

const KINDS = [
  ["equity", "Hisse"],
  ["crypto", "Kripto"],
  ["deposit", "Mevduat"],
  ["realestate", "Gayrimenkul"],
  ["venture", "Girişim"],
  ["cash", "Nakit"],
  ["commodity", "Emtia"],
  ["vehicle", "Araç"],
] as const;

export function TargetsForm({
  defaults,
  tolerance,
}: {
  defaults: Record<string, string>;
  tolerance: string;
}) {
  const [state, action] = useActionState(saveTargetsAction, initial);
  const err = state.fieldErrors ?? {};

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(KINDS.map(([k]) => [k, defaults[k] ?? ""])),
  );

  const total = Object.values(values).reduce(
    (a, v) => a + (Number(v) || 0),
    0,
  );
  const over = total > 1.0001;

  return (
    <form action={action} className="space-y-4">
      {state.error && (
        <p className="rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">
          {state.error}
        </p>
      )}
      {state.savedId && !state.error && (
        <p className="rounded-md border border-gain/40 bg-gain/10 px-3 py-2 text-sm text-gain">
          Hedefler kaydedildi. Fırsatlar sayfası artık bunları takip ediyor.
        </p>
      )}

      <p className="text-pretty text-sm text-ink-muted">
        Servetinizin her varlık sınıfında ne oranda olmasını istediğinizi girin.
        Boş bıraktığınız sınıflar takip edilmez.
      </p>

      <div className="grid gap-4 sm:grid-cols-4">
        {KINDS.map(([key, label]) => (
          <Field key={key} label={label} htmlFor={`target_${key}`} error={err[`target_${key}`]}>
            <PercentInput
              id={`target_${key}`}
              name={`target_${key}`}
              defaultValue={defaults[key]}
              max={1}
              onValueChange={(v) => setValues((s) => ({ ...s, [key]: v }))}
            />
          </Field>
        ))}
      </div>

      <div
        className={cn(
          "flex items-baseline justify-between gap-3 rounded-md border px-3 py-2 text-sm",
          over ? "border-loss/50 bg-loss/10" : "border-line bg-surface",
        )}
      >
        <span className={over ? "text-loss" : "text-ink-muted"}>
          {over
            ? "Toplam %100'ü aşıyor — bu hedefler asla tutturulamaz."
            : "Hedeflerin toplamı"}
        </span>
        <span className={cn("num font-medium", over ? "text-loss" : "text-ink")}>
          %{(total * 100).toFixed(0)}
        </span>
      </div>

      <Field
        label="Tolerans"
        htmlFor="tolerance"
        hint="Hedeften bu kadar sapma normal sayılır, aşınca uyarı üretilir."
      >
        <PercentInput
          id="tolerance"
          name="tolerance"
          defaultValue={tolerance}
          max={0.5}
        />
      </Field>

      <SubmitButton>Hedefleri kaydet</SubmitButton>
    </form>
  );
}
