import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Servet Terminali",
  description: "Çok para birimli, çok ülkeli canlı varlık yönetim paneli",
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
