import Decimal from "decimal.js";
import { Money, toDecimal, type CurrencyCode } from "@/lib/money";
import type { Transaction } from "@/db/schema";

/**
 * Gerçekleşen kâr/zarar **olayları**.
 *
 * `computePosition` gerçekleşen K/Z'yi tek bir toplam olarak döner —
 * günlük gösterim için yeterli, vergi için değil. Vergi beyanı
 * "hangi tarihte, ne kadar, ne kadar süre elde tutulmuş" sorusunu
 * sorar; bu modül o ayrıntıyı üretir.
 *
 * Aynı FIFO mantığı üzerine kurulu, ama lot'ların **alım tarihi**
 * korunuyor — elde tutma süresi ancak böyle hesaplanabilir.
 *
 * > Bu bir vergi hesaplama aracı değildir. Mevzuat ülkeye göre değişir,
 * > istisnalar ve indirimler burada modellenmez. Rakamlar beyan için
 * > başlangıç noktasıdır, sonuç değil.
 */

/**
 * Lot seçim yöntemi.
 *
 * - `fifo`: en eski lot önce satılır (çoğu ülkenin varsayılanı)
 * - `lifo`: en yeni lot önce
 * - `hifo`: en pahalı lot önce — gerçekleşen kârı en aza indirir
 *
 * Yöntem sonucu değiştirir ve üçü de "doğru"dur; hangisinin geçerli
 * olduğu bulunduğunuz ülkenin mevzuatına bağlıdır.
 */
export type LotMethod = "fifo" | "lifo" | "hifo";

export interface OpenLot {
  qty: string;
  /** Birim maliyet (komisyon dahil). */
  price: string;
  /** Alım tarihi — elde tutma süresi bundan hesaplanır. */
  date: string;
}

export interface ConsumedLot {
  qty: string;
  price: string;
  acquiredAt: string;
  /** Alımdan satışa geçen gün sayısı. */
  holdingDays: number;
  /** Uzun vade eşiğini aştı mı? */
  longTerm: boolean;
  /** Bu lot'tan doğan kâr/zarar. */
  gain: string;
}

export interface RealizedEvent {
  assetId: string;
  date: string;
  currency: CurrencyCode;
  quantity: string;
  /** Komisyon düşülmüş satış hasılatı. */
  proceeds: string;
  /** Satılan lot'ların toplam maliyeti. */
  costBasis: string;
  gain: string;
  shortTermGain: string;
  longTermGain: string;
  lots: ConsumedLot[];
}

const BUY_TYPES = new Set(["buy", "deposit_in", "capital_call"]);
const SELL_TYPES = new Set(["sell", "withdraw", "distribution"]);

const MS_PER_DAY = 86_400_000;

/** Uzun vade varsayılan eşiği (gün). Ayarlardan değiştirilebilir. */
export const DEFAULT_LONG_TERM_DAYS = 365;

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso.slice(0, 10)).getTime();
  const to = new Date(toIso.slice(0, 10)).getTime();
  return Math.max(0, Math.round((to - from) / MS_PER_DAY));
}

/**
 * Lot'ları seçilen yönteme göre tüketim sırasına dizer.
 *
 * Kopya döner — çağıranın listesi bozulmaz. HIFO'da eşit fiyatlı lot'lar
 * için tarih tie-breaker: sonuç deterministik olmalı.
 */
function orderLots(lots: OpenLot[], method: LotMethod): OpenLot[] {
  const copy = [...lots];
  if (method === "fifo") return copy;
  if (method === "lifo") return copy.reverse();

  return copy.sort((a, b) => {
    const d = new Decimal(b.price).comparedTo(new Decimal(a.price));
    return d !== 0 ? d : a.date.localeCompare(b.date);
  });
}

/**
 * İşlemlerden gerçekleşen K/Z olaylarını çıkarır.
 *
 * Miktarsız çıkışlar (nakit çekimi gibi) atlanır — onlar bir varlığın
 * elden çıkarılması değil, bakiye hareketidir.
 */
