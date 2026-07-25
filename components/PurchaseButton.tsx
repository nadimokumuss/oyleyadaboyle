"use client";

import { useState } from "react";
import { markPurchasedAction } from "@/app/actions/assets";
import { Button } from "@/components/form/Button";
import { Money, formatMoney } from "@/lib/money";

/**
 * "Satın aldım" akışı.
 *
 * Planlanan bir varlığı gerçek varlığa çevirirken nakdin de düşülmesi
 * gerekir — yoksa hem parayı hem evi saymış oluruz ve servet bir anda
 * şişer. Bu yüzden hangi hesaptan düşüleceği soruluyor.
 *
 * Nakit hesabı seçmemek de mümkün (parayı başka yerden ödediyseniz),
 * ama bu bilinçli bir tercih olmalı, varsayılan olmamalı.
 */
export function PurchaseButton({
  assetId,
  name,
  costUsd,
  cashAccounts,
}: {
  assetId: string;
  name: string;
  costUsd: string;
  cashAccounts: Array<{ id: string; name: string; currency: string; balanceUsd: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [cashId, setCashId] = useState(cashAccounts[0]?.id ?? "");

  const cost = Money.of(costUsd, "USD");
  const selected = cashAccounts.find((a) => a.id === cashId);
  const balance = selected ? Money.of(selected.balanceUsd, "USD") : null;
  const insufficient = balance ? cost.gt(balance) : false;

  if (!open) {
    return (
      <Button type="button" variant="primary" onClick={() => setOpen(true)}>
        Satın aldım
      </Button>
    );
  }

  return (
    <div className="w-full rounded-md border border-line bg-surface p-3">
      <p className="text-pretty text-sm text-ink">
        <strong>{name}</strong> gerçek varlıklarınıza taşınacak.
      </p>

      {cashAccounts.length > 0 ? (
        <>
          <label
            htmlFor={`cash-${assetId}`}
            className="mt-3 block text-xs text-ink-muted"
          >
            Ödeme hangi hesaptan yapıldı?
          </label>
          <select
            id={`cash-${assetId}`}
            value={cashId}
            onChange={(e) => setCashId(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          >
            {cashAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} — {formatMoney(Money.of(a.balanceUsd, "USD"), { compact: true })}
              </option>
            ))}
            <option value="">Nakit düşme (başka kaynaktan ödendi)</option>
          </select>

          {insufficient && cashId && (
            <p className="mt-1.5 text-pretty text-xs text-warn">
              Bu hesapta {formatMoney(cost)} yok. Yine de devam ederseniz bakiye
              eksiye düşer — kaydı sonradan düzeltmeniz gerekir.
            </p>
          )}
        </>
      ) : (
        <p className="mt-2 text-pretty text-xs text-ink-muted">
          Kayıtlı nakit hesabınız yok, bu yüzden düşülecek bakiye de yok.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <form action={markPurchasedAction}>
          <input type="hidden" name="assetId" value={assetId} />
          <input type="hidden" name="cashAssetId" value={cashId} />
          <input type="hidden" name="amount" value={cashId ? costUsd : ""} />
          <input type="hidden" name="currency" value={cashId ? "USD" : ""} />
          <Button type="submit" variant="primary">
            Onayla
          </Button>
        </form>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Vazgeç
        </Button>
      </div>
    </div>
  );
}
