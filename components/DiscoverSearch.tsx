"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SymbolResult } from "@/app/api/search/symbols/route";

/**
 * Keşif araması — sonuçlar doğrudan detay sayfasına bağlanır.
 * SymbolSearch'ten farkı: form alanı doldurmaz, gezinme yapar.
 */
export function DiscoverSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SymbolResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search/symbols?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        setResults(data.results ?? []);
        setSearched(true);
      } catch {
        if (!controller.signal.aborted) setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return (
    <div>
      <label htmlFor="discover" className="sr-only">
        Enstrüman ara
      </label>
      <input
        id="discover"
        type="search"
        autoComplete="off"
        placeholder="Hisse, kripto veya ETF arayın: THYAO, AAPL, BTC, VOO…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      />

      {loading && <p className="mt-2 text-xs text-ink-faint">Aranıyor…</p>}

      {!loading && searched && results.length === 0 && (
        <p className="mt-3 text-sm text-ink-muted">
          Sonuç bulunamadı. Farklı bir yazım deneyin — BIST için sembol sonuna
          <code className="mx-1 text-ink">.IS</code> eklemek gerekebilir.
        </p>
      )}

      {results.length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-md border border-line">
          {results.map((r, i) => (
            <li key={`${r.symbol}-${i}`}>
              <Link
                href={`/kesfet/${encodeURIComponent(r.symbol)}`}
                className="flex items-baseline justify-between gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{r.symbol}</span>
                  <span className="block truncate text-xs text-ink-faint">{r.name}</span>
                </span>
                <span className="shrink-0 text-xs text-ink-faint">
                  {r.kind === "crypto" ? "Kripto" : (r.exchange ?? "Hisse")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
