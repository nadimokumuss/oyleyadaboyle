import Decimal from "decimal.js";

/**
 * Para aritmetiğinin TEK kaynağı.
 *
 * Kural: bu dosyanın dışında hiçbir yerde tutarlar üzerinde `+ - * /`
 * kullanılmaz. JavaScript'in float aritmetiği para için güvenli değildir
 * (0.1 + 0.2 !== 0.3). Her tutar Decimal olarak taşınır, DB'ye ondalık
 * string olarak yazılır.
 */

// 28 anlamlı basamak: 10M USD'yi kuruşuna kadar taşımak için fazlasıyla yeterli,
// bileşik faiz üstel hesaplarında da hassasiyet kaybı vermez.
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN });

export type CurrencyCode = string; // "USD" | "TRY" | "EUR" | ...

/** Bir para biriminin kaç ondalık basamakla gösterileceği. */
const DISPLAY_DECIMALS: Record<string, number> = {
  USD: 2,
  EUR: 2,
  TRY: 2,
  GBP: 2,
  CHF: 2,
  AED: 2,
  JPY: 0,
  BTC: 8,
  ETH: 8,
};

function displayDecimals(currency: CurrencyCode): number {
  return DISPLAY_DECIMALS[currency.toUpperCase()] ?? 2;
}

export type MoneyInput = Money | Decimal | string | number;

/**
 * Değişmez (immutable) para nesnesi. Her işlem yeni bir Money döner.
 * Para birimi taşır — farklı birimleri toplamak çalışma anında hata verir,
 * sessizce yanlış sonuç üretmez.
 */
export class Money {
  readonly amount: Decimal;
  readonly currency: CurrencyCode;

  private constructor(amount: Decimal, currency: CurrencyCode) {
    this.amount = amount;
    this.currency = currency.toUpperCase();
  }

  static of(value: MoneyInput, currency?: CurrencyCode): Money {
    if (value instanceof Money) {
      if (currency && value.currency !== currency.toUpperCase()) {
        throw new Error(
          `Para birimi çelişkisi: ${value.currency} değeri ${currency} olarak yorumlanamaz`,
        );
      }
      return value;
    }
    if (!currency) {
      throw new Error("Money.of: para birimi zorunlu");
    }
    return new Money(toDecimal(value), currency);
  }

  static zero(currency: CurrencyCode): Money {
    return new Money(new Decimal(0), currency);
  }

  /** DB'den okunan `{ amount: string, currency: string }` çifti için. */
  static fromDb(amount: string | null | undefined, currency: CurrencyCode): Money {
    if (amount === null || amount === undefined || amount === "") {
      return Money.zero(currency);
    }
    return new Money(new Decimal(amount), currency);
  }

  private assertSameCurrency(other: Money, op: string): void {
    if (this.currency !== other.currency) {
      throw new Error(
        `${op}: farklı para birimleri toplanamaz (${this.currency} vs ${other.currency}). ` +
          `Önce lib/fx.ts ile çevirin.`,
      );
    }
  }

  plus(other: Money): Money {
    this.assertSameCurrency(other, "plus");
    return new Money(this.amount.plus(other.amount), this.currency);
  }

  minus(other: Money): Money {
    this.assertSameCurrency(other, "minus");
    return new Money(this.amount.minus(other.amount), this.currency);
  }

  /** Skalerle çarpım — adet, oran, yüzde gibi birimsiz sayılarla. */
  times(factor: Decimal | string | number): Money {
    return new Money(this.amount.times(toDecimal(factor)), this.currency);
  }

  /** Skalere bölüm. */
  dividedBy(divisor: Decimal | string | number): Money {
    const d = toDecimal(divisor);
    if (d.isZero()) throw new Error("dividedBy: sıfıra bölme");
    return new Money(this.amount.dividedBy(d), this.currency);
  }

