"use client";

import { useActionState, useState } from "react";
import { saveGoalAction, deleteGoalAction } from "@/app/actions/automation";
import type { FormState } from "@/app/actions/assets";
import {
  Field,
  Select,
  TextInput,
  MoneyInput,
  DateInput,
  CurrencySelect,
} from "@/components/form/Field";
import { SubmitButton } from "@/components/form/Button";
import { DeleteButton } from "@/components/form/DeleteButton";
import { Money, formatMoney, formatPercent } from "@/lib/money";
import { cn } from "@/lib/cn";
import Decimal from "decimal.js";

const initial: FormState = {};

const KIND_LABEL: Record<string, string> = {
  retirement: "Emeklilik",
  property: "Ev / gayrimenkul",
  education: "Eğitim",
  emergency: "Acil durum fonu",
  other: "Diğer",
};

export interface GoalRow {
  id: string;
  name: string;
  kind: string;
  targetAmount: string;
  currency: string;
  targetDate: string;
  currentUsd: string;
  targetUsd: string;
  yearsRemaining: number;
  progressRatio: string;
  achieved: boolean;
  overdue: boolean;
  shortfallUsd: string;
  requiredAnnualReturn: string | null;
  requiredMonthlySaving: string | null;
  /** Monte Carlo'dan gelen ulaşma olasılığı. */
  probability: string | null;
}

/**
 * Finansal hedefler.
 *
 * Her hedef iki soruyu birden yanıtlar: bugün neredeyim (ilerleme çubuğu)
 * ve gidişat böyle sürerse varır mıyım (Monte Carlo olasılığı). İkincisi
 * olmadan ilerleme çubuğu fazla iyimser bir tablo çizer.
 */
export function GoalsForm({ goals }: { goals: GoalRow[] }) {
  const [state, action] = useActionState(saveGoalAction, initial);
  const err = state.fieldErrors ?? {};
  const [currency, setCurrency] = useState("USD");

  return (
    <div className="space-y-5">
      {goals.length > 0 && (
        <ul className="space-y-3">
          {goals.map((g) => {
            const pct = Math.min(100, Math.max(0, Number(g.progressRatio) * 100));
            const prob = g.probability !== null ? Number(g.probability) : null;

            return (
              <li key={g.id} className="rounded-lg border border-line p-3.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{g.name}</p>
                    <p className="num text-xs text-ink-faint">
                      {KIND_LABEL[g.kind] ?? g.kind} ·{" "}
                      {formatMoney(Money.of(g.targetAmount, g.currency), { compact: true })}{" "}
                      · {g.targetDate}
                      {g.yearsRemaining > 0
                        ? ` (${g.yearsRemaining} yıl)`
                        : " (tarihi geçti)"}
                    </p>
                  </div>
                  <DeleteButton
                    action={deleteGoalAction.bind(null, g.id)}
                    successMessage="Hedef silindi."
                  />
                </div>

                <div className="mt-2.5">
                  <div
                    className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover"
                    role="progressbar"
                    aria-valuenow={Math.round(pct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${g.name} ilerlemesi`}
                  >
                    <div
                      className={cn(
                        "h-full rounded-full",
                        g.achieved ? "bg-gain" : g.overdue ? "bg-loss" : "bg-accent",
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
                    <span className="num text-ink-muted">
                      {formatMoney(Money.of(g.currentUsd, "USD"), { compact: true })} /{" "}
                      {formatMoney(Money.of(g.targetUsd, "USD"), { compact: true })} (
                      {formatPercent(new Decimal(g.progressRatio), { decimals: 0 })})
                    </span>
                    {prob !== null && (
                      <span
                        className={cn(
                          "num",
                          prob >= 0.7 ? "text-gain" : prob >= 0.4 ? "text-warn" : "text-loss",
                        )}
                      >
                        ulaşma olasılığı {formatPercent(new Decimal(g.probability!), { decimals: 0 })}
                      </span>
                    )}
                  </div>
                </div>

                {!g.achieved && !g.overdue && (
                  <p className="mt-2 text-pretty text-xs text-ink-faint">
                    Bu hedefe ulaşmak için{" "}
                    {g.requiredAnnualReturn !== null && (
                      <>
                        yıllık{" "}
                        <span className="num text-ink-muted">
                          {formatPercent(new Decimal(g.requiredAnnualReturn), { decimals: 1 })}
                        </span>{" "}
                        getiri, ya da{" "}
                      </>
                    )}
                    {g.requiredMonthlySaving !== null && (
                      <>
                        getiri saymadan aylık{" "}
                        <span className="num text-ink-muted">
                          {formatMoney(Money.of(g.requiredMonthlySaving, "USD"), {
                            compact: true,
                          })}
                        </span>{" "}
                        birikim
                      </>
                    )}{" "}
                    gerekiyor.
                  </p>
                )}

                {g.achieved && (
                  <p className="mt-2 text-xs text-gain">Hedefe ulaşıldı.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <form action={action} className="space-y-4 border-t border-line pt-4">
        {state.savedId && !state.error && (
          <p className="rounded-md border border-gain/40 bg-gain/10 px-3 py-2 text-sm text-gain">
            Hedef kaydedildi.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Hedef adı" htmlFor="name" error={err.name}>
            <TextInput id="name" name="name" placeholder="Emeklilik" error={err.name} required />
          </Field>

          <Field label="Tür" htmlFor="kind" error={err.kind}>
            <Select id="kind" name="kind" defaultValue="retirement">
              {Object.entries(KIND_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Hedef tutar" htmlFor="targetAmount" error={err.targetAmount}>
            <MoneyInput
              id="targetAmount"
              name="targetAmount"
              currency={currency}
              error={err.targetAmount}
            />
          </Field>

          <Field label="Para birimi" htmlFor="currency">
            <CurrencySelect
              id="currency"
              name="currency"
              defaultValue={currency}
              onChange={(e) => setCurrency(e.target.value)}
            />
          </Field>

          <Field label="Hedef tarih" htmlFor="targetDate" error={err.targetDate}>
            <DateInput
              id="targetDate"
              name="targetDate"
              error={err.targetDate}
              allowFuture
              required
            />
          </Field>

          <Field
            label="Öncelik"
            htmlFor="priority"
            error={err.priority}
            hint="1 = en yüksek"
          >
            <TextInput
              id="priority"
              name="priority"
              type="number"
              min={1}
              max={9}
              defaultValue={1}
              error={err.priority}
              className="num"
            />
          </Field>
        </div>

        <SubmitButton>Hedef ekle</SubmitButton>
      </form>
    </div>
  );
}
