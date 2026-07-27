import { db } from "@/db/client";
import { assets, transactions } from "@/db/schema";
import { Money, type CurrencyCode } from "@/lib/money";
import { computePosition } from "./costbasis";
import { analyzeDividends, type DividendAnalysis } from "./dividends";

/**
 * Temettü analizini DB'ye bağlar.
 *
 * Ayrı dosyada çünkü `dividends.ts` saf ve test edilebilir kalmalı;
 * veritabanına dokunan kısım burada.
 */

export interface DividendRow {
  assetId: string;
  assetName: string;
  symbol: string | null;
  kind: string;
  analysis: DividendAnalysis;
}

const INCOME_KINDS = new Set(["equity", "crypto", "commodity"]);

/**
 * Temettü ödemesi olan varlıkların analizini döner.
 *
 * Satılmış varlıklar dışarıda: geçmişte aldığınız temettü gerçek ama
 * gelecek gelir tahminine giremez, pozisyon artık yok.
 */
export function loadDividendAnalyses(now = new Date()): DividendRow[] {
  const rows = db
    .select()
    .from(assets)
    .all()
    .filter((a) => a.status === "active" && INCOME_KINDS.has(a.kind));

  if (rows.length === 0) return [];

  const allTx = db.select().from(transactions).all();
  const txByAsset = new Map<string, typeof allTx>();
  for (const tx of allTx) {
    const list = txByAsset.get(tx.assetId);
    if (list) list.push(tx);
    else txByAsset.set(tx.assetId, [tx]);
  }

  const out: DividendRow[] = [];

  for (const asset of rows) {
    const tx = txByAsset.get(asset.id);
    if (!tx || tx.length === 0) continue;

    const currency = asset.currency as CurrencyCode;
    const position = computePosition(asset.id, currency, tx);
    const analysis = analyzeDividends(asset.id, currency, tx, position.totalCost, now);

    // Hiç gelir ödememiş varlığı listelemek gürültü olur.
    if (analysis.lifetime.isZero()) continue;

    out.push({
      assetId: asset.id,
      assetName: asset.name,
      symbol: asset.symbol,
      kind: asset.kind,
      analysis,
    });
  }

  return out.sort((a, b) =>
    b.analysis.trailingTwelveMonths.amount.comparedTo(
      a.analysis.trailingTwelveMonths.amount,
    ),
  );
}

/** Nakit akışı sayfası için: toplam beklenen yıllık gelir, USD. */
export function totalForwardIncome(
  rows: DividendRow[],
  toUsd: (m: Money) => Money,
): Money {
  return rows.reduce(
    (acc, r) => acc.plus(toUsd(r.analysis.forwardEstimate)),
    Money.zero("USD"),
  );
}
