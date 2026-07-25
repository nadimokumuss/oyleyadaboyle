"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { SymbolResult } from "@/app/api/search/symbols/route";

/**
 * Enstrüman arama kutusu.
 *
 * Seçim yapılınca sembol, isim ve tür gizli alanlara yazılır — form
 * bunları olduğu gibi gönderir. Kullanıcı elle de yazabilir; arama
 * sadece kolaylık, zorunluluk değil.
 */
export function SymbolSearch({
  nameSymbol = "symbol",
  nameName = "name",
  nameKind = "kind",
  defaultSymbol = "",
  defaultName = "",
  defaultKind = "equity",
  error,
  onSelect,
}: {
  nameSymbol?: string;
  nameName?: string;
  nameKind?: string;
  defaultSymbol?: string;
  defaultName?: string;
  defaultKind?: string;
  error?: string;
  onSelect?: (r: SymbolResult) => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState(defaultSymbol);
  const [results, setResults] = useState<SymbolResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);
  const [active, setActive] = useState(-1);

  const [picked, setPicked] = useState<{
    symbol: string;
    name: string;
    kind: string;
  }>({ symbol: defaultSymbol, name: defaultName, kind: defaultKind });

  const boxRef = useRef<HTMLDivElement>(null);

  // Yazmayı bıraktıktan 250ms sonra ara — her tuşta istek atmak hem
  // sağlayıcı limitini yakar hem sonuçları titretir
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search/symbols?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setResults(data.results ?? []);
        setFailed(data.failed ?? []);
        setOpen(true);
        setActive(-1);
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

  // Dışarı tıklayınca kapat
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function choose(r: SymbolResult) {
    setPicked({ symbol: r.symbol, name: r.name, kind: r.kind });
    setQuery(r.symbol);
    setOpen(false);
    onSelect?.(r);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder="THYAO, AAPL, BTC… (en az 2 harf)"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          // Elle yazılırsa seçim de güncellensin
          setPicked((p) => ({ ...p, symbol: e.target.value.toUpperCase() }));
        }}
        onFocus={() => results.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
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
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-line bg-surface-raised shadow-lg"
        >
          {results.map((r, i) => (
            <li key={`${r.symbol}-${i}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                onClick={() => choose(r)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm",
                  i === active ? "bg-surface-hover" : "hover:bg-surface-hover",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{r.symbol}</span>
                  <span className="block truncate text-xs text-ink-faint">{r.name}</span>
                </span>
                <span className="shrink-0 text-xs text-ink-faint">
                  {r.kind === "crypto" ? "Kripto" : (r.exchange ?? "Hisse")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && !loading && query.trim().length >= 2 && results.length === 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm text-ink-muted">
          Sonuç bulunamadı. Sembolü elle yazabilirsiniz.
        </div>
      )}

      {failed.length > 0 && (
        <p className="mt-1 text-xs text-warn">
          {failed.join(", ")} kaynağına ulaşılamadı — sonuçlar eksik olabilir.
        </p>
      )}

      <input type="hidden" name={nameSymbol} value={picked.symbol} />
      <input type="hidden" name={nameName} value={picked.name || picked.symbol} />
      <input type="hidden" name={nameKind} value={picked.kind} />
    </div>
  );
}
