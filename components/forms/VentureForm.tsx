"use client";

import { useActionState, useState } from "react";
import Decimal from "decimal.js";
import { saveVentureAction, type FormState } from "@/app/actions/assets";
import { FormShell } from "@/components/form/FormShell";
import { FundingSource, type CashAccount } from "@/components/form/FundingSource";
import {
  Field, TextInput, Select, MoneyInput, PercentInput,
} from "@/components/form/Field";
import { PlannedToggle } from "./PositionForm";
import { Money, formatMoney, formatNumber } from "@/lib/money";

const initial: FormState = {};

export interface VentureDefaults {
  id?: string;
  name?: string;
  legalName?: string;
  country?: string;
  currency?: string;
  sector?: string;
  stage?: string;
  ownershipPct?: string;
  committedCapital?: string;
  calledCapital?: string;
  valuation?: string;
  valuationDate?: string;
  monthlyRevenue?: string;
  monthlyBurn?: string;
  cashOnHand?: string;
  status?: string;
  note?: string;
}

export function VentureForm({
  defaults = {},
  cashAccounts = [],
}: {
  defaults?: VentureDefaults;
  cashAccounts?: CashAccount[];
}) {
  const [state, action] = useActionState(saveVentureAction, initial);
  const err = state.fieldErrors ?? {};

  const [currency, setCurrency] = useState(defaults.currency ?? "USD");
  const [planned, setPlanned] = useState(defaults.status === "planned");

  const [revenue, setRevenue] = useState(defaults.monthlyRevenue ?? "");
  const [burn, setBurn] = useState(defaults.monthlyBurn ?? "");
  const [cash, setCash] = useState(defaults.cashOnHand ?? "");
  const [valuation, setValuation] = useState(defaults.valuation ?? "");
  const [ownership, setOwnership] = useState(defaults.ownershipPct ?? "");
  const [called, setCalled] = useState(defaults.calledCapital ?? "");

  const live = computeLive({ revenue, burn, cash, valuation, ownership, called, currency });

  return (
    <form action={action}>
      <FormShell
        title={defaults.id ? "Girişimi düzenle" : "Girişim ekle"}
        description="Girişimlerde asıl soru kâr değil, ne kadar zaman kaldığıdır. Runway burada hesaplanır."
        error={state.error}
        editingId={defaults.id}
        deleteRedirect="/girisim"
      >
        {defaults.id && <input type="hidden" name="id" value={defaults.id} />}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Kısa ad" htmlFor="name" required error={err.name}>
            <TextInput
              id="name"
              name="name"
              required
              autoFocus
              placeholder="Örn. Lojistik SaaS"
              defaultValue={defaults.name}
              error={err.name}
            />
          </Field>

          <Field label="Ticari unvan" htmlFor="legalName" required error={err.legalName}>
            <TextInput
              id="legalName"
              name="legalName"
              required
              placeholder="Rota Teknoloji A.Ş."
              defaultValue={defaults.legalName}
              error={err.legalName}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
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

          <Field label="Para birimi" htmlFor="currency" error={err.currency}>
            <Select
              id="currency"
              name="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {["USD", "EUR", "TRY", "GBP"].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>

          <Field label="Sektör" htmlFor="sector" error={err.sector}>
            <TextInput
              id="sector"
              name="sector"
              placeholder="SaaS"
              defaultValue={defaults.sector ?? ""}
            />
          </Field>

          <Field label="Aşama" htmlFor="stage" error={err.stage}>
            <Select id="stage" name="stage" defaultValue={defaults.stage ?? ""}>
              <option value="">—</option>
              {["fikir", "pre-seed", "seed", "A", "B", "C+"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </Field>
        </div>

        <fieldset className="space-y-4 border-t border-line pt-5">
          <legend className="mb-1 text-sm font-medium text-ink">Sermaye</legend>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Sahiplik oranı"
              htmlFor="ownershipPct"
              required
              error={err.ownershipPct}
            >
              <PercentInput
                id="ownershipPct"
                name="ownershipPct"
                defaultValue={defaults.ownershipPct}
                error={err.ownershipPct}
                max={1}
                onValueChange={setOwnership}
              />
            </Field>

            <Field
              label="Taahhüt edilen sermaye"
              htmlFor="committedCapital"
              required
              error={err.committedCapital}
            >
              <MoneyInput
                id="committedCapital"
                name="committedCapital"
                currency={currency}
                required
                defaultValue={defaults.committedCapital}
                error={err.committedCapital}
              />
            </Field>

            <Field
              label="Şu ana kadar ödenen"
              htmlFor="calledCapital"
              error={err.calledCapital}
            >
              <MoneyInput
                id="calledCapital"
                name="calledCapital"
                currency={currency}
                defaultValue={defaults.calledCapital}
                error={err.calledCapital}
                onValueChange={setCalled}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Son tur değerlemesi"
              htmlFor="valuation"
              error={err.valuation}
              hint="Şirketin tamamının değeri. Payınız buradan hesaplanır."
            >
              <MoneyInput
                id="valuation"
                name="valuation"
                currency={currency}
                defaultValue={defaults.valuation}
                error={err.valuation}
                onValueChange={setValuation}
              />
            </Field>

            <Field label="Değerleme tarihi" htmlFor="valuationDate" error={err.valuationDate}>
              <TextInput
                id="valuationDate"
                name="valuationDate"
                type="date"
                defaultValue={defaults.valuationDate ?? ""}
                error={err.valuationDate}
                className="num"
              />
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-4 border-t border-line pt-5">
          <legend className="mb-1 text-sm font-medium text-ink">İşletme</legend>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Aylık gelir" htmlFor="monthlyRevenue" error={err.monthlyRevenue}>
              <MoneyInput
                id="monthlyRevenue"
                name="monthlyRevenue"
                currency={currency}
                defaultValue={defaults.monthlyRevenue}
                error={err.monthlyRevenue}
                onValueChange={setRevenue}
              />
            </Field>

            <Field label="Aylık gider" htmlFor="monthlyBurn" error={err.monthlyBurn}>
              <MoneyInput
                id="monthlyBurn"
                name="monthlyBurn"
                currency={currency}
                defaultValue={defaults.monthlyBurn}
                error={err.monthlyBurn}
                onValueChange={setBurn}
              />
            </Field>

            <Field
              label="Kasadaki nakit"
              htmlFor="cashOnHand"
              error={err.cashOnHand}
              hint="Runway bunu kullanır."
            >
              <MoneyInput
                id="cashOnHand"
                name="cashOnHand"
                currency={currency}
                defaultValue={defaults.cashOnHand}
                error={err.cashOnHand}
                onValueChange={setCash}
              />
            </Field>
          </div>
        </fieldset>

        {live && (
          <div
            className={
              "rounded-md border px-4 py-3 " +
              (live.critical
                ? "border-loss/50 bg-loss/10"
                : live.warning
                  ? "border-warn/50 bg-warn/10"
                  : "border-accent/40 bg-accent/5")
            }
          >
            <p className="text-xs font-medium text-ink">Anlık durum</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-4">
              {live.items.map((i) => (
                <div key={i.label}>
                  <dt className="truncate text-xs text-ink-faint">{i.label}</dt>
                  <dd className={`num mt-0.5 font-medium ${i.className}`}>{i.value}</dd>
                </div>
              ))}
            </dl>
            {live.message && (
              <p className="mt-2 text-pretty text-xs text-ink-muted">{live.message}</p>
            )}
          </div>
        )}

        {!planned && (
          <FundingSource
            cashAccounts={cashAccounts}
            cost={called || "0"}
            currency={currency}
            purchaseDate={new Date().toISOString().slice(0, 10)}
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

function computeLive(v: {
  revenue: string;
  burn: string;
  cash: string;
  valuation: string;
  ownership: string;
  called: string;
  currency: string;
}) {
  try {
    const revenue = new Decimal(v.revenue || 0);
    const burn = new Decimal(v.burn || 0);
    const cash = new Decimal(v.cash || 0);
    if (burn.isZero() && revenue.isZero() && cash.isZero()) return null;

    const net = burn.minus(revenue);
    const profitable = net.lessThanOrEqualTo(0);
    const runway = profitable || net.isZero() ? null : cash.dividedBy(net);

    const items: Array<{ label: string; value: string; className: string }> = [];

    items.push({
      label: profitable ? "Aylık kâr" : "Net yakım",
      value: formatMoney(Money.of(net.abs().toFixed(), v.currency), { compact: true }),
      className: profitable ? "text-gain" : "text-loss",
    });

    items.push({
      label: "Runway",
      value: profitable
        ? "sınırsız"
        : runway
          ? `${formatNumber(runway, 1)} ay`
          : "—",
      className:
        profitable
          ? "text-gain"
          : runway && runway.lessThan(3)
            ? "text-loss"
            : runway && runway.lessThan(6)
              ? "text-warn"
              : "text-ink",
    });

    if (!burn.isZero()) {
      const progress = revenue.dividedBy(burn);
      items.push({
        label: "Başabaşa ilerleme",
        value: `%${progress.times(100).toDecimalPlaces(0).toFixed()}`,
        className: progress.greaterThanOrEqualTo(1) ? "text-gain" : "text-ink",
      });
    }

    const valuation = new Decimal(v.valuation || 0);
    const ownership = new Decimal(v.ownership || 0);
    if (valuation.greaterThan(0) && ownership.greaterThan(0)) {
      const position = valuation.times(ownership);
      const called = new Decimal(v.called || 0);
      items.push({
        label: "Payınızın değeri",
        value: formatMoney(Money.of(position.toFixed(), v.currency), { compact: true }),
        className: "text-ink",
      });
      if (called.greaterThan(0)) {
        const moic = position.dividedBy(called);
        items.push({
          label: "Katlanma (MOIC)",
          value: `${formatNumber(moic, 2)}×`,
          className: moic.greaterThan(1) ? "text-gain" : "text-loss",
        });
      }
    }

    const critical = Boolean(runway && runway.lessThan(3));
    const warning = Boolean(runway && runway.lessThan(6) && !critical);

    let message: string | null = null;
    if (critical) {
      message =
        "Runway 3 aydan az. Ya gideri kısın, ya geliri hızlandırın, ya da sermaye çağrısı planlayın.";
    } else if (warning) {
      message = "Runway 6 aydan az — sermaye görüşmelerine şimdiden başlamakta fayda var.";
    } else if (profitable && !net.isZero()) {
      message = "Girişim kendi kendini finanse ediyor.";
    }

    return { items, critical, warning, message };
  } catch {
    return null;
  }
}
