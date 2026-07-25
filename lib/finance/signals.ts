import Decimal from "decimal.js";
import { toDecimal } from "@/lib/money";
import { volatility, maxDrawdown, toReturns } from "./metrics";

/**
 * Teknik göstergeler — fiyat geçmişinden yerel olarak hesaplanır.
 *
 * DÜRÜST SINIR: Bunlar TEKNİK göstergelerdir, temel analiz değildir.
 * Hisseler için F/K, temettü verimi gibi veriler ücretsiz-anahtarsız
 * erişilemediği için (Yahoo'nun quoteSummary ucu "Invalid Crumb"
 * veriyor) burada yalnızca fiyatın kendisinden çıkarılabilecek
 * bilgiler var.
 *
 * Bileşik skor tek bir sayıya indirgenmez; her bileşenin katkısı ayrı
 * gösterilir. "Al" diyen bir kara kutu, neden dediğini söylemeyen bir
 * kara kutudur.
 */

export type SignalDirection = "positive" | "neutral" | "negative";

export interface SignalComponent {
  key: string;
  label: string;
  /** İnsan okuyabilir değer. */
  value: string;
  direction: SignalDirection;
  /** Bu göstergenin ne anlama geldiği. */
  explanation: string;
  /** Bileşik skora katkısı (-1 … +1). */
  contribution: number;
}

export interface SignalReport {
  symbol: string;
  /** −1 (güçlü olumsuz) … +1 (güçlü olumlu). */
  score: number;
  /** Skorun sözel karşılığı. */
  label: string;
  components: SignalComponent[];
  /** Hesaplama için yeterli veri var mıydı? */
  sufficient: boolean;
  dataPoints: number;
}

/* ------------------------------------------------------------------ */
/* Göstergeler                                                         */
/* ------------------------------------------------------------------ */

/** Basit hareketli ortalama. */
export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/**
 * Göreli Güç Endeksi (RSI), Wilder yöntemi.
 *
 * 70 üzeri "aşırı alım", 30 altı "aşırı satım" kabul edilir. Bunlar
 * gelenek olan eşiklerdir, doğa kanunu değil — güçlü bir yükselişte
 * RSI aylarca 70'in üzerinde kalabilir.
 */
export function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Wilder yumuşatması
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** 52 haftalık aralıkta bulunulan konum (0 = dip, 1 = zirve). */
export function rangePosition(values: number[]): number | null {
  if (values.length < 2) return null;
  const high = Math.max(...values);
  const low = Math.min(...values);
  if (high === low) return 0.5;
  return (values[values.length - 1] - low) / (high - low);
}

/* ------------------------------------------------------------------ */
/* Rapor                                                               */
/* ------------------------------------------------------------------ */

const SCORE_LABELS: Array<{ min: number; label: string }> = [
  { min: 0.5, label: "Güçlü olumlu" },
  { min: 0.2, label: "Olumlu" },
  { min: -0.2, label: "Karışık" },
  { min: -0.5, label: "Olumsuz" },
  { min: -Infinity, label: "Güçlü olumsuz" },
];

