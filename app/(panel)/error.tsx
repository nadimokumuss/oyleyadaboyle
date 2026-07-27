"use client";

import { useEffect } from "react";

/**
 * Panel sayfası hata sınırı.
 *
 * Sayfaların çoğu fiyat/kur sağlayıcısına dokunuyor. Sağlayıcı katmanı
 * bayat veriye düşerek çoğu hatayı yutar, ama yutamadığı bir şey olursa
 * kullanıcı boş ekranla kalmamalı — kenar çubuğu ve gezinme bu sınırın
 * dışında olduğu için burada yalnızca içerik alanı yenilenir.
 */
export default function PanelError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Panel sayfası hatası:", error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
      <div className="rounded-lg border border-loss/40 bg-surface-raised p-6">
        <h1 className="text-balance text-base font-semibold text-ink">
          Bu sayfa yüklenemedi
        </h1>
        <p className="mt-2 text-pretty text-sm text-ink-muted">
          Veriniz güvende — hata görüntüleme katmanında oluştu, hiçbir kayıt
          değişmedi. Sorun sürerse fiyat sağlayıcısına ulaşılamıyor olabilir.
        </p>

        {error.digest && (
          <p className="mt-3 font-mono text-xs text-ink-faint">
            Hata kimliği: {error.digest}
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Yeniden dene
          </button>
          <a
            href="/"
            className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Komuta ekranına dön
          </a>
        </div>
      </div>
    </div>
  );
}
