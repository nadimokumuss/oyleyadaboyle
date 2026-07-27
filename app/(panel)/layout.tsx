import { Sidebar } from "@/components/Sidebar";
import { NavDrawer } from "@/components/NavDrawer";
import { ToastProvider } from "@/components/Toast";
import { requireAuth } from "@/lib/session";
import { unreadCount } from "@/lib/services/notify";
import { ensureSchedulerStarted } from "@/lib/bootstrap";

/**
 * Korumalı alan. Buradaki her sayfa oturum ister — bir sayfayı
 * korumayı unutmak mümkün değil, kapı tek yerde.
 */
export default async function PanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAuth();
  // Arka plan zamanlayıcısı ilk istekte ayağa kalkar; idempotent.
  ensureSchedulerStarted();
  const unread = unreadCount();

  return (
    <ToastProvider>
      <div className="flex h-dvh overflow-hidden">
      {/* Masaüstü: sabit kenar çubuğu. Dar ekranda gizlenir, yerini
          NavDrawer'ın başlık çubuğu ve çekmecesi alır. */}
      <Sidebar className="hidden md:flex" unreadCount={unread} />
      <div className="flex min-w-0 flex-1 flex-col">
        <NavDrawer unreadCount={unread} />
        <a
          href="#icerik"
          className="sr-only focus:not-sr-only focus:absolute focus:z-(--z-toast) focus:m-2 focus:rounded-md focus:bg-surface-raised focus:px-3 focus:py-2 focus:text-sm focus:text-ink focus:outline-2 focus:outline-accent"
        >
          İçeriğe geç
        </a>
        <main id="icerik" className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
      </div>
    </ToastProvider>
  );
}