export function analyzeSignals(
  symbol: string,
  closes: number[],
): SignalReport {
  const clean = closes.filter((v) => Number.isFinite(v) && v > 0);
  const components: SignalComponent[] = [];

  if (clean.length < 30) {
    return {
      symbol,
      score: 0,
      label: "Yetersiz veri",
      components: [],
      sufficient: false,
      dataPoints: clean.length,
    };
  }

  const last = clean[clean.length - 1];

  /* --- Trend: SMA50 / SMA200 --- */
  const sma50 = sma(clean, 50);
  const sma200 = sma(clean, 200);

  if (sma50 !== null && sma200 !== null) {
    const above = sma50 > sma200;
    const gap = (sma50 - sma200) / sma200;
    components.push({
      key: "trend",
      label: "Trend (50/200 günlük ortalama)",
      value: above
        ? `50g ortalama, 200g'nin %${(gap * 100).toFixed(1).replace(".", ",")} üzerinde`
        : `50g ortalama, 200g'nin %${(Math.abs(gap) * 100).toFixed(1).replace(".", ",")} altında`,
      direction: above ? "positive" : "negative",
      explanation: above
        ? "Kısa vadeli ortalama uzun vadelinin üzerinde — yükseliş trendi işareti."
        : "Kısa vadeli ortalama uzun vadelinin altında — düşüş trendi işareti.",
      // Fark büyüdükçe katkı artar ama ±0,4'te sınırlanır
      contribution: Math.max(-0.4, Math.min(0.4, gap * 4)),
    });
  } else if (sma50 !== null) {
    const above = last > sma50;
    components.push({
      key: "trend",
      label: "Trend (50 günlük ortalama)",
      value: above ? "Fiyat ortalamanın üzerinde" : "Fiyat ortalamanın altında",
      direction: above ? "positive" : "negative",
      explanation:
        "200 günlük ortalama için yeterli geçmiş yok; yalnızca kısa vadeli trend değerlendirildi.",
      contribution: above ? 0.15 : -0.15,
    });
  }

  /* --- Momentum: RSI --- */
  const rsiValue = rsi(clean, 14);
  if (rsiValue !== null) {
    let direction: SignalDirection = "neutral";
    let explanation =
      "RSI 30-70 arasında — ne aşırı alım ne aşırı satım bölgesinde.";
    let contribution = 0;

    if (rsiValue > 70) {
      direction = "negative";
      explanation =
        "RSI 70 üzerinde: son dönemde hızlı yükselmiş, kısa vadede geri çekilme riski. Güçlü trendlerde bu uzun süre böyle kalabilir.";
      contribution = -0.25;
    } else if (rsiValue < 30) {
      direction = "positive";
      explanation =
        "RSI 30 altında: son dönemde sert satılmış. Toparlanma ihtimali kadar düşüşün sürmesi ihtimali de var.";
      contribution = 0.25;
    }

    components.push({
      key: "rsi",
      label: "Momentum (RSI 14)",
      value: rsiValue.toFixed(0),
      direction,
      explanation,
      contribution,
    });
  }

  /* --- 52 hafta konumu --- */
  const pos = rangePosition(clean);
  if (pos !== null) {
    const pct = pos * 100;
    let direction: SignalDirection = "neutral";
    let contribution = 0;
    let explanation = "Yıllık aralığın ortalarında.";

    if (pos > 0.9) {
      direction = "positive";
      contribution = 0.15;
      explanation = "Yıllık zirveye çok yakın — güç işareti, ama alım pahalı.";
    } else if (pos < 0.15) {
      direction = "negative";
      contribution = -0.15;
      explanation =
        "Yıllık dibe yakın. Ucuz görünür ama düşüşün bir sebebi olabilir.";
    }

    components.push({
      key: "range",
      label: "52 hafta konumu",
      value: `%${pct.toFixed(0)}`,
      direction,
      explanation,
      contribution,
    });
  }

  /* --- Oynaklık --- */
  const returns = toReturns(clean);
  const vol = volatility(returns, 252);
  if (vol) {
    const annual = vol.toNumber();
    let direction: SignalDirection = "neutral";
    let contribution = 0;
    let explanation = "Oynaklık tipik hisse aralığında.";

    if (annual > 0.6) {
      direction = "negative";
      contribution = -0.2;
      explanation =
        "Çok yüksek oynaklık: pozisyon büyüklüğünü buna göre ayarlayın, aynı tutar burada çok daha fazla risk demek.";
    } else if (annual < 0.15) {
      direction = "positive";
      contribution = 0.1;
      explanation = "Düşük oynaklık — daha öngörülebilir seyir.";
    }

    components.push({
      key: "volatility",
      label: "Yıllık oynaklık",
      value: `%${(annual * 100).toFixed(1).replace(".", ",")}`,
      direction,
      explanation,
      contribution,
    });
  }

  /* --- Zirveden düşüş --- */
  const dd = maxDrawdown(clean);
  if (dd) {
    const current = dd.currentDrawdown.toNumber();
    components.push({
      key: "drawdown",
      label: "Zirveden uzaklık",
      value: `%${(current * 100).toFixed(1).replace(".", ",")}`,
      direction: current < -0.3 ? "negative" : "neutral",
      explanation:
        current < -0.3
          ? "Zirveden %30'dan fazla düşmüş. Toparlanma için ciddi bir yükseliş gerekir."
          : "Zirveye makul mesafede.",
      contribution: current < -0.3 ? -0.15 : 0,
    });
  }

  const score = Math.max(
    -1,
    Math.min(1, components.reduce((a, c) => a + c.contribution, 0)),
  );

  return {
    symbol,
    score,
    label: SCORE_LABELS.find((s) => score >= s.min)!.label,
    components,
    sufficient: true,
    dataPoints: clean.length,
  };
}

/** Kripto için ek bağlam (CoinGecko'dan gelen zengin veriyle). */
export interface CryptoContext {
  marketCapRank: number | null;
  athChangePct: number | null;
  change7d: number | null;
  change30d: number | null;
  change1y: number | null;
}

export function summarizeCrypto(ctx: CryptoContext): SignalComponent[] {
  const out: SignalComponent[] = [];

  if (ctx.marketCapRank !== null) {
    const top = ctx.marketCapRank <= 20;
    out.push({
      key: "rank",
      label: "Piyasa değeri sırası",
      value: `#${ctx.marketCapRank}`,
      direction: top ? "positive" : "neutral",
      explanation: top
        ? "İlk 20 içinde — görece daha likit ve kurumsal ilgisi olan bir varlık."
        : "İlk 20 dışında: likidite ve oynaklık riski daha yüksek.",
      contribution: top ? 0.1 : -0.05,
    });
  }

  if (ctx.athChangePct !== null) {
    const fromAth = ctx.athChangePct;
    out.push({
      key: "ath",
      label: "Tüm zamanların zirvesinden",
      value: `%${fromAth.toFixed(1).replace(".", ",")}`,
      direction: fromAth < -70 ? "negative" : "neutral",
      explanation:
        fromAth < -70
          ? "Zirvenin %70'inden fazla altında — eski seviyeye dönmek için katlanması gerekir."
          : "Zirveye makul mesafede.",
      contribution: fromAth < -70 ? -0.1 : 0,
    });
  }

  return out;
}

/** Skoru 0-100 aralığına çevirir (görsel gösterge için). */
export function scoreToPercent(score: number): number {
  return Math.round(((toDecimal(score).toNumber() + 1) / 2) * 100);
}

export function scoreDirection(score: number): SignalDirection {
  if (score > 0.2) return "positive";
  if (score < -0.2) return "negative";
  return "neutral";
}

/** Decimal döndüren yardımcı — arayüz biçimlendirmesi için. */
export function scoreAsDecimal(score: number): Decimal {
  return new Decimal(score);
}
