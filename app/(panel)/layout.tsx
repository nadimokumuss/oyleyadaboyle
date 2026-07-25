import { Sidebar } from "@/components/Sidebar";
import { requireAuth } from "@/lib/session";

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

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
