import Link from "next/link";

/**
 * Bilinmeyen adres. Kök seviyede durur çünkü oturum açılmamışken de
 * tetiklenebilir — panel düzenine bağlanmamalı.
 */
export default function NotFound() {
  return (
    <div className="flex h-dvh items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface-raised p-6 text-center">
        <h1 className="text-balance text-base font-semibold text-ink">
          Böyle bir sayfa yok
        </h1>
        <p className="mt-2 text-pretty text-sm text-ink-muted">
          Adres yanlış yazılmış ya da bu bölüm kaldırılmış olabilir.
        </p>
        <Link
          href="/"
          className="mt-5 inline-block rounded-md border border-line px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Komuta ekranına dön
        </Link>
      </div>
    </div>
  );
}
