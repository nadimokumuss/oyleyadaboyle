"use client";

import { useActionState, useState } from "react";
import Decimal from "decimal.js";
import { saveVehicleAction, type FormState } from "@/app/actions/assets";
import { FormShell } from "@/components/form/FormShell";
import { FundingSource, type CashAccount } from "@/components/form/FundingSource";
import { Field, TextInput, Select, MoneyInput } from "@/components/form/Field";
import { PlannedToggle } from "./PositionForm";
import { Money, formatMoney, formatPercent } from "@/lib/money";
import depreciation from "@/db/seeds/depreciation.json";

const initial: FormState = {};

const SEGMENTS = depreciation.segments as unknown as Record<
  string,
  { label: string; lambda: number; residualFloor: number; note?: string }
>;

export interface VehicleDefaults {
  id?: string;
  name?: string;
  make?: string;
  model?: string;
  year?: number;
  odometer?: number;
  country?: string;
  currency?: string;
  segment?: string;
  purchasePrice?: string;
  purchaseDate?: string;
  manualValue?: string;
  insurance?: string;
  tax?: string;
  maintenance?: string;
  fuel?: string;
  status?: string;
  note?: string;
}

export function VehicleForm({
  defaults = {},
  cashAccounts = [],
}: {
  defaults?: VehicleDefaults;
  cashAccounts?: CashAccount[];
}) {
  const [state, action] = useActionState(saveVehicleAction, initial);
  const err = state.fieldErrors ?? {};

  const [currency, setCurrency] = useState(defaults.currency ?? "TRY");
  const [planned, setPlanned] = useState(defaults.status === "planned");
  const [segment, setSegment] = useState(defaults.segment ?? "mid");
  const [price, setPrice] = useState(defaults.purchasePrice ?? "");

  const forecast = buildForecast(price, segment, currency);

  return (
    <form action={action}>
      <FormShell
        title={defaults.id ? "Aracı düzenle" : "Araç ekle"}
        description="Değer, segmente göre amortisman eğrisiyle modellenir. Aracın asıl maliyeti değer kaybı artı taşıma giderleridir."
        error={state.error}
        editingId={defaults.id}
        deleteRedirect="/arac"
      >
        {defaults.id && <input type="hidden" name="id" value={defaults.id} />}

        <Field label="İsim" htmlFor="name" required error={err.name}>
          <TextInput
            id="name"
            name="name"
            required
            autoFocus
            placeholder="Örn. Günlük araba"
            defaultValue={defaults.name}
            error={err.name}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Marka" htmlFor="make" required error={err.make}>
            <TextInput
              id="make"
              name="make"
              required
              placeholder="Toyota"
              defaultValue={defaults.make}
              error={err.make}
            />
          </Field>

          <Field label="Model" htmlFor="model" required error={err.model}>
            <TextInput
              id="model"
              name="model"
              required
              placeholder="Corolla Hybrid"
              defaultValue={defaults.model}
              error={err.model}
            />
          </Field>

          <Field
            label="Model yılı"
            htmlFor="year"
            required
            error={err.year}
            hint="Amortisman aracın kendi yaşına göre işler."
          >
            <TextInput
              id="year"
              name="year"
              type="number"
              min={1900}
              max={new Date().getFullYear() + 2}
              required
              defaultValue={defaults.year ?? new Date().getFullYear()}
              error={err.year}
              className="num"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Segment"
            htmlFor="segment"
            error={err.segment}
            hint={SEGMENTS[segment]?.note}
          >
            <Select
              id="segment"
              name="segment"
              value={segment}
              onChange={(e) => setSegment(e.target.value)}
              error={err.segment}
            >
              {Object.entries(SEGMENTS).map(([key, v]) => (
                <option key={key} value={key}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Kilometre" htmlFor="odometer" error={err.odometer}>
            <TextInput
              id="odometer"
              name="odometer"
              type="number"
              min={0}
              defaultValue={defaults.odometer ?? 0}
              error={err.odometer}
              className="num text-right"
            />
          </Field>

          <Field label="Ülke" htmlFor="country" required error={err.country}>
            <TextInput
              id="country"
              name="country"
              maxLength={2}
              required
              placeholder="TR"
              defaultValue={defaults.country ?? "TR"}
              error={err.country}
              className="uppercase"
            />
          </Field>
        </div>

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

        {forecast && (
          <div className="rounded-md border border-accent/40 bg-accent/5 px-4 py-3">
            <p className="text-xs font-medium text-ink">Tahmini değer kaybı</p>
            <dl className="mt-2 grid grid-cols-3 gap-x-4 gap-y-1.5 text-sm">
              {forecast.points.map((p) => (
                <div key={p.label}>
                  <dt className="text-xs text-ink-faint">{p.label}</dt>
                  <dd className="num mt-0.5 font-medium text-ink">{p.value}</dd>
                  <dd className="num text-xs text-loss">{p.change}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        <fieldset className="space-y-4 border-t border-line pt-5">
          <legend className="mb-1 text-sm font-medium text-ink">
            Yıllık taşıma giderleri
          </legend>
          <div className="grid gap-4 sm:grid-cols-4">
            {([
              ["insurance", "Sigorta", defaults.insurance],
              ["tax", "Vergi", defaults.tax],
              ["maintenance", "Bakım", defaults.maintenance],
              ["fuel", "Yakıt", defaults.fuel],
            ] as const).map(([field, label, dv]) => (
              <Field key={field} label={label} htmlFor={field} error={err[field]}>
                <MoneyInput
                  id={field}
                  name={field}
                  currency={currency}
                  defaultValue={dv}
                  error={err[field]}
                />
              </Field>
            ))}
          </div>
        </fieldset>

        <Field
          label="Güncel piyasa değeri"
          htmlFor="manualValue"
          error={err.manualValue}
          hint="Girerseniz amortisman modeli devre dışı kalır."
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
            cost={price || "0"}
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

/** Seçilen segmentin eğrisiyle 1, 3 ve 5 yıl sonraki değeri gösterir. */
function buildForecast(price: string, segment: string, currency: string) {
  try {
    if (!price) return null;
    const p = new Decimal(price);
    if (p.lessThanOrEqualTo(0)) return null;

    const curve = SEGMENTS[segment];
    if (!curve) return null;

    const lambda = new Decimal(curve.lambda);
    const floor = new Decimal(curve.residualFloor);

    const points = [1, 3, 5].map((years) => {
      const factor = Decimal.max(floor, lambda.negated().times(years).exp());
      const value = p.times(factor);
      const change = value.minus(p).dividedBy(p);
      return {
        label: `${years}. yıl`,
        value: formatMoney(Money.of(value.toFixed(), currency), { compact: true }),
        change: formatPercent(change, { signed: true, decimals: 0 }),
      };
    });

    return { points };
  } catch {
    return null;
  }
}