  /** İki para değerinin oranı (birimsiz). Aynı para biriminde olmalı. */
  ratioTo(other: Money): Decimal {
    this.assertSameCurrency(other, "ratioTo");
    if (other.amount.isZero()) throw new Error("ratioTo: sıfıra bölme");
    return this.amount.dividedBy(other.amount);
  }

  negated(): Money {
    return new Money(this.amount.negated(), this.currency);
  }

  abs(): Money {
    return new Money(this.amount.abs(), this.currency);
  }

  isZero(): boolean {
    return this.amount.isZero();
  }
  isNegative(): boolean {
    return this.amount.isNegative() && !this.amount.isZero();
  }
  isPositive(): boolean {
    return this.amount.greaterThan(0);
  }

  gt(other: Money): boolean {
    this.assertSameCurrency(other, "gt");
    return this.amount.greaterThan(other.amount);
  }
  gte(other: Money): boolean {
    this.assertSameCurrency(other, "gte");
    return this.amount.greaterThanOrEqualTo(other.amount);
  }
  lt(other: Money): boolean {
    this.assertSameCurrency(other, "lt");
    return this.amount.lessThan(other.amount);
  }
  lte(other: Money): boolean {
    this.assertSameCurrency(other, "lte");
    return this.amount.lessThanOrEqualTo(other.amount);
  }
  eq(other: Money): boolean {
    this.assertSameCurrency(other, "eq");
    return this.amount.equals(other.amount);
  }

  /** Para birimini değiştirir — SADECE fx.ts kur uygularken kullanmalı. */
  withCurrency(currency: CurrencyCode): Money {
    return new Money(this.amount, currency);
  }

  /** Gösterim hassasiyetine yuvarlanmış yeni Money. */
  round(decimals = displayDecimals(this.currency)): Money {
    return new Money(
      this.amount.toDecimalPlaces(decimals, Decimal.ROUND_HALF_EVEN),
      this.currency,
    );
  }

  /** DB'ye yazmak için tam hassasiyetli ondalık string. */
  toDb(): string {
    return this.amount.toFixed();
  }

  toNumber(): number {
    return this.amount.toNumber();
  }

  toString(): string {
    return `${this.amount.toFixed(displayDecimals(this.currency))} ${this.currency}`;
  }

  toJSON(): { amount: string; currency: string } {
    return { amount: this.toDb(), currency: this.currency };
  }
}

/* ------------------------------------------------------------------ */
/* Yardımcılar                                                         */
/* ------------------------------------------------------------------ */

