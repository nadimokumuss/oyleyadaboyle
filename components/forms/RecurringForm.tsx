"use client";

import { useActionState, useState } from "react";
import {
  saveRecurringAction,
  deleteRecurringAction,
} from "@/app/actions/automation";
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
import { Money, formatMoney } from "@/lib/money";

const initial: FormState = {};

const TYPE_LABEL: Record<string, string> = {
  deposit_in: "Gelen para (maaş, kira geliri)",
  withdraw: "Giden para (kira ödemesi, abonelik)",
  rent: "Kira geliri",
  dividend: "Temettü",
  interest: "Faiz",
  staking: "Staking geliri",
  expense: "Gider",
  fee: "Ücret",
  tax: "Vergi",
};

const FREQUENCY_LABEL: Record<string, string> = {
  weekly: "haftalık",
  monthly: "aylık",
  quarterly: "3 aylık",
  yearly: "yıllık",
};

export interface RecurringRow {
  id: string;
  assetId: string;
  assetName: string;
  label: string;
  type: string;
  amount: string;
  currency: string;
  frequency: string;
  startDate: string;
  endDate: string | null;
  nextRunDate: string;
  active: boolean;
}

export interface CashOption {
  id: string;
  name: string;
  currency: string;
}

/**
 * Düzenli hareket tanımlama.
 *
 * Üretilen kayıtlar normal işlem satırlarıdır: İşlemler sayfasında görünür
 * ve tek tek geri alınabilir. Şablonu silmek geçmişte üretilmiş kayıtları
 * silmez — bu bilinçli, geçmiş para hareketi olmuş demektir.
 */
export function RecurringForm({
  accounts,
  rows,
}: {
  accounts: CashOption[];
  rows: RecurringRow[];
}) {
  const [state, action] = useActionState(saveRecurringAction, initial);
  const err = state.fieldErrors ?? {};
  const [currency, setCurrency] = useState(accounts[0]?.currency ?? "USD");

  if (accounts.length === 0) {
    return (
      <p className="text-pretty text-sm text-ink-faint">
        Önce bir nakit hesabı ekleyin — düzenli hareketler bir hesaba işlenir.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-md border border-line px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-ink">{r.label}</p>
                <p className="num text-xs text-ink-faint">
                  {formatMoney(Money.of(r.amount, r.currency))} ·{" "}
                  {FREQUENCY_LABEL[r.frequency] ?? r.frequency} · {r.assetName}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="num text-xs text-ink-muted">
                  {r.active ? `sıradaki ${r.nextRunDate}` : "pasif"}
                </span>
                <form action={deleteRecurringAction.bind(null, r.id)}>
                  <button
                    type="submit"
                    className="rounded px-1.5 py-0.5 text-xs text-ink-faint transition-colors hover:bg-surface-hover hover:text-loss focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    sil
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form action={action} className="space-y-4 border-t border-line pt-4">
        {state.savedId && !state.error && (
          <p className="rounded-md border border-gain/40 bg-gain/10 px-3 py-2 text-sm text-gain">
            Kaydedildi. İlk hareket başlangıç tarihinde işlenecek.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ad" htmlFor="label" error={err.label}>
            <TextInput
              id="label"
              name="label"
              placeholder="Maaş"
              error={err.label}
              required
            />
          </Field>

          <Field label="Hesap" htmlFor="assetId" error={err.assetId}>
            <Select
              id="assetId"
              name="assetId"
              onChange={(e) => {
                const acc = accounts.find((a) => a.id === e.target.value);
                if (acc) setCurrency(acc.currency);
              }}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Tür" htmlFor="type" error={err.type}>
            <Select id="type" name="type" defaultValue="deposit_in">
              {Object.entries(TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Tutar" htmlFor="amount" error={err.amount}>
            <MoneyInput
              id="amount"
              name="amount"
              currency={currency}
              error={err.amount}
            />
          </Field>

          <Field label="Para birimi" htmlFor="currency">
            <CurrencySelect id="currency" name="currency" defaultValue={currency} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Sıklık" htmlFor="frequency" error={err.frequency}>
            <Select id="frequency" name="frequency" defaultValue="monthly">
              {Object.entries(FREQUENCY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Başlangıç"
            htmlFor="startDate"
            error={err.startDate}
            hint="ayın kaçı olduğu buradan alınır"
          >
            <DateInput id="startDate" name="startDate" error={err.startDate} required />
          </Field>

          <Field
            label="Bitiş"
            htmlFor="endDate"
            error={err.endDate}
            hint="boşsa süresiz"
          >
            <DateInput id="endDate" name="endDate" error={err.endDate} />
          </Field>
        </div>

        <SubmitButton>Düzenli hareket ekle</SubmitButton>

        <p className="text-pretty text-xs text-ink-faint">
          Üretilen kayıtlar normal işlem satırıdır — İşlemler sayfasında
          görünür ve tek tek geri alınabilir. Panel kapalı kaldıysa açıldığında
          kaçırılan dönemler telafi edilir.
        </p>
      </form>
    </div>
  );
}
