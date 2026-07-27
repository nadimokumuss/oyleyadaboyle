"use client";

import { useActionState, useState } from "react";
import Decimal from "decimal.js";
import { saveBondAction, type FormState } from "@/app/actions/assets";
import { FormShell } from "@/components/form/FormShell";
import { FundingSource, type CashAccount } from "@/components/form/FundingSource";
import {
  Field,
  TextInput,
  Select,
  MoneyInput,
  PercentInput,
  DateInput,
  CurrencySelect,
} from "@/components/form/Field";
import { PlannedToggle } from "./PositionForm";
import { Money, formatMoney, formatPercent } from "@/lib/money";

const initial: FormState = {};

export interface BondDefaults {
  id?: string;
  name?: string;
  issuer?: string;
  currency?: string;
  country?: string;
  faceValue?: string;
  couponRate?: string;
  couponsPerYear?: number;
  purchasePrice?: string;
  purchaseDate?: string;
  maturityDate?: string;
  dayCount?: string;
  marketPricePct?: string;
  withholdingRate?: string;
  status?: string;
  note?: string;
}

const today = () => new Date().toISOString().slice(0, 10);

export function BondForm({
  defaults = {},
  cashAccounts = [],
}: {
  defaults?: BondDefaults;
  cashAccounts?: CashAccount[];
}) {
  const [state, action] = useActionState(saveBondAction, initial);
  const err = state.fieldErrors ?? {};

  const [currency, setCurrency] = useState(defaults.currency ?? "TRY");
  const [planned, setPlanned] = useState(defaults.status === "planned");
  const [faceValue, setFaceValue] = useState(defaults.faceValue ?? "");
  const [couponRate, setCouponRate] = useState(defaults.couponRate ?? "");
  const [couponsPerYear, setCouponsPerYear] = useState(
    String(defaults.couponsPerYear ?? 2),
  );
  const [price, setPrice] = useState(defaults.purchasePrice ?? "");
  const [maturity, setMaturity] = useState(defaults.maturityDate ?? "");
  const [purchaseDate, setPurchaseDate] = useState(defaults.purchaseDate ?? today());

  // --- Canlı önizleme ---
  // Formu doldururken kupon tutarını ve yaklaşık getiriyi görmek,
  // rakamı yanlış girdiğinizi kaydetmeden fark etmenizi sağlar.
  const preview = (() => {
    const face = Number(faceValue);
    const rate = Number(couponRate);
    const perYear = Number(couponsPerYear);
    const paid = Number(price);
    if (!Number.isFinite(face) || face <= 0) return null;

    const annualCoupon = face * (Number.isFinite(rate) ? rate : 0);
    const perCoupon = perYear > 0 ? annualCoupon / perYear : 0;

    let years: number | null = null;
    if (maturity && purchaseDate) {
      const ms = new Date(maturity).getTime() - new Date(purchaseDate).getTime();
      years = ms > 0 ? ms / (365.25 * 86_400_000) : null;
    }

    let ytm: number | null = null;
    if (years && years > 0 && Number.isFinite(paid) && paid > 0) {
      ytm = (annualCoupon + (face - paid) / years) / ((face + paid) / 2);
    }

    const totalCoupons = years && perYear > 0 ? Math.round(years * perYear) : null;

    return { annualCoupon, perCoupon, years, ytm, totalCoupons, paid };
  })();

  return (
    <form action={action}>
      {defaults.id && <input type="hidden" name="id" value={defaults.id} />}
      <input type="hidden" name="status" value={planned ? "planned" : "active"} />

      <FormShell
        title={defaults.id ? "Tahvili düzenle" : "Tahvil ekle"}
        description="Devlet tahvili, hazine bonosu veya özel sektör tahvili."
        error={state.error}
        editingId={defaults.id}
        deleteRedirect="/tahvil"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ad" htmlFor="name" error={err.name}>
            <TextInput
              id="name"
              name="name"
              placeholder="TRT260527T15"
              defaultValue={defaults.name}
              error={err.name}
              required
            />
          </Field>

          <Field label="İhraççı" htmlFor="issuer" error={err.issuer}>
            <TextInput
              id="issuer"
              name="issuer"
              placeholder="T.C. Hazine"
              defaultValue={defaults.issuer}
              error={err.issuer}
              required
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Nominal değer"
            htmlFor="faceValue"
            error={err.faceValue}
            hint="Vadede geri ödenecek tutar"
          >
            <MoneyInput
              id="faceValue"
              name="faceValue"
              currency={currency}
              defaultValue={defaults.faceValue}
              error={err.faceValue}
              onValueChange={setFaceValue}
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
          <Field
            label="Kupon oranı"
            htmlFor="couponRate"
            error={err.couponRate}
            hint="Yıllık. Kuponsuz (iskontolu) tahvilde 0."
          >
            <PercentInput
              id="couponRate"
              name="couponRate"
              defaultValue={defaults.couponRate ?? "0"}
              error={err.couponRate}
              max={2}
              onValueChange={setCouponRate}
            />
          </Field>

          <Field
            label="Yılda kaç kupon"
            htmlFor="couponsPerYear"
            error={err.couponsPerYear}
          >
            <Select
              id="couponsPerYear"
              name="couponsPerYear"
              value={couponsPerYear}
              onChange={(e) => setCouponsPerYear(e.target.value)}
            >
              <option value="0">Kuponsuz (iskontolu)</option>
              <option value="1">Yılda 1</option>
              <option value="2">Yılda 2 (6 ayda bir)</option>
              <option value="4">Yılda 4 (3 ayda bir)</option>
              <option value="12">Yılda 12 (aylık)</option>
            </Select>
          </Field>

          <Field
            label="Kupon stopajı"
            htmlFor="withholdingRate"
            error={err.withholdingRate}
            hint="Kupon gelirinden kesilen"
          >
            <PercentInput
              id="withholdingRate"
              name="withholdingRate"
              defaultValue={defaults.withholdingRate ?? "0"}
              error={err.withholdingRate}
              max={1}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Alış fiyatı"
            htmlFor="purchasePrice"
            error={err.purchasePrice}
            hint="Ödediğiniz tutar"
          >
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

          <Field label="Vade tarihi" htmlFor="maturityDate" error={err.maturityDate}>
            <DateInput
              id="maturityDate"
              name="maturityDate"
              defaultValue={defaults.maturityDate}
              error={err.maturityDate}
              allowFuture
              onChange={(e) => setMaturity(e.target.value)}
              required
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Piyasa temiz fiyatı"
            htmlFor="marketPricePct"
            error={err.marketPricePct}
            hint="Nominalin yüzdesi. Boşsa itfa maliyeti kullanılır."
          >
            <PercentInput
              id="marketPricePct"
              name="marketPricePct"
              defaultValue={defaults.marketPricePct}
              error={err.marketPricePct}
              max={2}
            />
          </Field>

          <Field label="Gün sayımı" htmlFor="dayCount">
            <Select
              id="dayCount"
              name="dayCount"
              defaultValue={defaults.dayCount ?? "ACT/365"}
            >
              <option value="ACT/365">ACT/365</option>
              <option value="ACT/360">ACT/360</option>
              <option value="30/360">30/360</option>
            </Select>
          </Field>
        </div>

        {preview && (
          <div className="rounded-md border border-line bg-surface px-3 py-2.5">
            <p className="mb-1.5 text-xs font-medium text-ink-muted">Önizleme</p>
            <dl className="num grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
              <Preview
                label="Kupon başına"
                value={
                  preview.perCoupon > 0
                    ? formatMoney(Money.of(String(preview.perCoupon), currency))
                    : "kuponsuz"
                }
              />
              <Preview
                label="Yıllık kupon"
                value={formatMoney(Money.of(String(preview.annualCoupon), currency), {
                  compact: true,
                })}
              />
              <Preview
                label="Vadeye"
                value={preview.years ? `${preview.years.toFixed(1)} yıl` : "—"}
              />
              <Preview
                label="Yaklaşık YTM"
                value={
                  preview.ytm !== null
                    ? formatPercent(new Decimal(preview.ytm), { decimals: 2 })
                    : "—"
                }
                tone={preview.ytm !== null && preview.ytm > 0 ? "gain" : undefined}
              />
            </dl>
            {preview.totalCoupons !== null && preview.totalCoupons > 0 && (
              <p className="mt-1.5 text-xs text-ink-faint">
                Vadeye kadar {preview.totalCoupons} kupon ödemesi alacaksınız.
              </p>
            )}
            <p className="mt-1.5 text-pretty text-xs text-ink-faint">
              YTM yaklaşık formülle hesaplanır ve kuponların yeniden yatırıldığını
              varsayar.
            </p>
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
      </FormShell>
    </form>
  );
}

function Preview({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "gain";
}) {
  return (
    <div>
      <dt className="truncate text-ink-faint">{label}</dt>
      <dd className={tone === "gain" ? "text-gain" : "text-ink"}>{value}</dd>
    </div>
  );
}
