"use client";

import { useActionState, useState } from "react";
import Decimal from "decimal.js";
import { saveDepositAction, type FormState } from "@/app/actions/assets";
import { FormShell } from "@/components/form/FormShell";
import { FundingSource, type CashAccount } from "@/components/form/FundingSource";
import {
  Field, TextInput, Select, MoneyInput, PercentInput,
} from "@/components/form/Field";
import { Money, formatMoney } from "@/lib/money";
import { balanceAt, yearFraction, type DepositTerms } from "@/lib/finance/deposit";

const initial: FormState = {};

export interface DepositDefaults {
  id?: string;
  name?: string;
  currency?: string;
  principal?: string;
  annualRate?: string;
  compounding?: string;
  dayCount?: string;
  startDate?: string;
  maturityDate?: string;
  note?: string;
}

/**
 * Mevduat formu.
 *
 * Kullanıcı yazarken vade sonunda ne alacağını canlı gösteriyor —
 * mevduat kararının tamamı bu sayıya bakıyor, formu gönderip sonucu
 * görmek için beklemek gereksiz.
 */
export function DepositForm({
  defaults = {},
  cashAccounts = [],
}: {
  defaults?: DepositDefaults;
  cashAccounts?: CashAccount[];
}) {
  const [state, action] = useActionState(saveDepositAction, initial);
  const err = state.fieldErrors ?? {};

  const [currency, setCurrency] = useState(defaults.currency ?? "TRY");
  const [principal, setPrincipal] = useState(defaults.principal ?? "");
  const [rate, setRate] = useState(defaults.annualRate ?? "");
  const [compounding, setCompounding] = useState(defaults.compounding ?? "simple");
  const [startDate, setStartDate] = useState(
    defaults.startDate ?? new Date().toISOString().slice(0, 10),
  );
  const [maturityDate, setMaturityDate] = useState(defaults.maturityDate ?? "");

  const preview = buildPreview({
    principal, rate, compounding, currency, startDate, maturityDate,
  });

  return (
    <form action={action}>
      <FormShell
        title={defaults.id ? "Mevduatı düzenle" : "Mevduat ekle"}
        description="Faiz kazancı formülle hesaplanır ve panelde saniye saniye akar."
        error={state.error}
        editingId={defaults.id}
        deleteRedirect="/mevduat"
      >
        {defaults.id && <input type="hidden" name="id" value={defaults.id} />}

        <Field label="İsim" htmlFor="name" required error={err.name}>
          <TextInput
            id="name"
            name="name"
            required
            autoFocus
            placeholder="Örn. Garanti 3 aylık TL vadeli"
            defaultValue={defaults.name}
            error={err.name}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Anapara" htmlFor="principal" required error={err.principal}>
            <MoneyInput
              id="principal"
              name="principal"
              currency={currency}
              required
              defaultValue={defaults.principal}
              error={err.principal}
              onValueChange={setPrincipal}
            />
          </Field>

          <Field label="Para birimi" htmlFor="currency" error={err.currency}>
            <Select
              id="currency"
              name="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {["TRY", "USD", "EUR", "GBP", "CHF", "AED"].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>

          <Field
            label="Yıllık brüt faiz"
            htmlFor="annualRate"
            required
            error={err.annualRate}
          >
            <PercentInput
              id="annualRate"
              name="annualRate"
              defaultValue={defaults.annualRate}
              error={err.annualRate}
              max={1}
              onValueChange={setRate}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Faiz işleyişi"
            htmlFor="compounding"
            error={err.compounding}
            hint="Bankanız hangisini uyguluyorsa onu seçin — sonuç ciddi şekilde değişir."
          >
            <Select
              id="compounding"
              name="compounding"
              value={compounding}
              onChange={(e) => setCompounding(e.target.value)}
            >
              <option value="simple">Basit faiz (vade sonu tek ödeme)</option>
              <option value="monthly">Aylık bileşik</option>
              <option value="quarterly">3 aylık bileşik</option>
              <option value="daily">Günlük bileşik</option>
              <option value="annual">Yıllık bileşik</option>
              <option value="continuous">Sürekli bileşik</option>
            </Select>
          </Field>

          <Field
            label="Gün sayımı"
            htmlFor="dayCount"
            error={err.dayCount}
            hint="Türkiye'de genelde ACT/365 kullanılır."
          >
            <Select
              id="dayCount"
              name="dayCount"
              defaultValue={defaults.dayCount ?? "ACT/365"}
            >
              <option value="ACT/365">ACT/365 — gerçek gün / 365</option>
              <option value="ACT/360">ACT/360 — gerçek gün / 360</option>
              <option value="30/360">30/360 — her ay 30 gün</option>
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Başlangıç tarihi" htmlFor="startDate" required error={err.startDate}>
            <TextInput
              id="startDate"
              name="startDate"
              type="date"
              required
              defaultValue={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              error={err.startDate}
              className="num"
            />
          </Field>

          <Field
            label="Vade tarihi"
            htmlFor="maturityDate"
            error={err.maturityDate}
            hint="Boş bırakırsanız vadesiz sayılır."
          >
            <TextInput
              id="maturityDate"
              name="maturityDate"
              type="date"
              defaultValue={defaults.maturityDate ?? ""}
              onChange={(e) => setMaturityDate(e.target.value)}
              error={err.maturityDate}
              className="num"
            />
          </Field>
        </div>

        {preview && (
          <div className="rounded-md border border-accent/40 bg-accent/5 px-4 py-3">
            <p className="text-xs font-medium text-ink">Vade sonu tahmini</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-4">
              <Preview label="Gün" value={preview.days} />
              <Preview label="Brüt faiz" value={preview.gross} />
              <Preview label="Stopaj (%15 varsayım)" value={preview.tax} tone="loss" />
              <Preview label="Ele geçecek" value={preview.net} tone="gain" />
            </dl>
            <p className="mt-2 text-pretty text-xs text-ink-faint">
              Stopaj burada %15 varsayılmıştır; kaydettikten sonra vade ve para
              birimine göre gerçek oran uygulanır.
            </p>
          </div>
        )}

                <FundingSource
          cashAccounts={cashAccounts}
          cost={principal || "0"}
          currency={currency}
          purchaseDate={startDate}
        />

        <Field label="Not" htmlFor="note" error={err.note}>
          <TextInput id="note" name="note" defaultValue={defaults.note ?? ""} />
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
  tone?: "gain" | "loss";
}) {
  return (
    <div>
      <dt className="truncate text-xs text-ink-faint">{label}</dt>
      <dd
        className={
          "num mt-0.5 font-medium " +
          (tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : "text-ink")
        }
      >
        {value}
      </dd>
    </div>
  );
}

function buildPreview(v: {
  principal: string;
  rate: string;
  compounding: string;
  currency: string;
  startDate: string;
  maturityDate: string;
}): { days: string; gross: string; tax: string; net: string } | null {
  if (!v.principal || !v.rate || !v.maturityDate || !v.startDate) return null;

  try {
    const start = new Date(v.startDate + "T00:00:00Z");
    const end = new Date(v.maturityDate + "T00:00:00Z");
    if (!(end > start)) return null;

    const terms: DepositTerms = {
      principal: Money.of(v.principal, v.currency),
      annualRate: new Decimal(v.rate),
      compounding: v.compounding as DepositTerms["compounding"],
      dayCount: "ACT/365",
      startDate: start,
      maturityDate: end,
      withholdingRate: new Decimal("0.15"),
    };

    const balance = balanceAt(terms, end);
    const gross = balance.minus(terms.principal);
    const tax = gross.times("0.15");
    const net = gross.minus(tax);

    const days = Math.round(
      yearFraction(start, end, "ACT/365").times(365).toNumber(),
    );

    return {
      days: String(days),
      gross: formatMoney(gross, { compact: true }),
      tax: formatMoney(tax.negated(), { compact: true }),
      net: formatMoney(terms.principal.plus(net), { compact: true }),
    };
  } catch {
    return null;
  }
}
