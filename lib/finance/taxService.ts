import Decimal from "decimal.js";
import { db } from "@/db/client";
import { assets, transactions, deposits } from "@/db/schema";
import { Money, type CurrencyCode } from "@/lib/money";
import { getFx } from "@/lib/market/fxStore";
import {
  realizedEvents,
  DEFAULT_LONG_TERM_DAYS,
  type LotMethod,
  type RealizedEvent,
} from "./realized";
import { buildTerms, loadWithholdingRules } from "./depositService";
import { accrue } from "./deposit";

/**
 * Takvim yılı bazında gerçekleşen kâr/zarar ve ödenen stopaj.
 *
 * Panelin geri kalanı "bugün ne durumdayım" sorusuna cevap verir; burası
 * "geçen yıl ne oldu" sorusuna. İkisi farklı sorulardır ve ikincisi
 * beyan zamanı sorulur.
 *
 * ## Para birimi
 *
 * Her satır **kendi para biriminde** de tutulur, USD karşılığı da. Beyan
 * yerel parada yapılır ama toplamı görebilmek için ortak birim gerekir.
 * Çevrim bugünkü kurladır — geçmiş kurla yapılması daha doğru olurdu ama
 * `transactions.fxRateToUsd` her kayıtta dolu değil; eksik kurla sessizce
 * yanlış rakam üretmektense bugünkü kuru kullanıp bunu söylüyoruz.
 */

export interface TaxLine {
  assetId: string;
  assetName: string;
  symbol: string | null;
  kind: string;
  currency: string;
  date: string;
  quantity: string;
  proceeds: string;
  costBasis: string;
  gain: string;
  proceedsUsd: string;
  gainUsd: string;
  shortTermGain: string;
  longTermGain: string;
  shortTermGainUsd: string;
  longTermGainUsd: string;
  /** Bu satıştaki en uzun elde tutma süresi (gün). */
  maxHoldingDays: number;
}

export interface TaxYear {
  year: number;
  lines: TaxLine[];
  totals: {
    proceedsUsd: string;
    gainUsd: string;
    shortTermUsd: string;
    longTermUsd: string;
    /** Yalnızca kârda olan satışların toplamı. */
    gainsOnlyUsd: string;
    /** Yalnızca zararda olan satışların toplamı (negatif). */
    lossesOnlyUsd: string;
  };
  /** Mevduatlarda bugüne kadar kesilen stopaj (tahakkuk üzerinden). */
  depositWithholdingUsd: string;
}

export interface TaxReport {
  years: TaxYear[];
  method: LotMethod;
  longTermDays: number;
  /** Kur çevrimi yapılamayan para birimleri — toplamda eksik kalırlar. */
  unconvertedCurrencies: string[];
}

const MARKET_KINDS = new Set(["equity", "crypto", "commodity"]);

export async function loadTaxReport(
  opts: { method?: LotMethod; longTermDays?: number } = {},
): Promise<TaxReport> {
  const method = opts.method ?? "fifo";
  const longTermDays = opts.longTermDays ?? DEFAULT_LONG_TERM_DAYS;

  const fx = await getFx();
  const allAssets = db.select().from(assets).all();
  const allTx = db.select().from(transactions).all();

  const txByAsset = new Map<string, typeof allTx>();
  for (const tx of allTx) {
    const list = txByAsset.get(tx.assetId);
    if (list) list.push(tx);
    else txByAsset.set(tx.assetId, [tx]);
  }

  const unconverted = new Set<string>();
  const toUsd = (m: Money): Money => {
    if (fx.converter.has(m.currency)) return fx.converter.toBase(m);
    unconverted.add(m.currency);
    return Money.zero("USD");
  };

  const byYear = new Map<number, TaxLine[]>();

  for (const asset of allAssets) {
    // Satılmış varlıklar da dahil: vergi olayı tam da onlarda doğar.
    if (!MARKET_KINDS.has(asset.kind)) continue;

    const tx = txByAsset.get(asset.id);
    if (!tx || tx.length === 0) continue;

    const events = realizedEvents(
      asset.id,
      asset.currency as CurrencyCode,
      tx,
      { method, longTermDays },
    );

    for (const e of events) {
      const year = Number(e.date.slice(0, 4));
      const line = toLine(asset, e, toUsd);
      const list = byYear.get(year);
      if (list) list.push(line);
      else byYear.set(year, [line]);
    }
  }

  const depositWithholding = depositWithholdingByYear(toUsd);

  const years: TaxYear[] = [...byYear.entries()]
    .map(([year, lines]) => ({
      year,
      lines: lines.sort((a, b) => a.date.localeCompare(b.date)),
      totals: sumLines(lines),
      depositWithholdingUsd: depositWithholding.get(year) ?? "0",
    }))
    .sort((a, b) => b.year - a.year);

  // Satış olmayan ama stopaj kesilen yıllar da görünmeli.
  for (const [year, amount] of depositWithholding) {
    if (years.some((y) => y.year === year)) continue;
    years.push({
      year,
      lines: [],
      totals: sumLines([]),
      depositWithholdingUsd: amount,
    });
  }
  years.sort((a, b) => b.year - a.year);

  return {
    years,
    method,
    longTermDays,
    unconvertedCurrencies: [...unconverted],
  };
}

