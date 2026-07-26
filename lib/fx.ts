import Decimal from "decimal.js";
import { Money, toDecimal, type CurrencyCode } from "./money";

/**
 * Kur çevirimi ve kur etkisi ayrıştırması.
 *
 * Kurlar her zaman "1 birim BASE kaç birim QUOTE eder" şeklinde tutulur.
 * Tablo USD bazlıdır: rates["TRY"] = 1 USD kaç TL.
 */

const BASE_CURRENCY: CurrencyCode = "USD";

/** symbol → 1 USD karşılığı. USD'nin kendisi her zaman 1. */
export type RateTable = Readonly<Record<string, string | number | Decimal>>;

export class FxConverter {
  private readonly rates: Map<string, Decimal>;
  readonly asOf: Date;

  constructor(rates: RateTable, asOf: Date = new Date()) {
    this.rates = new Map();
    this.rates.set(BASE_CURRENCY, new Decimal(1));
    for (const [code, value] of Object.entries(rates)) {
      const d = toDecimal(value);
      if (d.lessThanOrEqualTo(0)) {
        throw new Error(`Geçersiz kur: ${code} = ${d.toFixed()}`);
      }
      this.rates.set(code.toUpperCase(), d);
    }
    this.asOf = asOf;
  }

  has(currency: CurrencyCode): boolean {
    return this.rates.has(currency.toUpperCase());
  }

  /** 1 USD kaç `currency` eder. */
  private perUsd(currency: CurrencyCode): Decimal {
    const c = currency.toUpperCase();
    const r = this.rates.get(c);
    if (!r) {
      throw new Error(
        `Kur bulunamadı: ${c}. Bilinen kurlar: ${[...this.rates.keys()].join(", ")}`,
      );
    }
    return r;
  }

  /**
   * Çapraz kur: 1 birim `from` kaç birim `to` eder.
   * USD üzerinden köprülenir: from → USD → to
   */
  rate(from: CurrencyCode, to: CurrencyCode): Decimal {
    const f = from.toUpperCase();
    const t = to.toUpperCase();
    if (f === t) return new Decimal(1);
    return this.perUsd(t).dividedBy(this.perUsd(f));
  }

  /** Bir Money'i hedef para birimine çevirir. */
  convert(money: Money, to: CurrencyCode): Money {
    const t = to.toUpperCase();
    if (money.currency === t) return money;
    return money.times(this.rate(money.currency, t)).withCurrency(t);
  }

  /** Ana para birimine (USD) çevirir — en sık kullanılan yol. */
  toBase(money: Money): Money {
    return this.convert(money, BASE_CURRENCY);
  }

  /** Karışık para birimlerindeki tutarları hedef birimde toplar. */
  sumIn(items: Money[], currency: CurrencyCode = BASE_CURRENCY): Money {
    return items.reduce(
      (acc, m) => acc.plus(this.convert(m, currency)),
      Money.zero(currency),
    );
  }
}

/* ------------------------------------------------------------------ */
/* Kur etkisi ayrıştırması                                             */
/* ------------------------------------------------------------------ */

export interface ReturnAttribution {
  /** Varlığın kendi para biriminde fiyattan gelen getiri oranı. */
  priceReturn: Decimal;
  /** Sadece kur hareketinden gelen getiri oranı. */
  fxReturn: Decimal;
  /** Fiyat ve kurun birlikte hareketinden doğan çapraz terim. */
  crossTerm: Decimal;
  /** Ana para biriminde toplam getiri oranı. */
  totalReturn: Decimal;
}

/**
 * "Ev TL'de değerlendi ama USD'de kaybettirdi" sorusunun cevabı.
 *
 * Bir varlığın ana para birimindeki toplam getirisi üç bileşene ayrılır:
 *
 *   1 + toplam = (1 + fiyatGetirisi) · (1 + kurGetirisi)
 *              = 1 + fiyatGetirisi + kurGetirisi + fiyatGetirisi·kurGetirisi
 *
 * Son terim "çapraz terim"dir; küçük hareketlerde ihmal edilebilir ama
 * Türkiye gibi yüksek kur oynaklığı olan yerlerde ihmal edilemez büyüklüğe
 * ulaşır, o yüzden ayrı gösterilir.
 *
 * @param costLocal    Alış maliyeti, varlığın yerel para biriminde
 * @param valueLocal   Güncel değer, varlığın yerel para biriminde
 * @param fxAtCost     Alış anında: 1 yerel birim kaç ana birim ederdi
 * @param fxNow        Şu an:       1 yerel birim kaç ana birim eder
 */
export function attributeReturn(
  costLocal: Money,
  valueLocal: Money,
  fxAtCost: Decimal | string | number,
  fxNow: Decimal | string | number,
): ReturnAttribution {
  if (costLocal.currency !== valueLocal.currency) {
    throw new Error(
      `attributeReturn: maliyet ve değer aynı para biriminde olmalı ` +
        `(${costLocal.currency} vs ${valueLocal.currency})`,
    );
  }
  if (costLocal.isZero()) {
    throw new Error("attributeReturn: sıfır maliyet üzerinden getiri hesaplanamaz");
  }

  const f0 = toDecimal(fxAtCost);
  const f1 = toDecimal(fxNow);
  if (f0.lessThanOrEqualTo(0) || f1.lessThanOrEqualTo(0)) {
    throw new Error("attributeReturn: kur pozitif olmalı");
  }

  // r_p = V/C - 1   (yerel fiyat getirisi)
  const priceReturn = valueLocal.ratioTo(costLocal).minus(1);
  // r_fx = f1/f0 - 1 (kur getirisi)
  const fxReturn = f1.dividedBy(f0).minus(1);
  // çapraz terim
  const crossTerm = priceReturn.times(fxReturn);
  // toplam = (1+r_p)(1+r_fx) - 1
  const totalReturn = priceReturn
    .plus(1)
    .times(fxReturn.plus(1))
    .minus(1);

  return { priceReturn, fxReturn, crossTerm, totalReturn };
}

/* ------------------------------------------------------------------ */
/* Reel getiri                                                         */
/* ------------------------------------------------------------------ */

/**
 * Fisher denklemi: nominal getiriden enflasyonu arındırır.
 *
 *   1 + reel = (1 + nominal) / (1 + enflasyon)
 *
 * Basit çıkarma (nominal − enflasyon) TR gibi yüksek enflasyonlu
 * ortamlarda ciddi şekilde yanıltır, o yüzden kullanılmıyor.
 * Örnek: %45 nominal, %38 enflasyon → basit çıkarma %7 der,
 * doğrusu %5,07'dir.
 */
export function realReturn(
  nominalReturn: Decimal | string | number,
  inflationRate: Decimal | string | number,
): Decimal {
  const n = toDecimal(nominalReturn);
  const i = toDecimal(inflationRate);
  const denom = i.plus(1);
  if (denom.lessThanOrEqualTo(0)) {
    throw new Error("realReturn: enflasyon -%100 veya altında olamaz");
  }
  return n.plus(1).dividedBy(denom).minus(1);
}
