"use client";

import { useActionState } from "react";
import { saveAutopayAction } from "@/app/actions/automation";
import type { FormState } from "@/app/actions/assets";
import { SubmitButton } from "@/components/form/Button";

const initial: FormState = {};

export interface CashOption {
  id: string;
  name: string;
  currency: string;
}

/**
 * Kredi taksitlerinin kendiliğinden ilerlemesi.
 *
 * Varsayılan kapalı: arka planda çalışan bir işin nakit hesabınızdan para
 * düşmesi, kullanıcının açıkça istemesi gereken bir davranış.
 */
export function AutopayForm({
  loanId,
  autoPay,
  paymentAssetId,
  accounts,
}: {
  loanId: string;
  autoPay: boolean;
  paymentAssetId: string | null;
  accounts: CashOption[];
}) {
  const [state, action] = useActionState(saveAutopayAction, initial);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="liabilityId" value={loanId} />

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          name="autoPay"
          defaultChecked={autoPay}
          className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
        />
        <span className="text-pretty text-xs text-ink-muted">
          Taksitleri otomatik ilerlet
        </span>
      </label>

      <select
        name="paymentAssetId"
        defaultValue={paymentAssetId ?? ""}
        className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <option value="">Nakit hesabı seçme — sadece sayacı ilerlet</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} ({a.currency})
          </option>
        ))}
      </select>

      <SubmitButton>Kaydet</SubmitButton>

      {state.savedId && !state.error && (
        <p className="text-xs text-gain">Kaydedildi.</p>
      )}
      {state.error && <p className="text-pretty text-xs text-loss">{state.error}</p>}

      <p className="text-pretty text-[11px] text-ink-faint">
        İlk çalıştırma geçmişi para hareketiyle canlandırmaz; yalnızca sayacı
        bugüne eşitler. Sonraki taksitler seçtiğiniz hesaptan düşülür.
      </p>
    </form>
  );
}
