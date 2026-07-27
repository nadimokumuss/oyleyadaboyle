"use client";

import { useActionState, useState } from "react";
import { saveSettingsAction } from "@/app/actions/settings";
import type { FormState } from "@/app/actions/assets";
import {
  Field, TextInput, Select, MoneyInput, PercentInput,
} from "@/components/form/Field";
import { SubmitButton } from "@/components/form/Button";

const initial: FormState = {};

export function SettingsForm({
  defaults,
}: {
  defaults: {
    baseCurrency: string;
    monthlyLivingCost: string;
    livingCostCurrency: string;
    riskProfile: string;
    horizonYears: number;
    idleCashThreshold: string;
    concentrationThreshold: string;
    lotMethod: string;
    longTermDays: number;
  };
}) {
  const [state, action] = useActionState(saveSettingsAction, initial);
  const err = state.fieldErrors ?? {};
  const [livingCurrency, setLivingCurrency] = useState(defaults.livingCostCurrency);

  return (
    <form action={action} className="space-y-4">
      {state.error && (
        <p className="rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">
          {state.error}
        </p>
      )}
      {state.savedId && !state.error && (
        <p className="rounded-md border border-gain/40 bg-gain/10 px-3 py-2 text-sm text-gain">
          Ayarlar kaydedildi.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Ana para birimi"
          htmlFor="baseCurrency"
          error={err.baseCurrency}
          hint="Toplam servet bu birimde gösterilir."
        >
          <Select
            id="baseCurrency"
            name="baseCurrency"
            defaultValue={defaults.baseCurrency}
          >
            {["USD", "EUR", "TRY", "GBP", "CHF"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </Field>

        <Field
          label="Aylık yaşam gideri"
          htmlFor="monthlyLivingCost"
          error={err.monthlyLivingCost}
          hint="Pasif gelir kapsama oranı bunu kullanır."
        >
          <MoneyInput
            id="monthlyLivingCost"
            name="monthlyLivingCost"
            currency={livingCurrency}
            defaultValue={defaults.monthlyLivingCost}
            error={err.monthlyLivingCost}
          />
        </Field>

        <Field label="Gider para birimi" htmlFor="livingCostCurrency">
          <Select
            id="livingCostCurrency"
            name="livingCostCurrency"
            value={livingCurrency}
            onChange={(e) => setLivingCurrency(e.target.value)}
          >
            {["USD", "EUR", "TRY", "GBP", "CHF"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Risk profili" htmlFor="riskProfile" error={err.riskProfile}>
          <Select id="riskProfile" name="riskProfile" defaultValue={defaults.riskProfile}>
            <option value="conservative">Temkinli</option>
            <option value="balanced">Dengeli</option>
            <option value="aggressive">Atak</option>
          </Select>
        </Field>

        <Field
          label="Yatırım vadesi (yıl)"
          htmlFor="horizonYears"
          error={err.horizonYears}
          hint="Senaryo projeksiyonu ve dağılım önerisi bu süreyi kullanır."
        >
          <TextInput
            id="horizonYears"
            name="horizonYears"
            type="number"
            min={1}
            max={60}
            defaultValue={defaults.horizonYears}
            error={err.horizonYears}
            className="num"
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Atıl nakit eşiği"
          htmlFor="idleCashThreshold"
          error={err.idleCashThreshold}
          hint="Bu tutarın üzerindeki faizsiz nakit için uyarı üretilir."
        >
          <MoneyInput
            id="idleCashThreshold"
            name="idleCashThreshold"
            currency={defaults.baseCurrency}
            defaultValue={defaults.idleCashThreshold}
            error={err.idleCashThreshold}
          />
        </Field>

        <Field
          label="Yoğunlaşma eşiği"
          htmlFor="concentrationThreshold"
          error={err.concentrationThreshold}
          hint="Tek varlık servetin bu oranını aşarsa risk uyarısı verilir."
        >
          <PercentInput
            id="concentrationThreshold"
            name="concentrationThreshold"
            defaultValue={defaults.concentrationThreshold}
            error={err.concentrationThreshold}
            max={1}
          />
        </Field>
      </div>

      <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
        <Field
          label="Lot seçim yöntemi"
          htmlFor="lotMethod"
          error={err.lotMethod}
          hint="Satışta hangi lot elden çıktı sayılsın. Gerçekleşen kârı doğrudan değiştirir."
        >
          <Select id="lotMethod" name="lotMethod" defaultValue={defaults.lotMethod}>
            <option value="fifo">FIFO — en eski lot önce</option>
            <option value="lifo">LIFO — en yeni lot önce</option>
            <option value="hifo">HIFO — en pahalı lot önce</option>
          </Select>
        </Field>

        <Field
          label="Uzun vade eşiği (gün)"
          htmlFor="longTermDays"
          error={err.longTermDays}
          hint="Vergi raporu kısa/uzun vade ayrımını buna göre yapar."
        >
          <TextInput
            id="longTermDays"
            name="longTermDays"
            type="number"
            min={1}
            max={3650}
            defaultValue={defaults.longTermDays}
            error={err.longTermDays}
            className="num"
          />
        </Field>
      </div>

      <SubmitButton>Ayarları kaydet</SubmitButton>
    </form>
  );
}
