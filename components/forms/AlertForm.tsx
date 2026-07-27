"use client";

import { useActionState } from "react";
import { createAlertAction, deleteAlertAction } from "@/app/actions/automation";
import type { FormState } from "@/app/actions/assets";
import { Field, Select, TextInput, MoneyInput } from "@/components/form/Field";
import { SubmitButton } from "@/components/form/Button";
import { formatMoney, Money } from "@/lib/money";

const initial: FormState = {};

export interface AlertRow {
  id: string;
  symbol: string;
  condition: "above" | "below";
  threshold: string;
  currency: string;
  active: boolean;
  firedAt: string | null;
  note: string | null;
}

/**
 * Fiyat alarmı kurma ve mevcut alarmları listeleme.
 *
 * Alarm tek atışlıktır: tetiklendiğinde kapanır. Eşiğin etrafında salınan
 * bir fiyat aksi halde dakikada bir bildirim üretirdi.
 */
export function AlertForm({
  symbol,
  currency,
  currentPrice,
  alerts,
}: {
  symbol: string;
  currency: string;
  currentPrice: string;
  alerts: AlertRow[];
}) {
  const [state, action] = useActionState(createAlertAction, initial);
  const err = state.fieldErrors ?? {};

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-3">
        <input type="hidden" name="symbol" value={symbol} />
        <input type="hidden" name="currency" value={currency} />

        {state.savedId && !state.error && (
          <p className="rounded-md border border-gain/40 bg-gain/10 px-3 py-2 text-sm text-gain">
            Alarm kuruldu. Eşik aşıldığında bildirim alacaksınız.
          </p>
        )}
        {state.error && (
          <p className="rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">
            {state.error}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Koşul" htmlFor="condition">
            <Select id="condition" name="condition" defaultValue="above">
              <option value="above">Şunun üzerine çıkarsa</option>
              <option value="below">Şunun altına inerse</option>
            </Select>
          </Field>

          <Field label="Eşik" htmlFor="threshold" error={err.threshold}>
            <MoneyInput
              id="threshold"
              name="threshold"
              currency={currency}
              defaultValue={currentPrice}
              error={err.threshold}
            />
          </Field>

          <Field label="Not" htmlFor="note" error={err.note} hint="isteğe bağlı">
            <TextInput id="note" name="note" placeholder="Neden bekliyorum?" />
          </Field>
        </div>

        <SubmitButton>Alarm kur</SubmitButton>
      </form>

      {alerts.length > 0 && (
        <ul className="space-y-1.5 border-t border-line pt-3">
          {alerts.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-baseline justify-between gap-2 text-xs"
            >
              <span className="num text-ink-muted">
                {a.condition === "above" ? "↑" : "↓"}{" "}
                {formatMoney(Money.of(a.threshold, a.currency))}
                {a.note && <span className="ml-2 text-ink-faint">{a.note}</span>}
              </span>
              <span className="flex items-center gap-2">
                {a.firedAt ? (
                  <span className="text-gain">
                    tetiklendi · {new Date(a.firedAt).toLocaleDateString("tr-TR")}
                  </span>
                ) : (
                  <span className="text-ink-faint">bekliyor</span>
                )}
                <form action={deleteAlertAction.bind(null, a.id)}>
                  <button
                    type="submit"
                    className="rounded px-1.5 py-0.5 text-ink-faint transition-colors hover:bg-surface-hover hover:text-loss focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    sil
                  </button>
                </form>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
