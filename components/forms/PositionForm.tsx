"use client";

import { useActionState, useState } from "react";
import { savePositionAction, type FormState } from "@/app/actions/assets";
import { FormShell } from "@/components/form/FormShell";
import { FundingSource, type CashAccount } from "@/components/form/FundingSource";
import {
  Field, TextInput, Select, MoneyInput, CurrencySelect, DateInput,
} from "@/components/form/Field";
import { SymbolSearch } from "@/components/pickers/SymbolSearch";
import { Money, formatMoney } from "@/lib/money";
import Decimal from "decimal.js";

const initial: FormState = {};

export interface PositionDefaults {
  id?: string;
  kind?: string;
  symbol?: string;
  name?: string;
  currency?: string;
  quantity?: string;
  pricePerUnit?: string;
  purchaseDate?: string;
  fee?: string;
  status?: string;
  note?: string;
}

export function PositionForm({
  defaults = {},
  cashAccounts = [],
}: {
  defaults?: PositionDefaults;
  cashAccounts?: CashAccount[];
}) {
  const [state, action] = useActionState(savePositionAction, initial);
  const err = state.fieldErrors ?? {};

  const [currency, setCurrency] = useState(defaults.currency ?? "USD");
  const [quantity, setQuantity] = useState(defaults.quantity ?? "");
  const [price, setPrice] = useState(defaults.pricePerUnit ?? "");
  const [planned, setPlanned] = useState(defaults.status === "planned");

  // Toplam tutarı canlı göster — kullanıcı ne ödeyeceğini formu
  // göndermeden görmeli
  let total: string | null = null;
  try {
    if (quantity && price) {
      total = formatMoney(
        Money.of(new Decimal(quantity).times(price).toFixed(), currency),
      );
    }
  } catch {
    total = null;
  }

  return (
    <form action={action}>
      <FormShell
        title={defaults.id ? "Pozisyonu düzenle" : "Hisse / kripto ekle"}
        description="Sembolü arayıp seçin, aldığınız miktarı ve birim fiyatı girin. Güncel değer canlı fiyattan hesaplanır."
        error={state.error}
        editingId={defaults.id}
        deleteRedirect="/portfoy"
      >
        {defaults.id && <input type="hidden" name="id" value={defaults.id} />}

        <Field label="Enstrüman" required error={err.symbol ?? err.name}>
          <SymbolSearch
            defaultSymbol={defaults.symbol}
            defaultName={defaults.name}
            defaultKind={defaults.kind ?? "equity"}
            error={err.symbol}
            onSelect={(r) => {
              if (r.currency) setCurrency(r.currency);
            }}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Miktar" htmlFor="quantity" required error={err.quantity}>
            <TextInput
              id="quantity"
              name="quantity"
              inputMode="decimal"
              required
              autoComplete="off"
              placeholder="1000"
              defaultValue={defaults.quantity}
              onChange={(e) => setQuantity(e.target.value.replace(",", "."))}
              error={err.quantity}
              className="num text-right"
            />
          </Field>

          <Field
            label="Birim alış fiyatı"
            htmlFor="pricePerUnit"
            required
            error={err.pricePerUnit}
          >
            <MoneyInput
              id="pricePerUnit"
              name="pricePerUnit"
              currency={currency}
              defaultValue={defaults.pricePerUnit}
              error={err.pricePerUnit}
              onValueChange={setPrice}
            />
          </Field>
        </div>

        {total && (
          <p className="num -mt-2 text-sm text-ink-muted">
            Toplam tutar: <span className="text-ink">{total}</span>
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Para birimi" htmlFor="currency" error={err.currency}>
            <Select
              id="currency"
              name="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              error={err.currency}
            >
              {["USD", "EUR", "TRY", "GBP", "CHF", "AED", "JPY"].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Alış tarihi"
            htmlFor="purchaseDate"
            required
            error={err.purchaseDate}
            hint="O günün döviz kuru otomatik kaydedilir."
          >
            <DateInput
              id="purchaseDate"
              name="purchaseDate"
              required
              defaultValue={defaults.purchaseDate ?? new Date().toISOString().slice(0, 10)}
              error={err.purchaseDate}
            />
          </Field>
        </div>

        <Field label="Komisyon" htmlFor="fee" error={err.fee} hint="Boş bırakabilirsiniz.">
          <MoneyInput
            id="fee"
            name="fee"
            currency={currency}
            defaultValue={defaults.fee}
            error={err.fee}
          />
        </Field>

        {!planned && (
          <FundingSource
            cashAccounts={cashAccounts}
            cost={quantity && price ? String(Number(quantity) * Number(price)) : "0"}
            currency={currency}
            purchaseDate={defaults.purchaseDate ?? new Date().toISOString().slice(0, 10)}
          />
        )}

        <PlannedToggle planned={planned} onChange={setPlanned} />

        <Field label="Not" htmlFor="note" error={err.note}>
          <TextInput id="note" name="note" defaultValue={defaults.note ?? ""} />
        </Field>
      </FormShell>
    </form>
  );
}

export function PlannedToggle({
  planned,
  onChange,
}: {
  planned: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="rounded-md border border-line bg-surface p-3">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={planned}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
        />
        <span>
          <span className="block text-sm font-medium text-ink">
            Henüz almadım, almayı planlıyorum
          </span>
          <span className="mt-0.5 block text-pretty text-xs text-ink-muted">
            Planlanan varlıklar net servete <strong>dahil edilmez</strong>. Plan
            sayfasında ayrı takip edilir ve nakdinizin yetip yetmediği hesaplanır.
          </span>
        </span>
      </label>
      <input type="hidden" name="status" value={planned ? "planned" : "active"} />
    </div>
  );
}
