"use client";

import { useActionState, useState } from "react";
import { saveCashAction, type FormState } from "@/app/actions/assets";
import { FormShell } from "@/components/form/FormShell";
import { Field, TextInput, MoneyInput, CurrencySelect } from "@/components/form/Field";

const initial: FormState = {};

export interface CashDefaults {
  id?: string;
  name?: string;
  currency?: string;
  amount?: string;
  country?: string;
  note?: string;
}

export function CashForm({ defaults = {} }: { defaults?: CashDefaults }) {
  const [state, action] = useActionState(saveCashAction, initial);
  const err = state.fieldErrors ?? {};
  const [currency, setCurrency] = useState(defaults.currency ?? "USD");

  return (
    <form action={action}>
      <FormShell
        title={defaults.id ? "Nakdi düzenle" : "Nakit ekle"}
        description="Banka hesabınızdaki veya elinizdeki serbest para. Servetinizin başlangıç noktası genelde burasıdır."
        error={state.error}
        editingId={defaults.id}
        deleteRedirect="/portfoy"
      >
        {defaults.id && <input type="hidden" name="id" value={defaults.id} />}

        <Field label="İsim" htmlFor="name" required error={err.name}>
          <TextInput
            id="name"
            name="name"
            required
            autoFocus
            placeholder="Örn. Garanti vadesiz USD"
            defaultValue={defaults.name}
            error={err.name}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tutar" htmlFor="amount" required error={err.amount}>
            <MoneyInput
              id="amount"
              name="amount"
              currency={currency}
              required
              defaultValue={defaults.amount}
              error={err.amount}
            />
          </Field>

          <Field label="Para birimi" htmlFor="currency" error={err.currency}>
            <select
              id="currency"
              name="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            >
              {["USD", "EUR", "TRY", "GBP", "CHF", "AED", "JPY", "CAD", "AUD"].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {defaults.id && (
          <p className="rounded-md border border-line bg-surface px-3 py-2 text-pretty text-xs text-ink-muted">
            Düzenlerken tutar, mevcut bakiyenin yerine geçer. Geçmiş hareket
            kaydı tutmak isterseniz bunun yerine varlığa işlem ekleyin.
          </p>
        )}

        <Field
          label="Ülke"
          htmlFor="country"
          error={err.country}
          hint="İki harfli kod. Ülke bazlı maruziyet raporunda kullanılır."
        >
          <TextInput
            id="country"
            name="country"
            maxLength={2}
            placeholder="TR"
            defaultValue={defaults.country ?? ""}
            error={err.country}
            className="uppercase"
          />
        </Field>

        <Field label="Not" htmlFor="note" error={err.note}>
          <TextInput id="note" name="note" defaultValue={defaults.note ?? ""} />
        </Field>
      </FormShell>
    </form>
  );
}
