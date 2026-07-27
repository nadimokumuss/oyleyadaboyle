import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Servet Terminali",
  description: "Çok para birimli, çok ülkeli canlı varlık yönetim paneli",
};

/**
 * Bu olmadan mobil tarayıcı sayfayı 980px genişlikte varsayıp küçültür —
 * duyarlı sınıflar (`md:` vb.) hiçbir zaman devreye girmez.
 *
 * `maximumScale` bilerek sınırlanmadı: yakınlaştırmayı kapatmak finans
 * tablolarında erişilebilirliği bozar.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#141618",
  colorScheme: "dark",
};

/**
 * Kök düzen sadece kabuk. Kenar çubuğu ve oturum kontrolü
 * `app/(panel)/layout.tsx` içinde — giriş ve kurulum sayfaları
 * o katmanın dışında kalmalı.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body className="h-dvh overflow-hidden">{children}</body>
    </html>
  );
}