function toLine(
  asset: typeof assets.$inferSelect,
  e: RealizedEvent,
  toUsd: (m: Money) => Money,
): TaxLine {
  // Her tutar tek tek çevrilir — oranla taşımak yuvarlama hatası biriktirir.
  const local = (v: string) => Money.of(v, e.currency);
  return {
    assetId: asset.id,
    assetName: asset.name,
    symbol: asset.symbol,
    kind: asset.kind,
    currency: e.currency,
    date: e.date,
    quantity: e.quantity,
    proceeds: e.proceeds,
    costBasis: e.costBasis,
    gain: e.gain,
    proceedsUsd: toUsd(local(e.proceeds)).toDb(),
    gainUsd: toUsd(local(e.gain)).toDb(),
    shortTermGain: e.shortTermGain,
    longTermGain: e.longTermGain,
    shortTermGainUsd: toUsd(local(e.shortTermGain)).toDb(),
    longTermGainUsd: toUsd(local(e.longTermGain)).toDb(),
    maxHoldingDays: e.lots.reduce((a, l) => Math.max(a, l.holdingDays), 0),
  };
}

function sumLines(lines: TaxLine[]): TaxYear["totals"] {
  let proceeds = new Decimal(0);
  let gain = new Decimal(0);
  let short = new Decimal(0);
  let long = new Decimal(0);
  let gainsOnly = new Decimal(0);
  let lossesOnly = new Decimal(0);

  // Farklı para birimlerindeki ham tutarlar doğrudan toplanamaz;
  // toplamlar yalnızca USD karşılıkları üzerinden yapılır.
  for (const l of lines) {
    const g = new Decimal(l.gainUsd);
    gain = gain.plus(g);
    if (g.isPositive()) gainsOnly = gainsOnly.plus(g);
    else lossesOnly = lossesOnly.plus(g);

    short = short.plus(l.shortTermGainUsd);
    long = long.plus(l.longTermGainUsd);
    proceeds = proceeds.plus(l.proceedsUsd);
  }

  return {
    proceedsUsd: proceeds.toDecimalPlaces(2).toFixed(),
    gainUsd: gain.toDecimalPlaces(2).toFixed(),
    shortTermUsd: short.toDecimalPlaces(2).toFixed(),
    longTermUsd: long.toDecimalPlaces(2).toFixed(),
    gainsOnlyUsd: gainsOnly.toDecimalPlaces(2).toFixed(),
    lossesOnlyUsd: lossesOnly.toDecimalPlaces(2).toFixed(),
  };
}

/**
 * Mevduat stopajı.
 *
 * Mevduat faizi tahakkukla hesaplanır, işlem kaydı doğurmaz — bu yüzden
 * stopaj da işlemlerden okunamaz. Vadesi dolan mevduatın kesintisi
 * vade yılına, devam edenlerinki bu yıla yazılır.
 *
 * Bu bir yaklaşımdır: gerçek kesinti banka tarafından vade sonunda
 * yapılır ve tutarı burada modellenenden farklı olabilir.
 */
function depositWithholdingByYear(toUsd: (m: Money) => Money): Map<number, string> {
  const rules = loadWithholdingRules();
  const out = new Map<number, Decimal>();

  const depositRows = db.select().from(deposits).all();
  const assetById = new Map(db.select().from(assets).all().map((a) => [a.id, a]));

  for (const row of depositRows) {
    const asset = assetById.get(row.assetId);
    if (!asset) continue;

    const terms = buildTerms(row, asset.currency, rules);
    const snap = accrue(terms, new Date());
    if (snap.withholding.isZero()) continue;

    const year = snap.matured && terms.maturityDate
      ? terms.maturityDate.getFullYear()
      : new Date().getFullYear();

    const usd = new Decimal(toUsd(snap.withholding).toDb());
    out.set(year, (out.get(year) ?? new Decimal(0)).plus(usd));
  }

  return new Map(
    [...out.entries()].map(([y, v]) => [y, v.toDecimalPlaces(2).toFixed()]),
  );
}
