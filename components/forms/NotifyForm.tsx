"use client";

import { useActionState, useState, useTransition } from "react";
import {
  saveNotifySettingsAction,
  testWebhookAction,
} from "@/app/actions/automation";
import type { FormState } from "@/app/actions/assets";
import { Field, TextInput } from "@/components/form/Field";
import { SubmitButton } from "@/components/form/Button";

const initial: FormState = {};

/**
 * Bildirim kanalı ve zamanlayıcı anahtarı.
 *
 * Webhook ilk kanal olarak seçildi: tek alan, sıfır bağımlılık ve verinin
 * hangi servise gittiğini kullanıcı belirliyor. Panelin "veri kendi
 * sunucunuzda kalır" duruşuyla uyuşan tek seçenek buydu.
 */
export function NotifyForm({
  webhookUrl,
  schedulerEnabled,
}: {
  webhookUrl: string;
  schedulerEnabled: boolean;
}) {
  const [state, action] = useActionState(saveNotifySettingsAction, initial);
  const [testState, setTestState] = useState<FormState | null>(null);
  const [testing, startTest] = useTransition();
  const err = state.fieldErrors ?? {};

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4">
        {state.savedId && !state.error && (
          <p className="rounded-md border border-gain/40 bg-gain/10 px-3 py-2 text-sm text-gain">
            Bildirim ayarları kaydedildi.
          </p>
        )}

        <Field
          label="Webhook adresi"
          htmlFor="webhookUrl"
          error={err.webhookUrl}
          hint="Telegram bot, Discord kanalı veya kendi ucunuz. Boş bırakılırsa bildirimler yalnızca panelde birikir."
        >
          <TextInput
            id="webhookUrl"
            name="webhookUrl"
            type="url"
            placeholder="https://..."
            defaultValue={webhookUrl}
            error={err.webhookUrl}
          />
        </Field>

        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            name="schedulerEnabled"
            defaultChecked={schedulerEnabled}
            className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
          />
          <span>
            <span className="block text-sm text-ink">Arka plan zamanlayıcısı</span>
            <span className="block text-pretty text-xs text-ink-faint">
              Kapatırsanız düzenli hareketler işlenmez, alarmlar
              değerlendirilmez ve servet eğrisi yalnızca paneli açtığınızda
              ilerler.
            </span>
          </span>
        </label>

        <SubmitButton>Kaydet</SubmitButton>
      </form>

      <div className="border-t border-line pt-3">
        <button
          type="button"
          disabled={testing}
          onClick={() =>
            startTest(async () => setTestState(await testWebhookAction()))
          }
          className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
        >
          {testing ? "Gönderiliyor…" : "Test bildirimi gönder"}
        </button>

        {testState?.savedId && (
          <p className="mt-2 text-sm text-gain">
            Gönderildi. Uçta göremiyorsanız adres doğru ama hedef servis
            mesajı kabul etmemiş olabilir.
          </p>
        )}
        {testState?.error && (
          <p className="mt-2 text-pretty text-sm text-loss">{testState.error}</p>
        )}
      </div>
    </div>
  );
}
