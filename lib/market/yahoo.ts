import {
  type MarketProvider,
  type Quote,
  fetchJson,
  numToDecimalString,
  ProviderError,
} from "./provider";

/**
 * Yahoo Finance — hisse, ETF, endeks, emtia ve BIST (.IS).
 *
 * NOT: v7/finance/quote ucu artık "Unauthorized" dönüyor (crumb/cookie
 * istiyor). v8/finance/chart hâlâ anahtarsız çalışıyor ve bize gereken
 * her şeyi veriyor, o yüzden onu kullanıyoruz. Bedeli: sembol başına bir
 * çağrı — bu yüzden batchSize 1 ve çağrılar sınırlı eşzamanlılıkla
 * paralelleştiriliyor.
 *
 * BIST verisi ~15 dakika gecikmelidir; arayüz bunu rozetle belirtir.
 */

interface ChartResponse {
  chart: {
    result?: Array<{
      meta: {
        symbol: string;
        currency: string;
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        regularMarketTime?: number;
      };
    }> | null;
    error?: { code: string; description: string } | null;
  };
}

const CONCURRENCY = 4;

export class YahooProvider implements MarketProvider {
  readonly name = "yahoo";
  readonly batchSize = 1;

  async fetchQuotes(symbols: string[]): Promise<Quote[]> {
    const out: Quote[] = [];
    // Sınırlı eşzamanlılık: Yahoo'yu paralel isteklerle boğmamak için
    for (let i = 0; i < symbols.length; i += CONCURRENCY) {
      const chunk = symbols.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(chunk.map((s) => this.fetchOne(s)));
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) out.push(r.value);
        // reddedilenler sessizce atlanır — cache katmanı son bilinen
        // fiyata düşecek. Uydurma fiyat asla üretilmez.
      }
    }
    return out;
  }

  private async fetchOne(symbol: string): Promise<Quote | null> {
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?interval=1d&range=1d`;
    const data = await fetchJson<ChartResponse>(url, this.name);

    if (data.chart.error) {
      throw new ProviderError(this.name, `${symbol}: ${data.chart.error.description}`);
    }
    const meta = data.chart.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) return null;

    const prev = meta.chartPreviousClose ?? meta.previousClose;
    const changePct =
      prev && prev !== 0
        ? numToDecimalString((meta.regularMarketPrice - prev) / prev)
        : null;

    return {
      symbol,
      price: numToDecimalString(meta.regularMarketPrice),
      currency: meta.currency?.toUpperCase() ?? "USD",
      changePct24h: changePct,
      asOf: meta.regularMarketTime
        ? new Date(meta.regularMarketTime * 1000)
        : new Date(),
      source: this.name,
      stale: false,
    };
  }
}
