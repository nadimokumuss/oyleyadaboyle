import { NextResponse } from "next/server";
import { assertAuth } from "@/lib/session";
import { fetchJson } from "@/lib/market/provider";
import { getBucket, isBackedOff, recordFailure, recordSuccess } from "@/lib/market/cache";

export const dynamic = "force-dynamic";

/**
 * Enstrüman arama: /api/search/symbols?q=thy
 *
 * Yahoo (hisse, ETF, endeks) ve CoinGecko (kripto) paralel sorgulanır,
 * sonuçlar birleştirilip tekilleştirilir. Biri düşerse diğerinin
 * sonuçları yine döner — arama tamamen ölmez.
 */

export interface SymbolResult {
  symbol: string;
  name: string;
  kind: "equity" | "crypto" | "commodity";
  exchange: string | null;
  currency: string | null;
  sector: string | null;
  /** Sıralama için: düşük olan üstte. */
  rank: number;
}

interface YahooSearch {
  quotes?: Array<{
    symbol?: string;
    shortname?: string;
    longname?: string;
    exchDisp?: string;
    quoteType?: string;
    sector?: string;
    score?: number;
    isYahooFinance?: boolean;
  }>;
}

interface GeckoSearch {
  coins?: Array<{
    id: string;
    name: string;
    symbol: string;
    market_cap_rank: number | null;
  }>;
}

const YAHOO_TYPES: Record<string, SymbolResult["kind"]> = {
  EQUITY: "equity",
  ETF: "equity",
  MUTUALFUND: "equity",
  INDEX: "equity",
  FUTURE: "commodity",
  CURRENCY: "commodity",
};

export async function GET(request: Request) {
  await assertAuth();

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ results: [], sources: [] });
  }

  const [yahoo, gecko] = await Promise.allSettled([
    searchYahoo(q),
    searchCoinGecko(q),
  ]);

  const results: SymbolResult[] = [];
  const sources: string[] = [];
  const failed: string[] = [];

  if (yahoo.status === "fulfilled") {
    results.push(...yahoo.value);
    sources.push("yahoo");
  } else failed.push("yahoo");

  if (gecko.status === "fulfilled") {
    results.push(...gecko.value);
    sources.push("coingecko");
  } else failed.push("coingecko");

  // Aynı sembol iki kaynaktan gelirse ilkini tut
  const seen = new Set<string>();
  const unique = results
    .filter((r) => {
      const key = r.symbol.toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 25);

  return NextResponse.json({ results: unique, sources, failed });
}

async function searchYahoo(q: string): Promise<SymbolResult[]> {
  const bucket = getBucket("yahoo");
  if (isBackedOff("yahoo") || !bucket.tryTake()) return [];

  try {
    const url =
      `https://query1.finance.yahoo.com/v1/finance/search` +
      `?q=${encodeURIComponent(q)}&quotesCount=15&newsCount=0`;
    const data = await fetchJson<YahooSearch>(url, "yahoo");
    recordSuccess("yahoo");

    return (data.quotes ?? [])
      .filter((x) => x.symbol && x.isYahooFinance !== false)
      .map((x, i) => ({
        symbol: x.symbol!,
        name: x.longname ?? x.shortname ?? x.symbol!,
        kind: YAHOO_TYPES[x.quoteType ?? ""] ?? "equity",
        exchange: x.exchDisp ?? null,
        // Borsa sonekinden para birimini tahmin etmek yerine null bırakılır;
        // gerçek para birimi fiyat çekilirken sağlayıcıdan gelir
        currency: null,
        sector: x.sector ?? null,
        rank: i,
      }));
  } catch (err) {
    recordFailure("yahoo");
    throw err;
  }
}

async function searchCoinGecko(q: string): Promise<SymbolResult[]> {
  const bucket = getBucket("coingecko");
  if (isBackedOff("coingecko") || !bucket.tryTake()) return [];

  try {
    const url = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`;
    const data = await fetchJson<GeckoSearch>(url, "coingecko");
    recordSuccess("coingecko");

    return (data.coins ?? [])
      .slice(0, 12)
      .map((c) => ({
        symbol: c.symbol.toUpperCase(),
        name: c.name,
        kind: "crypto" as const,
        exchange: "Kripto",
        currency: "USD",
        sector: null,
        // Piyasa değeri sırası olanlar üstte; sırasızlar en sona
        rank: c.market_cap_rank ?? 9999,
      }));
  } catch (err) {
    recordFailure("coingecko");
    throw err;
  }
}
