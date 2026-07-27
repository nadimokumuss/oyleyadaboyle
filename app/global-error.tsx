"use client";

import "./globals.css";

/**
 * Son çare hata sınırı — kök düzenin kendisi çöktüğünde devreye girer.
 * Next kuralı gereği kendi `<html>` ve `<body>` etiketlerini basar,
 * bu yüzden globals.css burada ayrıca içeri alınır.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="tr">
      <body className="flex h-dvh items-center justify-center px-4">
        <div className="w-full max-w-md rounded-lg border border-loss/40 bg-surface-raised p-6 text-center">
          <h1 className="text-balance text-base font-semibold text-ink">
            Panel açılamadı
          </h1>
          <p className="mt-2 text-pretty text-sm text-ink-muted">
            Beklenmeyen bir hata oluştu. Veritabanınıza dokunulmadı.
          </p>
          {error.digest && (
            <p className="mt-3 font-mono text-xs text-ink-faint">
              Hata kimliği: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            className="mt-5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Yeniden dene
          </button>
        </div>
      </body>
    </html>
  );
}
