import type { NextConfig } from "next";

const config: NextConfig = {
  // better-sqlite3 native binding'i bundle edilmemeli
  serverExternalPackages: ["better-sqlite3"],

  // Docker imajı için: bağımlılıkları tek klasöre toplar, imaj küçülür
  output: process.env.SERVET_STANDALONE === "1" ? "standalone" : undefined,


  // Güvenlik başlıkları — internete açık kurulumda önemli
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          // Panel HTTPS ardındaysa tarayıcı bir daha HTTP denemesin
          ...(process.env.SERVET_PUBLIC === "1"
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains; preload",
                },
              ]
            : []),
        ],
      },
    ];
  },
};

export default config;
