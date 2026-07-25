"use client";

import Link from "next/link";
import { Button, SubmitButton } from "./Button";
import { deleteAssetAction } from "@/app/actions/assets";
import { useState } from "react";

/**
 * Form kabuğu: hata özeti, kaydet/iptal, düzenlemede sil.
 * Her varlık formu bunu kullanır — tutarlı davranış ve tek yerde bakım.
 */
export function FormShell({
  title,
  description,
  error,
  children,
  editingId,
  deleteRedirect,
  submitLabel = "Kaydet",
}: {
  title: string;
  description?: string;
  error?: string;
  children: React.ReactNode;
  editingId?: string;
  deleteRedirect?: string;
  submitLabel?: string;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <header className="mb-5">
        <h1 className="text-balance text-lg font-semibold text-ink">{title}</h1>
        {description && (
          <p className="mt-1 text-pretty text-sm text-ink-muted">{description}</p>
        )}
      </header>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-pretty text-sm text-loss"
        >
          {error}
        </p>
      )}

      <div className="space-y-5 rounded-lg border border-line bg-surface-raised p-6">
        {children}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <SubmitButton>{submitLabel}</SubmitButton>
          <Link
            href={deleteRedirect ?? "/"}
            className="rounded-md px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            İptal
          </Link>
        </div>

        {editingId && <DeleteButton id={editingId} redirectTo={deleteRedirect} />}
      </div>
    </div>
  );
}

/**
 * Silme onayı.
 *
 * Geri alınamaz bir işlem olduğu için tek tıkla değil, açık onayla
 * yapılır. Onay kutusu formun içinde değil — form gönderimiyle
 * karışmasın diye ayrı bir form kullanır.
 */
function DeleteButton({ id, redirectTo }: { id: string; redirectTo?: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button type="button" variant="ghost" onClick={() => setConfirming(true)}>
        Sil
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-loss/40 bg-loss/10 px-3 py-2">
      <span className="text-pretty text-xs text-loss">
        Bu varlık ve tüm işlem geçmişi silinecek. Geri alınamaz.
      </span>
      <form action={deleteAssetAction}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="redirectTo" value={redirectTo ?? "/"} />
        <Button type="submit" variant="danger">
          Evet, sil
        </Button>
      </form>
      <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
        Vazgeç
      </Button>
    </div>
  );
}
