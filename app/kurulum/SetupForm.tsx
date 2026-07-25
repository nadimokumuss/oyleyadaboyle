"use client";

import { useActionState, useState } from "react";
import { completeSetup, type ActionState } from "@/app/actions/auth";
import {
  Field, TextInput, Select, MoneyInput, CurrencySelect,
} from "@/components/form/Field";
import { SubmitButton } from "@/components/form/Button";

const initial: ActionState = {};

export function SetupForm({ minLength = 4 }: { minLength?: number }) {
  const [state, action] = useActionState(completeSetup, initial);
  const err = state.fieldErrors ?? {};
  const [pin, setPin] = useState("");

  // Kaba güç göstergesi — uzunluk ağırlıklı
  const strength =
    (pin.length >= 8 ? 1 : 0) +
    (pin.length >= 12 ? 1 : 0) +
    (pin.length >= 16 ? 1 : 0) +
    (/[^a-zA-Z0-9]/.test(pin) || /\s/.test(pin) ? 1 : 0);
  const LABELS = ["Çok zayıf", "Zayıf", "Orta", "İyi", "Güçlü"];

  return (
    <form action={action} className="space-y-5 rounded-lg border border-line bg-surface-raised p-6">
      {state.error && (
        <p className="rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">
          {state.error}
        </p>
      )}

      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-medium text-ink">Kilit</legend>

        <Field
          label="Parola belirleyin"
          htmlFor="pin"
          required
          error={err.pin}
          hint={
            minLength > 4
              ? `En az ${minLength} karakter. Uzun bir cümle ("kirmizi kedi merdivende uyudu") kısa ve karmaşık bir paroladan çok daha güçlüdür.`
              : "En az 4 karakter. Bilgisayarınıza erişen birinin servetinizi görmesini engeller."
          }
        >
          <TextInput
            id="pin"
            name="pin"
            type="password"
            autoComplete="new-password"
            required
            minLength={minLength}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            error={err.pin}
          />
          {pin.length > 0 && (
            <div className="mt-2">
              <div className="flex gap-1" aria-hidden>
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={
                      "h-1 flex-1 rounded-full " +
                      (i < strength
                        ? strength <= 1
                          ? "bg-loss"
                          : strength === 2
                            ? "bg-warn"
                            : "bg-gain"
                        : "bg-surface-hover")
                    }
                  />
                ))}
              </div>
              <p className="mt-1 text-xs text-ink-faint">
                Güç: {LABELS[strength]} · {pin.length} karakter
              </p>
            </div>
          )}
        </Field>

        <Field label="Parola tekrar" htmlFor="pinConfirm" required error={err.pinConfirm}>
          <TextInput
            id="pinConfirm"
            name="pinConfirm"
            type="password"
            autoComplete="new-password"
            required
            error={err.pinConfirm}
          />
        </Field>
      </fieldset>

      <fieldset className="space-y-4 border-t border-line pt-5">
        <legend className="mb-1 text-sm font-medium text-ink">Temel ayarlar</legend>

        <Field
          label="Ana para birimi"
          htmlFor="baseCurrency"
          hint="Toplam servetiniz bu birimde gösterilir. Varlıklar kendi para biriminde tutulur."
        >
          <CurrencySelect id="baseCurrency" name="baseCurrency" defaultValue="USD" />
        </Field>

        <Field
          label="Aylık yaşam gideri"
          htmlFor="monthlyLivingCost"
          error={err.monthlyLivingCost}
          hint="Pasif gelir kapsama oranı bunu kullanır. Sonradan değiştirebilirsiniz."
        >
          <MoneyInput
            id="monthlyLivingCost"
            name="monthlyLivingCost"
            error={err.monthlyLivingCost}
            placeholder="8.000"
          />
        </Field>

        <Field label="Risk profili" htmlFor="riskProfile" error={err.riskProfile}>
          <Select id="riskProfile" name="riskProfile" defaultValue="balanced">
            <option value="conservative">Temkinli — sermayeyi korumak öncelik</option>
            <option value="balanced">Dengeli — büyüme ve güvenlik birlikte</option>
            <option value="aggressive">Atak — dalgalanmayı göze alırım</option>
          </Select>
        </Field>

        <Field
          label="Yatırım vadesi (yıl)"
          htmlFor="horizonYears"
          error={err.horizonYears}
          hint="Dağılım önerisi ve senaryo projeksiyonu bu süreyi kullanır."
        >
          <TextInput
            id="horizonYears"
            name="horizonYears"
            type="number"
            min={1}
            max={60}
            defaultValue={20}
            error={err.horizonYears}
            className="num"
          />
        </Field>
      </fieldset>

      <div className="flex items-center justify-between gap-3 border-t border-line pt-5">
        <p className="text-pretty text-xs text-ink-faint">
          Panel boş başlar. Varlıklarınızı sonraki adımda ekleyeceksiniz.
        </p>
        <SubmitButton pendingText="Kuruluyor…">Kurulumu bitir</SubmitButton>
      </div>
    </form>
  );
}
