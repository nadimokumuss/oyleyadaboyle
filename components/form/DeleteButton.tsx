"use client";

import { useTransition } from "react";
import { useToast } from "@/components/Toast";
import { cn } from "@/lib/cn";

/**
 * Tek atımlık silme butonu.
 *
 * Bu eylemler (alarm sil, hedef sil, düzenli hareket sil) şimdiye kadar
 * `<form action={...}>` içinde sessizce çalışıyordu: bir şey olduğunu
 * ancak liste yeniden çizilince anlıyordunuz. Küçük listelerde bu fark
 * edilmiyor bile.
 *
 * Toast, işlemin gerçekleştiğini söyler; hata olursa mesajı gösterir.
 */
export function DeleteButton({
  action,
  label = "sil",
  successMessage,
  className,
}: {
  /** Silme eylemi — id'si `bind` ile bağlanmış olmalı. */
  action: () => Promise<void>;
  label?: string;
  successMessage: string;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const toast = useToast();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          try {
            await action();
            toast.show(successMessage, "success");
          } catch (err) {
            toast.show(`Silinemedi: ${(err as Error).message}`, "error");
          }
        })
      }
      className={cn(
        "rounded px-1.5 py-0.5 text-xs text-ink-faint transition-colors",
        "hover:bg-surface-hover hover:text-loss",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "disabled:opacity-50",
        className,
      )}
    >
      {pending ? "siliniyor…" : label}
    </button>
  );
}
