import { NextResponse } from "next/server";
import { assertAuth } from "@/lib/session";
import { fetchJson } from "@/lib/market/provider";
import { resolveIndexKey } from "@/lib/geo";

export const dynamic = "force-dynamic";

/**
 * Şehir/konum arama: /api/search/places?q=bodrum
 *
 * Open-Meteo'nun coğrafi kodlama servisi — anahtarsız, Türkçe destekli.
 */

export interface PlaceResult {
  id: number;
  name: string;
  admin: string | null;
  country: string;
  countryCode: string;
  lat: number;
  lng: number;
  population: number | null;
  /** Konuma uyan konut fiyat endeksi anahtarı (varsa). */
  indexKey: string | null;
}

interface GeocodeResponse {
  results?: Array<{
    id: number;
    name: string;
    latitude: number;
    longitude: number;
    country: string;
    country_code: string;
    admin1?: string;
    admin2?: string;
    population?: number;
  }>;
}

export async function GET(request: Request) {
  await assertAuth();

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });

  try {
    const url =
      `https://geocoding-api.open-meteo.com/v1/search` +
      `?name=${encodeURIComponent(q)}&count=8&language=tr&format=json`;
    const data = await fetchJson<GeocodeResponse>(url, "open-meteo");

    const results: PlaceResult[] = (data.results ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      admin: r.admin1 ?? r.admin2 ?? null,
      country: r.country,
      countryCode: r.country_code?.toUpperCase() ?? "",
      lat: r.latitude,
      lng: r.longitude,
      population: r.population ?? null,
      indexKey: resolveIndexKey(r.name, r.country_code?.toUpperCase() ?? ""),
    }));

    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json(
      { results: [], error: (err as Error).message },
      { status: 503 },
    );
  }
}