export function toDecimal(value: Decimal | string | number): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Geçersiz sayı: ${value}`);
    }
    // number → string → Decimal: float gösterim gürültüsünü taşımamak için
    return new Decimal(value.toString());
  }
  const trimmed = value.trim();
  if (trimmed === "") throw new Error("Boş string sayıya çevrilemez");
  const d = new Decimal(trimmed);
  if (!d.isFinite()) throw new Error(`Geçersiz sayı: ${value}`);
  return d;
}

/** Aynı para birimindeki Money listesini toplar. Boş liste için currency şart. */
export function sumMoney(items: Money[], currency?: CurrencyCode): Money {
  if (items.length === 0) {
    if (!currency) throw new Error("sumMoney: boş liste için para birimi zorunlu");
    return Money.zero(currency);
  }
  return items.reduce((acc, m) => acc.plus(m));
}

/* ------------------------------------------------------------------ */
/* Biçimlendirme (tr-TR)                                               */
/* ------------------------------------------------------------------ */

const formatterCache = new Map<string, Intl.NumberFormat>();

function getFormatter(key: string, factory: () => Intl.NumberFormat): Intl.NumberFormat {
  let f = formatterCache.get(key);
  if (!f) {
    f = factory();
    formatterCache.set(key, f);
  }
  return f;
}

export interface FormatOptions {
  /** Ondalık basamak sayısı. Varsayılan: para biriminin standardı. */
  decimals?: number;
  /** true ise 1.234.567 → "1,23 Mn" gibi kısaltır. */
  compact?: boolean;
  /** Pozitif değerlerin başına "+" koyar (değişim göstergeleri için). */
  signed?: boolean;
}

/**
 * Para biçimlendirme. Kripto gibi ISO olmayan kodlar Intl'i patlatabildiği
 * için sayı ayrı biçimlendirilip sembol/kod elle eklenir.
 */
export function formatMoney(money: Money, opts: FormatOptions = {}): string {
  const decimals = opts.decimals ?? displayDecimals(money.currency);
  const n = money.amount.toNumber();

  let body: string;
  if (opts.compact) {
    body = formatCompact(n, money.currency);
  } else {
    const key = `num-${decimals}`;
    body = getFormatter(key, () =>
      new Intl.NumberFormat("tr-TR", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }),
    ).format(n);
  }

  const symbol = currencySymbol(money.currency);
  const sign = opts.signed && money.isPositive() ? "+" : "";
  return `${sign}${body} ${symbol}`;
}

const COMPACT_UNITS: Array<{ limit: number; divisor: number; suffix: string }> = [
  { limit: 1e12, divisor: 1e12, suffix: " Tn" },
  { limit: 1e9, divisor: 1e9, suffix: " Mr" },
  { limit: 1e6, divisor: 1e6, suffix: " Mn" },
  { limit: 1e3, divisor: 1e3, suffix: " B" },
];

function formatCompact(n: number, currency: CurrencyCode): string {
  const abs = Math.abs(n);
  for (const u of COMPACT_UNITS) {
    if (abs >= u.limit) {
      const scaled = n / u.divisor;
      const dec = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
      return (
        getFormatter(`num-${dec}`, () =>
          new Intl.NumberFormat("tr-TR", {
            minimumFractionDigits: dec,
            maximumFractionDigits: dec,
          }),
        ).format(scaled) + u.suffix
      );
    }
  }
  const dec = displayDecimals(currency);
  return getFormatter(`num-${dec}`, () =>
    new Intl.NumberFormat("tr-TR", {
      minimumFractionDigits: dec,
      maximumFractionDigits: dec,
    }),
  ).format(n);
}

const SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  TRY: "₺",
  GBP: "£",
  JPY: "¥",
  CHF: "CHF",
  AED: "AED",
};

function currencySymbol(currency: CurrencyCode): string {
  return SYMBOLS[currency.toUpperCase()] ?? currency.toUpperCase();
}

/** Oranı yüzde olarak biçimler. 0.0734 → "%7,34" */
export function formatPercent(
  ratio: Decimal | string | number,
  opts: { decimals?: number; signed?: boolean } = {},
): string {
  const d = toDecimal(ratio).times(100);
  const decimals = opts.decimals ?? 2;
  const body = getFormatter(`num-${decimals}`, () =>
    new Intl.NumberFormat("tr-TR", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }),
  ).format(d.toNumber());
  const sign = opts.signed && d.greaterThan(0) ? "+" : "";
  return `${sign}%${body}`;
}

/** Birimsiz sayı biçimleme (oran, endeks, adet) — tr-TR ayraçlarıyla. */
export function formatNumber(
  value: Decimal | string | number,
  decimals = 2,
): string {
  return getFormatter(`num-${decimals}`, () =>
    new Intl.NumberFormat("tr-TR", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }),
  ).format(toDecimal(value).toNumber());
}

/** Miktar (adet/lot/koin) biçimleme — para değil, birimsiz. */
export function formatQuantity(
  value: Decimal | string | number,
  decimals = 8,
): string {
  const d = toDecimal(value);
  // Gereksiz sondaki sıfırları at: 1,50000000 → 1,5
  const trimmed = d.toDecimalPlaces(decimals).toFixed();
  const parts = trimmed.split(".");
  const intPart = getFormatter("num-0", () =>
    new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }),
  ).format(Number(parts[0]));
  return parts[1] ? `${intPart},${parts[1]}` : intPart;
}
