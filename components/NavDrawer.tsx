"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";

/**
 * Dar ekran gezinmesi. Masaüstündeki kenar çubuğu `md:` altında gizlenir,
 * yerine bu başlık çubuğu ve çekmece gelir.
 *
 * Menü içeriği `Sidebar` bileşeninden gelir — burada kopyalanmaz, yoksa
 * yeni bir sayfa eklendiğinde iki listeden biri unutulur.
 */
export function NavDrawer({ unreadCount = 0 }: { unreadCount?: number }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Gezinme gerçekleştiğinde çekmece kapanmalı. Link tıklaması `onNavigate`
  // ile kapatıyor; bu ayrıca geri/ileri tuşlarını da kapsar.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Açıkken: Escape kapatır, arka plan kaymaz, odak çekmecenin içinde kalır.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (e.key !== "Tab") return;

      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables?.length) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("a[href]")?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface-raised px-4 md:hidden">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Gezinme menüsünü aç"
          aria-expanded={open}
          className="-ml-2 rounded-md p-2 text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M3 5.5h14M3 10h14M3 14.5h14" />
          </svg>
        </button>
        <p className="text-sm font-semibold text-ink">Servet Terminali</p>
        {unreadCount > 0 && (
          <span
            className="num ml-auto rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-surface"
            aria-label={`${unreadCount} okunmamış bildirim`}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </header>

      {open && (
        <div className="fixed inset-0 z-(--z-modal) md:hidden">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Menüyü kapat"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/60"
          />
          <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Gezinme">
            <Sidebar
              className="relative"
              onNavigate={() => setOpen(false)}
              unreadCount={unreadCount}
            />
          </div>
        </div>
      )}
    </>
  );
}
