import { fetchJson, numToDecimalString, ProviderError } from "./provider";

/**
 * Frankfurter — ECB referans kurları, anahtarsız.
 *
 * Kurlar günlük yayınlanır (hafta içi), o yüzden TTL uzun tutulabilir.
 * Dönen tablo: 1 USD = kaç birim hedef para.
 */

interface LatestResponse {
  amount: number;
  base: string;
  date: string;
  rates: Record<string, number>;
}

/** Panelde kullanılan para birimleri. */
export const TRACKED_CURRENCIES = [
  "TRY", "EUR", "GBP", "CHF", "JPY", "CAD", "AUD", "SEK", "NOK", "PLN", "CZK",
] as const;

export interface FxSnapshot {
  /** 1 USD = kaç birim (USD dahil, değeri 1). */
  rates: Record<string, string>;
  date: string;
  asOf: Date;
  source: string;
}

export async function fetchFxRates(
  symbols: readonly string[] = TRACKED_CURRENCIES,
): Promise<FxSnapshot> {
  const url =
    `https://api.frankfurter.dev/v1/latest?base=USD&symbols=` +
    encodeURIComponent(symbols.join(","));

  const data = await fetchJson<LatestResponse>(url, "frankfurter");
  if (!data.rates || Object.keys(data.rates).length === 0) {
    throw new ProviderError("frankfurter", "boş kur tablosu döndü");
  }

  const rates: Record<string, string> = { USD: "1" };
  for (const [code, value] of Object.entries(data.rates)) {
    if (typeof value === "number" && value > 0) {
      rates[code.toUpperCase()] = numToDecimalString(value);
    }
  }

  return {
    rates,
    date: data.date,
    asOf: new Date(),
    source: "frankfurter",
  };
}
