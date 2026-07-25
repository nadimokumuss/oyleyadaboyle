import {
  type MarketProvider,
  type Quote,
  fetchJson,
  numToDecimalString,
} from "./provider";

/**
 * CoinGecko — anahtarsız public API.
 *
 * Limit 10–30 çağrı/dakika. Bu yüzden:
 *  - tek çağrıda çok sembol istenir (batchSize 100)
 *  - cache.ts'teki token bucket çağrı hızını sınırlar
 *
 * Sembol eşlemesi: panelde "BTC" yazarız, CoinGecko "bitcoin" ister.
 */

const SYMBOL_TO_ID: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",
  ADA: "cardano",
  AVAX: "avalanche-2",
  DOT: "polkadot",
  MATIC: "matic-network",
  LINK: "chainlink",
  DOGE: "dogecoin",
  TRX: "tron",
  LTC: "litecoin",
  ATOM: "cosmos",
  UNI: "uniswap",
  USDT: "tether",
  USDC: "usd-coin",
};

export function isKnownCrypto(symbol: string): boolean {
  return symbol.toUpperCase() in SYMBOL_TO_ID;
}

type PriceResponse = Record<string, { usd?: number; usd_24h_change?: number }>;

export class CoinGeckoProvider implements MarketProvider {
  readonly name = "coingecko";
  readonly batchSize = 100;

  async fetchQuotes(symbols: string[]): Promise<Quote[]> {
    const pairs = symbols
      .map((s) => ({ symbol: s, id: SYMBOL_TO_ID[s.toUpperCase()] }))
      .filter((p): p is { symbol: string; id: string } => Boolean(p.id));

    if (pairs.length === 0) return [];

    const ids = [...new Set(pairs.map((p) => p.id))].join(",");
    const url =
      `https://api.coingecko.com/api/v3/simple/price` +
      `?ids=${encodeURIComponent(ids)}&vs_currencies=usd&include_24hr_change=true`;

    const data = await fetchJson<PriceResponse>(url, this.name);
    const now = new Date();

    return pairs.flatMap(({ symbol, id }) => {
      const entry = data[id];
      if (!entry?.usd) return [];
      return [
        {
          symbol: symbol.toUpperCase(),
          price: numToDecimalString(entry.usd),
          currency: "USD",
          changePct24h:
            typeof entry.usd_24h_change === "number"
              ? numToDecimalString(entry.usd_24h_change / 100)
              : null,
          asOf: now,
          source: this.name,
          stale: false,
        } satisfies Quote,
      ];
    });
  }
}
