"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Kısa süreli bildirim.
 *
 * ## Neden formlarda kullanılmıyor
 *
 * Form hataları `FormShell` içinde satır içi ve kalıcı gösteriliyor
 * (`role="alert"`). Bir doğrulama hatasını kaybolan bir kutuya koymak
 * kötü olurdu: kullanıcı hatayı düzeltirken metni okuyabilmeli.
 *
 * Toast'ın yeri **geri bildirimi olmayan tek atımlık eylemler**: bir
 * alarmı silmek, bir hedefi kaldırmak, düzenli hareketi iptal etmek.
 * Bunlar şimdiye kadar sessizce gerçekleşiyordu ve kullanıcı işe yarayıp
 * yaramadığını ancak listeye bakarak anlıyordu.
 *
 * Bildirim `role="status"` ile duyurulur; kritik değil, o yüzden
 * `alert` değil `status`.
 */

const AUTO_DISMISS_MS = 4000;

export interface ToastItem {
  id: number;
  message: string;
  tone: "info" | "success" | "error";
}

interface ToastApi {
  show: (message: string, tone?: ToastItem["tone"]) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Toast göstermek için. Sağlayıcı yoksa sessizce yutar — sayfa çökmez. */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? { show: () => {} };
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const show = useCallback((message: string, tone: ToastItem["tone"] = "info") => {
    setItems((prev) => [...prev, { id: Date.now() + Math.random(), message, tone }]);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        // `aria-live` kapsayıcıda: içerik sonradan eklendiği için bölge
        // baştan var olmalı, yoksa ekran okuyucu değişimi kaçırır.
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-(--z-toast) flex flex-col items-center gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        {items.map((item) => (
          <Toast
            key={item.id}
            item={item}
            onDone={() => setItems((prev) => prev.filter((x) => x.id !== item.id))}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ item, onDone }: { item: ToastItem; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div
      className={cn(
        "pointer-events-auto flex max-w-sm items-start gap-3 rounded-lg border px-3.5 py-2.5 text-sm shadow-lg",
        "bg-surface-raised",
        item.tone === "success" && "border-gain/50 text-gain",
        item.tone === "error" && "border-loss/50 text-loss",
        item.tone === "info" && "border-line text-ink",
      )}
    >
      <span className="text-pretty">{item.message}</span>
      <button
        type="button"
        onClick={onDone}
        aria-label="Bildirimi kapat"
        className="-mr-1 shrink-0 rounded px-1 text-ink-faint transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        ×
      </button>
    </div>
  );
}
