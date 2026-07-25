"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { logout } from "@/app/actions/auth";

const GROUPS = [
  {
    title: null,
    items: [{ href: "/", label: "Komuta Ekranı", hint: "Genel bakış" }],
  },
  {
    title: "Varlıklarım",
    items: [
      { href: "/portfoy", label: "Portföy", hint: "Hisse & kripto" },
      { href: "/mevduat", label: "Mevduat", hint: "Faiz motoru" },
      { href: "/gayrimenkul", label: "Gayrimenkul", hint: "Ev & arsa" },
      { href: "/arac", label: "Araç", hint: "Amortisman" },
      { href: "/girisim", label: "Girişim", hint: "Runway & burn" },
      { href: "/nakit-akisi", label: "Nakit Akışı", hint: "Gelir & gider" },
      { href: "/borclar", label: "Borçlar", hint: "Kredi & ipotek" },
      { href: "/islemler", label: "İşlemler", hint: "Geçmiş & geri al" },
    ],
  },
  {
    title: "Karar araçları",
    items: [
      { href: "/kesfet", label: "Keşfet", hint: "Araştır & izle" },
      { href: "/plan", label: "Plan", hint: "Almayı düşündüklerim" },
      { href: "/karsilastir", label: "Karşılaştır", hint: "Yatırım simülasyonu" },
      { href: "/firsatlar", label: "Fırsatlar", hint: "Gelir önerileri" },
      { href: "/senaryo", label: "Senaryo", hint: "Monte Carlo & stres" },
    ],
  },
  {
    title: null,
    items: [{ href: "/ayarlar", label: "Ayarlar", hint: "Veri & tercihler" }],
  },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Ana gezinme"
      className="flex h-dvh w-60 shrink-0 flex-col border-r border-line bg-surface-raised"
    >
      <div className="border-b border-line px-5 py-5">
        <p className="text-sm font-semibold text-ink">Servet Terminali</p>
        <p className="mt-0.5 text-xs text-ink-faint">Varlık yönetim paneli</p>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {GROUPS.map((group, gi) => (
          <div key={gi} className={gi > 0 ? "mt-4" : undefined}>
            {group.title && (
              <p className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                {group.title}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active =
                  item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "block rounded-md px-3 py-2 text-sm transition-colors",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                        active
                          ? "bg-surface-hover font-medium text-ink"
                          : "text-ink-muted hover:bg-surface-hover hover:text-ink",
                      )}
                    >
                      <span className="block truncate">{item.label}</span>
                      <span className="block truncate text-xs text-ink-faint">
                        {item.hint}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-line px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <form action={logout}>
          <button
            type="submit"
            className="w-full rounded-md px-3 py-1.5 text-left text-sm text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Kilitle
          </button>
        </form>
        <p className="mt-2 px-3 text-pretty text-[11px] leading-relaxed text-ink-faint">
          Hesaplamaya dayalı bilgilendirme. Yatırım tavsiyesi değildir.
        </p>
      </div>
    </nav>
  );
}
