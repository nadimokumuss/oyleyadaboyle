import { fetchJson } from "./provider";
import { getBucket, isBackedOff, recordFailure, recordSuccess } from "./cache";
import { classify } from "./registry";

/**
 * Geçmiş fiyat serisi — teknik göstergeler ve grafikler için.
 *
 * Hisse: Yahoo v8/chart (1 yıl, günlük). Kripto: CoinGecko market_chart.
 * Bu veri her sembol için ayrı bir çağrı gerektirdiğinden yalnızca
 * enstrüman detay sayfası açıldığında istenir — listelerde değil.
 */

export interface PriceHistory {
  symbol: string;
  currency: string;
  /** Kronolojik sıralı kapanış fiyatları. */
  closes: number[];
  /** Her kapanışa karşılık gelen tarih (ISO). */
  dates: string[];
  source: string;
  meta: {
    fiftyTwoWeekHigh: number | null;
    fiftyTwoWeekLow: number | null;
    currentPrice: number | null;
    /** Kripto için ek bağlam. */
    marketCapRank?: number | null;
    athChangePct?: number | null;
    change7d?: number | null;
    change30d?: number | null;
    change1y?: number | null;
  };
}

interface YahooChart {
  chart: {
    result?: Array<{
      meta: {
        currency?: string;
        regularMarketPrice?: number;
        fiftyTwoWeekHigh?: number;
        fiftyTwoWeekLow?: number;
      };
      timestamp?: number[];
      indicators: { quote: Array<{ close?: Array<number | null> }> };
    }> | null;
    error?: { description: string } | null;
  };
}

export async function fetchHistory(symbol: string): Promise<PriceHistory | null> {
  return classify(symbol) === "crypto"
    ? fetchCryptoHistory(symbol)
    : fetchEquityHistory(symbol);
}

async function fetchEquityHistory(symbol: string): Promise<PriceHistory | null> {
  const bucket = getBucket("yahoo");
  if (isBackedOff("yahoo") || !bucket.tryTake()) return null;

  try {
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?interval=1d&range=1y`;
    const data = await fetchJson<YahooChart>(url, "yahoo");

    const result = data.chart.result?.[0];
    if (!result) return null;

    const rawCloses = result.indicators.quote[0]?.close ?? [];
    const stamps = result.timestamp ?? [];

    const closes: number[] = [];
    const dates: string[] = [];
    for (let i = 0; i < rawCloses.length; i++) {
      const c = rawCloses[i];
      if (typeof c === "number" && Number.isFinite(c) && c > 0) {
        closes.push(c);
        dates.push(
          stamps[i] ? new Date(stamps[i] * 1000).toISOString().slice(0, 10) : "",
        );
      }
    }

    recordSuccess("yahoo");
    return {
      symbol: symbol.toUpperCase(),
      currency: result.meta.currency?.toUpperCase() ?? "USD",
      closes,
      dates,
      source: "yahoo",
      meta: {
        fiftyTwoWeekHigh: result.meta.fiftyTwoWeekHigh ?? null,
        fiftyTwoWeekLow: result.meta.fiftyTwoWeekLow ?? null,
        currentPrice: result.meta.regularMarketPrice ?? null,
      },
    };
  } catch {
    recordFailure("yahoo");
    return null;
  }
}

const CRYPTO_IDS: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", BNB: "binancecoin",
  XRP: "ripple", ADA: "cardano", AVAX: "avalanche-2", DOT: "polkadot",
  MATIC: "matic-network", LINK: "chainlink", DOGE: "dogecoin", TRX: "tron",
  LTC: "litecoin", ATOM: "cosmos", UNI: "uniswap", USDT: "tether",
  USDC: "usd-coin",
};

interface GeckoChart {
  prices?: Array<[number, number]>;
}

interface GeckoMarket {
  current_price?: number;
  market_cap_rank?: number;
  ath_change_percentage?: number;
  price_change_percentage_7d_in_currency?: number;
  price_change_percentage_30d_in_currency?: number;
  price_change_percentage_1y_in_currency?: number;
}

async function fetchCryptoHistory(symbol: string): Promise<PriceHistory | null> {
  const id = CRYPTO_IDS[symbol.toUpperCase()];
  if (!id) return null;

  const bucket = getBucket("coingecko");
  if (isBackedOff("coingecko") || !bucket.tryTake()) return null;

  try {
    const [chart, markets] = await Promise.all([
      fetchJson<GeckoChart>(
        `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=365&interval=daily`,
        "coingecko",
      ),
      fetchJson<GeckoMarket[]>(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${id}` +
          `&price_change_percentage=7d,30d,1y`,
        "coingecko",
      ),
    ]);

    const closes: number[] = [];
    const dates: string[] = [];
    for (const [ts, price] of chart.prices ?? []) {
      if (Number.isFinite(price) && price > 0) {
        closes.push(price);
        dates.push(new Date(ts).toISOString().slice(0, 10));
      }
    }

    const m = markets?.[0] ?? {};
    recordSuccess("coingecko");

    return {
      symbol: symbol.toUpperCase(),
      currency: "USD",
      closes,
      dates,
      source: "coingecko",
      meta: {
        fiftyTwoWeekHigh: closes.length > 0 ? Math.max(...closes) : null,
        fiftyTwoWeekLow: closes.length > 0 ? Math.min(...closes) : null,
        currentPrice: m.current_price ?? null,
        marketCapRank: m.market_cap_rank ?? null,
        athChangePct: m.ath_change_percentage ?? null,
        change7d: m.price_change_percentage_7d_in_currency ?? null,
        change30d: m.price_change_percentage_30d_in_currency ?? null,
        change1y: m.price_change_percentage_1y_in_currency ?? null,
      },
    };
  } catch {
    recordFailure("coingecko");
    return null;
  }
}
