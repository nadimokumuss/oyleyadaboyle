import Decimal from "decimal.js";
import { Money, toDecimal, type CurrencyCode } from "@/lib/money";
import type { Transaction } from "@/db/schema";

/**
 * Pozisyon ve maliyet hesabı.
 *
 * İki maliyet yöntemi paralel yürütülür:
 *  - WAC (ağırlıklı ortalama): günlük K/Z gösterimi için
 *  - FIFO (lot bazlı):         vergi mahsubu senaryoları için
 *
 * İkisi farklı sonuç verir ve ikisi de doğrudur — hangisinin
 * kullanılacağı soruya bağlıdır, o yüzden ikisi de tutulur.
 */

export interface FifoLot {
  qty: string;
  price: string; // birim maliyet
  date: string;
}

export interface Position {
  assetId: string;
  currency: CurrencyCode;
  /** Elde kalan miktar. */
  quantity: Decimal;
  /** Birim başına ağırlıklı ortalama maliyet. */
  wacPerUnit: Money;
  /** Elde kalan miktarın toplam maliyeti (WAC × miktar). */
  totalCost: Money;
  /** Satışlardan gerçekleşen kâr/zarar (WAC yöntemine göre). */
  realizedPnl: Money;
  /** FIFO yöntemine göre gerçekleşen kâr/zarar. */
  realizedPnlFifo: Money;
  /** Açık FIFO lotları — vergi mahsubu taraması bunları kullanır. */
  lots: FifoLot[];
  /** Alım dışı nakit girişleri: temettü, faiz, kira, staking. */
  incomeReceived: Money;
  /** Komisyon, vergi ve giderler toplamı. */
  costsPaid: Money;
}

const BUY_TYPES = new Set(["buy", "deposit_in", "capital_call"]);
const SELL_TYPES = new Set(["sell", "withdraw", "distribution"]);
const INCOME_TYPES = new Set(["dividend", "interest", "rent", "staking"]);
const COST_TYPES = new Set(["expense", "fee", "tax"]);

/**
 * İşlem listesinden pozisyon türetir.
 *
 * İşlemler tarihe göre sıralanır — sıra önemlidir, FIFO buna bağlı.
 * Aynı gün içindeki işlemler için kayıt sırası (id) tie-breaker.
 */
export function computePosition(
  assetId: string,
  currency: CurrencyCode,
  transactions: Transaction[],
): Position {
  const sorted = [...transactions].sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    return d !== 0 ? d : a.createdAt.localeCompare(b.createdAt);
  });

  let quantity = new Decimal(0);
  let totalCost = Money.zero(currency); // elde kalanın maliyeti
  let realizedPnl = Money.zero(currency);
  let realizedPnlFifo = Money.zero(currency);
  let incomeReceived = Money.zero(currency);
  let costsPaid = Money.zero(currency);
  let lots: FifoLot[] = [];

  for (const tx of sorted) {
    const amount = Money.fromDb(tx.amount, tx.currency);
    const fee = Money.fromDb(tx.fee, tx.currency);

    if (INCOME_TYPES.has(tx.type)) {
      incomeReceived = incomeReceived.plus(amount);
      if (!fee.isZero()) costsPaid = costsPaid.plus(fee);
      continue;
    }

    if (COST_TYPES.has(tx.type)) {
      costsPaid = costsPaid.plus(amount);
      continue;
    }

    if (tx.type === "valuation") continue; // nakit akışı yok

    const qty = tx.quantity ? toDecimal(tx.quantity) : new Decimal(0);

    if (BUY_TYPES.has(tx.type)) {
      // Komisyon maliyete eklenir — gerçek maliyet budur
      const grossCost = amount.plus(fee);
      quantity = quantity.plus(qty);
      totalCost = totalCost.plus(grossCost);
      if (qty.greaterThan(0)) {
        lots.push({
          qty: qty.toFixed(),
          price: grossCost.dividedBy(qty).toDb(),
          date: tx.date,
        });
      }
      continue;
    }

    if (SELL_TYPES.has(tx.type)) {
      // Nakit gibi "adetsiz" varlıklarda çıkış doğrudan bakiyeyi azaltır.
      // Miktar aramak bu işlemleri sessizce yutardı — nakit çıkışı
      // hiç kaydedilmez, bakiye olduğundan yüksek görünürdü.
      if (tx.quantity === null || tx.quantity === undefined || tx.quantity === "") {
        totalCost = totalCost.minus(amount.plus(fee));
        continue;
      }

      if (qty.lessThanOrEqualTo(0) || quantity.lessThanOrEqualTo(0)) continue;

      // Elde olandan fazlası satılamaz — veri hatasına karşı kırp
      const soldQty = Decimal.min(qty, quantity);
      const proceeds = amount.minus(fee); // komisyon hasılattan düşer

      // --- WAC ---
      const wacPerUnit = quantity.isZero()
        ? Money.zero(currency)
        : totalCost.dividedBy(quantity);
      const wacCostOfSold = wacPerUnit.times(soldQty);
      realizedPnl = realizedPnl.plus(proceeds.minus(wacCostOfSold));
      totalCost = totalCost.minus(wacCostOfSold);

      // --- FIFO ---
      const { costOfSold, remainingLots } = consumeFifo(lots, soldQty, currency);
      realizedPnlFifo = realizedPnlFifo.plus(proceeds.minus(costOfSold));
      lots = remainingLots;

      quantity = quantity.minus(soldQty);

      // Pozisyon tamamen kapandıysa artık maliyeti sıfırla
      // (yuvarlama artığı taşımamak için)
      if (quantity.isZero()) {
        totalCost = Money.zero(currency);
        lots = [];
      }
    }
  }

  const wacPerUnit = quantity.greaterThan(0)
    ? totalCost.dividedBy(quantity)
    : Money.zero(currency);

  return {
    assetId,
    currency,
    quantity,
    wacPerUnit,
    totalCost,
    realizedPnl,
    realizedPnlFifo,
    lots,
    incomeReceived,
    costsPaid,
  };
}

/** FIFO lotlarından `soldQty` kadar tüketir, tüketilenin maliyetini döner. */
function consumeFifo(
  lots: FifoLot[],
  soldQty: Decimal,
  currency: CurrencyCode,
): { costOfSold: Money; remainingLots: FifoLot[] } {
  let remaining = soldQty;
  let costOfSold = Money.zero(currency);
  const out: FifoLot[] = [];

  for (const lot of lots) {
    if (remaining.lessThanOrEqualTo(0)) {
      out.push(lot);
      continue;
    }
    const lotQty = toDecimal(lot.qty);
    const take = Decimal.min(lotQty, remaining);
    costOfSold = costOfSold.plus(Money.of(lot.price, currency).times(take));
    remaining = remaining.minus(take);

    const left = lotQty.minus(take);
    if (left.greaterThan(0)) {
      out.push({ ...lot, qty: left.toFixed() });
    }
  }

  return { costOfSold, remainingLots: out };
}

/** Canlı fiyata göre pozisyonun güncel değeri ve gerçekleşmemiş K/Z. */
export interface PositionValuation {
  marketValue: Money;
  unrealizedPnl: Money;
  /** Maliyete göre getiri oranı. Maliyet sıfırsa null. */
  returnRatio: Decimal | null;
}

export function valuePosition(position: Position, livePrice: Money): PositionValuation {
  const marketValue = livePrice.times(position.quantity);
  const unrealizedPnl = marketValue.minus(position.totalCost);
  const returnRatio = position.totalCost.isZero()
    ? null
    : unrealizedPnl.ratioTo(position.totalCost);
  return { marketValue, unrealizedPnl, returnRatio };
}
