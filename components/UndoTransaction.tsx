"use client";

import { useState } from "react";
import { deleteTransactionAction } from "@/app/actions/assets";
import { undoSaleAction } from "@/app/actions/dispose";
import { Button } from "@/components/form/Button";

/**
 * İşlem geri alma.
 *
 * Onay isteniyor çünkü geri alınamaz. Onay metninde hangi kaydın
 * silineceği tekrar yazılıyor — "sil" düğmesine yanlış satırda basmak
 * kolay bir hata.
 */
export function UndoTransaction({ id, label }: { id: string; label: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md px-2 py-1 text-xs text-ink-faint transition-colors hover:bg-surface-hover hover:text-loss focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Geri al
      </button>
    );
  }

  return (
    <div className="inline-flex items-center gap-2">
      <span className="text-pretty text-xs text-loss">Silinsin mi?</span>
      <form action={deleteTransactionAction}>
        <input type="hidden" name="id" value={id} />
        <button
          type="submit"
          title={label}
          className="rounded-md border border-loss/50 bg-loss/10 px-2 py-1 text-xs text-loss transition-colors hover:bg-loss/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Evet
        </button>
      </form>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded-md px-2 py-1 text-xs text-ink-faint hover:text-ink"
      >
        Hayır
      </button>
    </div>
  );
}

/**
 * Satışı geri alma.
 *
 * Tek bir işlemi silmekten farklı: varlığı tekrar aktif yapar, hasılat
 * kaydını siler ve kapatılmış kredileri yeniden açar. Bu yüzden ne
 * olacağı açıkça anlatılıyor.
 */
export function UndoSale({ assetId, name }: { assetId: string; name: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button type="button" variant="ghost" onClick={() => setConfirming(true)}>
        Satışı geri al
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-pretty text-xs text-ink-muted">
        <strong className="text-ink">{name}</strong> tekrar aktif olacak, satış
        hasılatı hesabınızdan geri alınacak, varsa kredisi yeniden açılacak.
      </span>
      <form action={undoSaleAction}>
        <input type="hidden" name="assetId" value={assetId} />
        <Button type="submit" variant="danger">
          Geri al
        </Button>
      </form>
      <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
        Vazgeç
      </Button>
    </div>
  );
}
