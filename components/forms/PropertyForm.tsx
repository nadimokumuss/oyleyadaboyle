"use client";

import { useActionState, useState } from "react";
import Decimal from "decimal.js";
import { savePropertyAction, type FormState } from "@/app/actions/assets";
import { FormShell } from "@/components/form/FormShell";
import { FundingSource, type CashAccount } from "@/components/form/FundingSource";
import {
  Field, TextInput, Select, MoneyInput, PercentInput,
} from "@/components/form/Field";
import { LocationPicker } from "@/components/pickers/LocationPicker";
import { PlannedToggle } from "./PositionForm";
import { Money, formatMoney, formatPercent } from "@/lib/money";

const initial: FormState = {};

export interface PropertyDefaults {
  id?: string;
  name?: string;
  city?: string;
  country?: string;
  lat?: number | null;
  lng?: number | null;
  indexKey?: string;
  currency?: string;
  purchasePrice?: string;
  purchaseDate?: string;
  closingCosts?: string;
  renovationCost?: string;
  manualValue?: string;
  monthlyRent?: string;
  occupancyRate?: string;
  hoa?: string;
  propertyTax?: string;
  insurance?: string;
  maintenance?: string;
  status?: string;
  note?: string;
}

export function PropertyForm({
  defaults = {},
  cashAccounts = [],
}: {
  defaults?: PropertyDefaults;
  cashAccounts?: CashAccount[];
}) {
  const [state, action] = useActionState(savePropertyAction, initial);
  const err = state.fieldErrors ?? {};

  const [currency, setCurrency] = useState(defaults.currency ?? "TRY");
  const [planned, setPlanned] = useState(defaults.status === "planned");

  const [price, setPrice] = useState(defaults.purchasePrice ?? "");
  const [closing, setClosing] = useState(defaults.closingCosts ?? "");
  const [renovation, setRenovation] = useState(defaults.renovationCost ?? "");
  const [rent, setRent] = useState(defaults.monthlyRent ?? "");
  const [costs, setCosts] = useState({
    hoa: defaults.hoa ?? "",
    tax: defaults.propertyTax ?? "",
    insurance: defaults.insurance ?? "",
    maintenance: defaults.maintenance ?? "",
  });

  const yieldInfo = computeYield({ price, closing, renovation, rent, costs, currency });

  return (
    <form action={action}>
      <FormShell
        title={defaults.id ? "Gayrimenkulü düzenle" : "Gayrimenkul ekle"}
        description="Konumu haritadan seçin. Değer, bölgesel konut fiyat endeksiyle modellenir — canlı piyasa fiyatı değildir."
        error={state.error}
        editingId={defaults.id}
        deleteRedirect="/gayrimenkul"
      >
        {defaults.id && <input type="hidden" name="id" value={defaults.id} />}

        <Field label="İsim" htmlFor="name" required error={err.name}>
          <TextInput
            id="name"
            name="name"
            required
            autoFocus
            placeholder="Örn. Bodrum yazlık"
            defaultValue={defaults.name}
            error={err.name}
          />
        </Field>

        <Field label="Konum" required error={err.city ?? err.country}>
          <LocationPicker
            defaultCity={defaults.city}
            defaultCountry={defaults.country}
            defaultLat={defaults.lat}
            defaultLng={defaults.lng}
            defaultIndexKey={defaults.indexKey}
            error={err.city}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Alış fiyatı" htmlFor="purchasePrice" required error={err.purchasePrice}>
            <MoneyInput
              id="purchasePrice"
              name="purchasePrice"
              currency={currency}
              required
              defaultValue={defaults.purchasePrice}
              error={err.purchasePrice}
              onValueChange={setPrice}
            />
          </Field>

          <Field label="Para birimi" htmlFor="currency" error={err.currency}>
            <Select
              id="currency"
              name="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {["TRY", "USD", "EUR", "GBP", "AED", "CHF"].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>

          <Field
            label={planned ? "Planlanan alış tarihi" : "Alış tarihi"}
            htmlFor="purchaseDate"
            required
            error={err.purchaseDate}
          >
            <TextInput
              id="purchaseDate"
              name="purchaseDate"
              type="date"
              required
              defaultValue={defaults.purchaseDate ?? new Date().toISOString().slice(0, 10)}
              error={err.purchaseDate}
              className="num"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Tapu, komisyon ve vergiler"
            htmlFor="closingCosts"
            error={err.closingCosts}
            hint="Gerçek maliyete eklenir — kâr buna göre ölçülür."
          >
            <MoneyInput
              id="closingCosts"
              name="closingCosts"
              currency={currency}
              defaultValue={defaults.closingCosts}
              error={err.closingCosts}
              onValueChange={setClosing}
            />
          </Field>

          <Field label="Tadilat gideri" htmlFor="renovationCost" error={err.renovationCost}>
            <MoneyInput
              id="renovationCost"
              name="renovationCost"
              currency={currency}
              defaultValue={defaults.renovationCost}
              error={err.renovationCost}
              onValueChange={setRenovation}
            />
          </Field>
        </div>

        <fieldset className="space-y-4 border-t border-line pt-5">
          <legend className="mb-1 text-sm font-medium text-ink">Kira</legend>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Aylık kira geliri"
              htmlFor="monthlyRent"
              error={err.monthlyRent}
              hint="Kiraya vermiyorsanız boş bırakın."
            >
              <MoneyInput
                id="monthlyRent"
                name="monthlyRent"
                currency={currency}
                defaultValue={defaults.monthlyRent}
                error={err.monthlyRent}
                onValueChange={setRent}
              />
            </Field>

            <Field
              label="Doluluk oranı"
              htmlFor="occupancyRate"
              error={err.occupancyRate}
              hint="Yılın ne kadarı kirada? %92 tipik bir değerdir."
            >
              <PercentInput
                id="occupancyRate"
                name="occupancyRate"
                defaultValue={defaults.occupancyRate ?? "1"}
                error={err.occupancyRate}
                max={1}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            {([
              ["hoa", "Aidat", defaults.hoa],
              ["propertyTax", "Emlak vergisi", defaults.propertyTax],
              ["insurance", "Sigorta", defaults.insurance],
              ["maintenance", "Bakım", defaults.maintenance],
            ] as const).map(([field, label, dv]) => (
              <Field key={field} label={label} htmlFor={field} error={err[field]}>
                <MoneyInput
                  id={field}
                  name={field}
                  currency={currency}
                  defaultValue={dv}
                  error={err[field]}
                  onValueChange={(v) =>
                    setCosts((c) => ({
                      ...c,
                      [field === "propertyTax" ? "tax" : field]: v,
                    }))
                  }
                />
              </Field>
            ))}
          </div>
          <p className="-mt-2 text-xs text-ink-faint">Aylık tutarlar.</p>
        </fieldset>

        {yieldInfo && (
          <div className="rounded-md border border-accent/40 bg-accent/5 px-4 py-3">
            <p className="text-xs font-medium text-ink">Kira verimi tahmini</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-ink-faint">Gerçek maliyet</dt>
                <dd className="num mt-0.5 font-medium text-ink">{yieldInfo.totalCost}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-faint">Yıllık net kira</dt>
                <dd
                  className={
                    "num mt-0.5 font-medium " +
                    (yieldInfo.negative ? "text-loss" : "text-gain")
                  }
                >
                  {yieldInfo.annualNet}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-faint">Maliyete göre verim</dt>
                <dd
                  className={
                    "num mt-0.5 font-medium " +
                    (yieldInfo.negative ? "text-loss" : "text-gain")
                  }
                >
                  {yieldInfo.yieldPct}
                </dd>
              </div>
            </dl>
            {yieldInfo.negative && (
              <p className="mt-2 text-pretty text-xs text-loss">
                Giderler kirayı aşıyor — bu mülk kira tarafında zarar ettiriyor.
                Değer artışının bunu telafi etmesi gerekir.
              </p>
            )}
          </div>
        )}

        <Field
          label="Güncel ekspertiz değeri"
          htmlFor="manualValue"
          error={err.manualValue}
          hint="Elinizde bir değerleme varsa girin; model yerine bu kullanılır ve sonrası buradan endekslenir."
        >
          <MoneyInput
            id="manualValue"
            name="manualValue"
            currency={currency}
            defaultValue={defaults.manualValue}
            error={err.manualValue}
          />
        </Field>

        {!planned && (
          <FundingSource
            cashAccounts={cashAccounts}
            cost={String(Number(price||0) + Number(closing||0) + Number(renovation||0))}
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

function computeYield(v: {
  price: string;
  closing: string;
  renovation: string;
  rent: string;
  costs: { hoa: string; tax: string; insurance: string; maintenance: string };
  currency: string;
}) {
  try {
    if (!v.price) return null;
    const price = new Decimal(v.price || 0);
    if (price.lessThanOrEqualTo(0)) return null;

    const totalCost = price
      .plus(v.closing || 0)
      .plus(v.renovation || 0);

    const monthlyCosts = Object.values(v.costs).reduce(
      (a, x) => a.plus(x || 0),
      new Decimal(0),
    );
    const annualNet = new Decimal(v.rent || 0).minus(monthlyCosts).times(12);
    const ratio = annualNet.dividedBy(totalCost);

    return {
      totalCost: formatMoney(Money.of(totalCost.toFixed(), v.currency), { compact: true }),
      annualNet: formatMoney(Money.of(annualNet.toFixed(), v.currency), {
        compact: true,
        signed: true,
      }),
      yieldPct: formatPercent(ratio, { decimals: 2, signed: true }),
      negative: annualNet.isNegative(),
    };
  } catch {
    return null;
  }
}
