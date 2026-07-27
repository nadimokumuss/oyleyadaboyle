"use client";

import { useActionState, useState } from "react";
import Decimal from "decimal.js";
import { saveCollectibleAction, type FormState } from "@/app/actions/assets";
import { FormShell } from "@/components/form/FormShell";
import { FundingSource, type CashAccount } from "@/components/form/FundingSource";
import {
  Field,
  TextInput,
  Select,
  MoneyInput,
  DateInput,
  CurrencySelect,
} from "@/components/form/Field";
import { PlannedToggle } from "./PositionForm";
import { Money, formatMoney, formatPercent } from "@/lib/money";
import { CATEGORY_LABEL } from "@/lib/finance/collectible";

const initial: FormState = {};

export interface CollectibleDefaults {
  id?: string;
  name?: string;
  category?: string;
  maker?: string;
  year?: number;
  currency?: string;
  country?: string;
  purchasePrice?: string;
  purchaseDate?: string;
  appraisalValue?: string;
  appraisalDate?: string;
  annualCosts?: string;
  status?: string;
  note?: string;
}

const today = () => new Date().toISOString().slice(0, 10);

export function CollectibleForm({
  defaults = {},
  cashAccounts = [],
}: {
  defaults?: CollectibleDefaults;
  cashAccounts?: CashAccount[];
}) {
  const [state, action] = useActionState(saveCollectibleAction, initial);
  const err = state.fieldErrors ?? {};

  const [currency, setCurrency] = useState(defaults.currency ?? "TRY");
  const [planned, setPlanned] = useState(defaults.status === "planned");
  const [price, setPrice] = useState(defaults.purchasePrice ?? "");
  const [purchaseDate, setPurchaseDate] = useState(defaults.purchaseDate ?? today());
  const [appraisal, setAppraisal] = useState(defaults.appraisalValue ?? "");
  const [annualCosts, setAnnualCosts] = useState(defaults.annualCosts ?? "");

  // Taşıma maliyeti kıymetli eşyada getiriyi sessizce yer — önizlemede
  // brüt değil NET sonuç gösterilir.
  const preview = (() => {
    const paid = Number(price);
    const value = Number(appraisal);
    if (!Number.isFinite(paid) || paid <= 0) return null;
    if (!Number.isFinite(value) || value <= 0) return null;

    const years = purchaseDate
      ? Math.max(0, (Date.now() - new Date(purchaseDate).getTime()) / (365.25 * 86_400_000))
      : 0;

    const costs = (Number(annualCosts) || 0) * years;
    const gross = value - paid;
    const net = gross - costs;
    const annualized = years > 0 ? Math.pow(value / paid, 1 / years) - 1 : null;

    return { gross, costs, net, annualized, years };
  })();

  return (
    <form action={action}>
      {defaults.id && <input type="hidden" name="id" value={defaults.id} />}
      <input type="hidden" name="status" value={planned ? "planned" : "active"} />

      <FormShell
        title={defaults.id ? "Kıymetli eşyayı düzenle" : "Kıymetli eşya ekle"}
        description="Sanat eseri, saat, mücevher veya koleksiyon parçası."
        error={state.error}
        editingId={defaults.id}
        deleteRedirect="/kiymetli-esya"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ad" htmlFor="name" error={err.name}>
            <TextInput
              id="name"
              name="name"
              placeholder="Submariner 126610LN"
              defaultValue={defaults.name}
              error={err.name}
              required
            />
          </Field>

          <Field label="Kategori" htmlFor="category" error={err.category}>
            <Select
              id="category"
              name="category"
              defaultValue={defaults.category ?? "other"}
            >
              {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Üretici / sanatçı" htmlFor="maker" error={err.maker}>
            <TextInput
              id="maker"
              name="maker"
              placeholder="Rolex"
              defaultValue={defaults.maker}
              error={err.maker}
            />
          </Field>

          <Field label="Yıl" htmlFor="year" error={err.year}>
            <TextInput
              id="year"
              name="year"
              type="number"
              min={0}
              max={2200}
              defaultValue={defaults.year}
              error={err.year}
              className="num"
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

          <Field label="Ülke" htmlFor="country" error={err.country}>
            <TextInput
              id="country"
              name="country"
              placeholder="TR"
              defaultValue={defaults.country ?? "TR"}
              error={err.country}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Alış fiyatı" htmlFor="purchasePrice" error={err.purchasePrice}>
            <MoneyInput
              id="purchasePrice"
              name="purchasePrice"
              currency={currency}
              defaultValue={defaults.purchasePrice}
              error={err.purchasePrice}
              onValueChange={setPrice}
            />
          </Field>

          <Field label="Alış tarihi" htmlFor="purchaseDate" error={err.purchaseDate}>
            <DateInput
              id="purchaseDate"
              name="purchaseDate"
              defaultValue={defaults.purchaseDate ?? today()}
              error={err.purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
              required
            />
          </Field>

          <Field
            label="Yıllık gider"
            htmlFor="annualCosts"
            error={err.annualCosts}
            hint="Sigorta, saklama, bakım"
          >
            <MoneyInput
              id="annualCosts"
              name="annualCosts"
              currency={currency}
              defaultValue={defaults.annualCosts}
              error={err.annualCosts}
              onValueChange={setAnnualCosts}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Güncel ekspertiz"
            htmlFor="appraisalValue"
            error={err.appraisalValue}
            hint="Boşsa alış fiyatı kullanılır"
          >
            <MoneyInput
              id="appraisalValue"
              name="appraisalValue"
              currency={currency}
              defaultValue={defaults.appraisalValue}
              error={err.appraisalValue}
              onValueChange={setAppraisal}
            />
          </Field>

          <Field
            label="Ekspertiz tarihi"
            htmlFor="appraisalDate"
            error={err.appraisalDate}
          >
            <DateInput
              id="appraisalDate"
              name="appraisalDate"
              defaultValue={defaults.appraisalDate}
              error={err.appraisalDate}
            />
          </Field>
        </div>

        {preview && (
          <div className="rounded-md border border-line bg-surface px-3 py-2.5">
            <p className="mb-1.5 text-xs font-medium text-ink-muted">Önizleme</p>
            <dl className="num grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
              <div>
                <dt className="text-ink-faint">Değer artışı</dt>
                <dd className={preview.gross >= 0 ? "text-gain" : "text-loss"}>
                  {formatMoney(Money.of(String(preview.gross), currency), {
                    compact: true,
                    signed: true,
                  })}
                </dd>
              </div>
              <div>
                <dt className="text-ink-faint">Taşıma maliyeti</dt>
                <dd className="text-loss">
                  −
                  {formatMoney(Money.of(String(preview.costs), currency), {
                    compact: true,
                  })}
                </dd>
              </div>
              <div>
                <dt className="text-ink-faint">Net sonuç</dt>
                <dd className={preview.net >= 0 ? "text-gain" : "text-loss"}>
                  {formatMoney(Money.of(String(preview.net), currency), {
                    compact: true,
                    signed: true,
                  })}
                </dd>
              </div>
              <div>
                <dt className="text-ink-faint">Yıllık getiri</dt>
                <dd className="text-ink">
                  {preview.annualized !== null
                    ? formatPercent(new Decimal(preview.annualized), {
                        signed: true,
                        decimals: 1,
                      })
                    : "—"}
                </dd>
              </div>
            </dl>
            {preview.costs > 0 && preview.gross > 0 && preview.net < 0 && (
              <p className="mt-1.5 text-pretty text-xs text-warn">
                Değeri artmış ama sigorta ve saklama masrafı kazancı aşmış.
              </p>
            )}
          </div>
        )}

        <PlannedToggle planned={planned} onChange={setPlanned} />

        {!planned && (
          <FundingSource
            cashAccounts={cashAccounts}
            cost={price}
            currency={currency}
            purchaseDate={purchaseDate}
          />
        )}

        <Field label="Not" htmlFor="note" error={err.note}>
          <TextInput id="note" name="note" defaultValue={defaults.note} />
        </Field>

        <p className="text-pretty text-xs text-ink-faint">
          Kıymetli eşya için canlı fiyat kaynağı <strong>yoktur</strong> ve
          modellenmez: bir tablonun değeri bir endeksten türetilemez. Değer ya
          alış fiyatıdır ya da buraya girdiğiniz ekspertiz — panel arada bir
          şey uydurmaz.
        </p>
      </FormShell>
    </form>
  );
}
