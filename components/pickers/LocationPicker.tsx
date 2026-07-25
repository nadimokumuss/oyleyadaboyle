"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/cn";
import type { PlaceResult } from "@/app/api/search/places/route";

/** Leaflet tarayıcı API'lerine bağlı — sunucuda render edilemez. */
const LocationMap = dynamic(() => import("./LocationMap"), {
  ssr: false,
  loading: () => (
    <div className="h-64 w-full animate-pulse rounded-md bg-surface-hover" />
  ),
});

/**
 * Konum seçici: şehir araması + harita.
 *
 * Seçilen konumun şehri, ülkesi, koordinatları ve varsa uygun konut
 * fiyat endeksi gizli alanlara yazılır. Endeks bulunamazsa kullanıcıya
 * açıkça söylenir — uydurma bir endeks atamak, o mülkün değerini
 * yanlış bir bölgenin trendiyle modellemek olurdu.
 */
export function LocationPicker({
  defaultCity = "",
  defaultCountry = "",
  defaultLat,
  defaultLng,
  defaultIndexKey = "",
  error,
}: {
  defaultCity?: string;
  defaultCountry?: string;
  defaultLat?: number | null;
  defaultLng?: number | null;
  defaultIndexKey?: string;
  error?: string;
}) {
  const [query, setQuery] = useState(defaultCity);
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showMap, setShowMap] = useState(
    defaultLat != null && defaultLng != null,
  );

  const [picked, setPicked] = useState({
    city: defaultCity,
    country: defaultCountry,
    lat: defaultLat ?? 41.0082,
    lng: defaultLng ?? 28.9784,
    indexKey: defaultIndexKey,
    label: defaultCity,
  });

  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || q === picked.label) {
      setResults([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search/places?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        setResults(data.results ?? []);
        setOpen(true);
      } catch {
        if (!controller.signal.aborted) setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, picked.label]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function choose(p: PlaceResult) {
    const label = [p.name, p.admin, p.country].filter(Boolean).join(", ");
    setPicked({
      city: p.name,
      country: p.countryCode,
      lat: p.lat,
      lng: p.lng,
      indexKey: p.indexKey ?? "",
      label,
    });
    setQuery(label);
    setOpen(false);
    setShowMap(true);
  }

  return (
    <div className="space-y-3">
      <div ref={boxRef} className="relative">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder="Şehir arayın: Bodrum, Lizbon, Dubai…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          aria-invalid={error ? true : undefined}
          className={cn(
            "w-full rounded-md border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint",
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
            error ? "border-loss" : "border-line",
          )}
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-faint">
            aranıyor…
          </span>
        )}

        {open && results.length > 0 && (
          <ul
            role="listbox"
            className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-line bg-surface-raised shadow-lg"
          >
            {results.map((p) => (
              <li key={p.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  onClick={() => choose(p)}
                  className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-hover"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-ink">{p.name}</span>
                    <span className="block truncate text-xs text-ink-faint">
                      {[p.admin, p.country].filter(Boolean).join(", ")}
                    </span>
                  </span>
                  {p.indexKey && (
                    <span className="shrink-0 text-[11px] text-gain">endeks var</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showMap && (
        <>
          <LocationMap
            lat={picked.lat}
            lng={picked.lng}
            onPick={(lat, lng) => setPicked((p) => ({ ...p, lat, lng }))}
          />
          <p className="num text-xs text-ink-faint">
            Haritaya tıklayarak veya işaretçiyi sürükleyerek konumu inceltebilirsiniz.
            Seçili: {picked.lat.toFixed(4)}, {picked.lng.toFixed(4)}
          </p>
        </>
      )}

      {picked.city && (
        <p
          className={cn(
            "rounded-md border px-3 py-2 text-pretty text-xs",
            picked.indexKey
              ? "border-gain/40 bg-gain/10 text-ink-muted"
              : "border-warn/40 bg-warn/10 text-ink-muted",
          )}
        >
          {picked.indexKey ? (
            <>
              Bu konum için konut fiyat endeksi mevcut (
              <code className="text-ink">{picked.indexKey}</code>) — değer artışı
              buna göre modellenecek.
            </>
          ) : (
            <>
              Bu konum için konut fiyat endeksi yok. Değer, siz bir ekspertiz
              girene kadar alış fiyatında sabit kalır. Endeksi zorla atamak,
              mülkü yanlış bir bölgenin trendiyle değerlemek olurdu.
            </>
          )}
        </p>
      )}

      <input type="hidden" name="city" value={picked.city} />
      <input type="hidden" name="country" value={picked.country} />
      <input type="hidden" name="lat" value={picked.lat} />
      <input type="hidden" name="lng" value={picked.lng} />
      <input type="hidden" name="indexKey" value={picked.indexKey} />
    </div>
  );
}
