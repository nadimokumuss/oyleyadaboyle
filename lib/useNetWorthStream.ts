"use client";

import { useEffect, useState } from "react";

export interface StreamedAsset {
  assetId: string;
  name: string;
  kind: string;
  symbol: string | null;
  valueUsd: string;
  valueLocal: string;
  currency: string;
  basis: "live" | "accrual" | "model" | "book" | "stale";
  priceAgeMs: number | null;
  changePct24h: string | null;
  unrealizedPnl: string | null;
}

export interface NetWorthPayload {
  totalUsd: string;
  grossAssetsUsd: string;
  liabilitiesUsd: string;
  byKind: Record<string, string>;
  byCurrency: Record<string, string>;
  byCountry: Record<string, string>;
  byLiquidity: Record<string, string>;
  fxStale: boolean;
  fxDate: string;
  staleCount: number;
  assetCount: number;
  computedAt: string;
  assets: StreamedAsset[];
}

export type StreamStatus = "connecting" | "live" | "reconnecting" | "error";

/**
 * Sunucudan net servet akışını dinler.
 *
 * EventSource kopan bağlantıyı kendi kendine yeniden kurar; biz sadece
 * durumu arayüze bildiriyoruz ki kullanıcı "canlı mı, kopuk mu"
 * sorusunu görebilsin. Veri gösterilmeye devam eder — kopuk bağlantıda
 * ekranı boşaltmak, elindeki son bilgiden de etmek olur.
 */
export function useNetWorthStream() {
  const [data, setData] = useState<NetWorthPayload | null>(null);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/stream");

    source.addEventListener("networth", (e) => {
      try {
        setData(JSON.parse((e as MessageEvent).data) as NetWorthPayload);
        setStatus("live");
        setError(null);
      } catch {
        setError("Akış verisi çözümlenemedi");
      }
    });

    source.addEventListener("error", (e) => {
      const msg = (e as MessageEvent).data;
      if (typeof msg === "string" && msg) {
        try {
          setError(JSON.parse(msg).message as string);
        } catch {
          /* sunucu mesajı değil, bağlantı hatası */
        }
      }
    });

    source.onerror = () => {
      // EventSource otomatik yeniden bağlanır
      setStatus(source.readyState === EventSource.CLOSED ? "error" : "reconnecting");
    };

    return () => source.close();
  }, []);

  return { data, status, error };
}