export function realizedEvents(
  assetId: string,
  currency: CurrencyCode,
  transactions: Transaction[],
  opts: { method?: LotMethod; longTermDays?: number } = {},
): RealizedEvent[] {
  const method = opts.method ?? "fifo";
  const longTermDays = opts.longTermDays ?? DEFAULT_LONG_TERM_DAYS;

  const sorted = [...transactions].sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    return d !== 0 ? d : a.createdAt.localeCompare(b.createdAt);
  });

  let open: OpenLot[] = [];
  let quantity = new Decimal(0);
  const events: RealizedEvent[] = [];

  for (const tx of sorted) {
    if (tx.type === "valuation") continue;

    const amount = Money.fromDb(tx.amount, tx.currency);
    const fee = Money.fromDb(tx.fee, tx.currency);
    const qty = tx.quantity ? toDecimal(tx.quantity) : new Decimal(0);

    if (BUY_TYPES.has(tx.type)) {
      if (qty.lessThanOrEqualTo(0)) continue;
      const grossCost = amount.plus(fee);
      open.push({
        qty: qty.toFixed(),
        price: grossCost.dividedBy(qty).toDb(),
        date: tx.date,
      });
      quantity = quantity.plus(qty);
      continue;
    }

    if (!SELL_TYPES.has(tx.type)) continue;

    // Adetsiz çıkış bir elden çıkarma değil — vergi olayı doğurmaz.
    if (!tx.quantity || qty.lessThanOrEqualTo(0)) continue;
    if (quantity.lessThanOrEqualTo(0)) continue;

    const soldQty = Decimal.min(qty, quantity);
    const proceeds = amount.minus(fee);
    // Kısmi satışta hasılat orantılı bölünür.
    const proceedsPerUnit = proceeds.dividedBy(soldQty);

    const ordered = orderLots(open, method);
    const consumed: ConsumedLot[] = [];
    let remaining = soldQty;
    let costBasis = Money.zero(currency);
    let shortTerm = Money.zero(currency);
    let longTerm = Money.zero(currency);
    const leftovers: OpenLot[] = [];

    for (const lot of ordered) {
      if (remaining.lessThanOrEqualTo(0)) {
        leftovers.push(lot);
        continue;
      }
      const lotQty = toDecimal(lot.qty);
      const take = Decimal.min(lotQty, remaining);

      const lotCost = Money.of(lot.price, currency).times(take);
      const lotProceeds = proceedsPerUnit.times(take);
      const lotGain = lotProceeds.minus(lotCost);
      const holdingDays = daysBetween(lot.date, tx.date);
      const isLong = holdingDays >= longTermDays;

      costBasis = costBasis.plus(lotCost);
      if (isLong) longTerm = longTerm.plus(lotGain);
      else shortTerm = shortTerm.plus(lotGain);

      consumed.push({
        qty: take.toFixed(),
        price: lot.price,
        acquiredAt: lot.date,
        holdingDays,
        longTerm: isLong,
        gain: lotGain.toDb(),
      });

      remaining = remaining.minus(take);
      const left = lotQty.minus(take);
      if (left.greaterThan(0)) leftovers.push({ ...lot, qty: left.toFixed() });
    }

    // FIFO'da sıra korunmalı; LIFO/HIFO yeniden sıralamış olabilir.
    open = method === "fifo"
      ? leftovers
      : [...leftovers].sort((a, b) => a.date.localeCompare(b.date));

    quantity = quantity.minus(soldQty);
    if (quantity.lessThanOrEqualTo(0)) open = [];

    events.push({
      assetId,
      date: tx.date,
      currency,
      quantity: soldQty.toFixed(),
      proceeds: proceeds.toDb(),
      costBasis: costBasis.toDb(),
      gain: proceeds.minus(costBasis).toDb(),
      shortTermGain: shortTerm.toDb(),
      longTermGain: longTerm.toDb(),
      lots: consumed,
    });
  }

  return events;
}
