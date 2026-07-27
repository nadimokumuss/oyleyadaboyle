import Decimal from "decimal.js";

/**
 * Portföyü bir endeksle karşılaştırma.
 *
 * `metrics.ts` TWR, Sharpe ve maksimum düşüş üretiyordu ama karşılaştırma
 * noktası yoktu: %18 getiri iyi mi kötü mü, endeks %30 yaptıysa kötüdür.
 *
 * ## Neden "aynı parayı endekse koysaydınız" sorusu
 *
 * İki eğriyi üst üste çizmek yetmez; servet eğrisi para giriş-çıkışıyla
 * hareket eder, endeks etmez. Yeni para yatırdığınızda eğriniz yükselir ve
 * endeksi yenmiş gibi görünürsünüz. Bu yüzden karşılaştırma **aynı
 * başlangıç tutarının** endekste ne olacağı üzerinden yapılır — para
 * akışını değil, getiriyi kıyaslar.
 *
 * Bu da kusursuz değil: ara dönem katkılarını yok sayar. Panelde bu
 * açıkça söylenmeli.
 */

export interface SeriesPoint {
  date: string;
  value: number;
}

export interface BenchmarkComparison {
  /** Ortak tarihlerde normalize edilmiş portföy serisi (başlangıç = 100). */
  portfolio: SeriesPoint[];
  /** Aynı tarihlerde normalize edilmiş endeks serisi. */
  benchmark: SeriesPoint[];
  /** Dönem sonu portföy getirisi (0.18 = %18). */
  portfolioReturn: Decimal;
  benchmarkReturn: Decimal;
  /** Fark — pozitifse endeksi yendiniz. */
  excessReturn: Decimal;
  /** Başlangıçtaki servet endekse konsaydı bugünkü değeri. */
  counterfactualValue: Decimal;
  /** Gerçek bugünkü değer. */
  actualValue: Decimal;
  /** Karşılaştırmanın kapsadığı gün sayısı. */
  days: number;
}

/**
 * İki seriyi ortak tarihlerde hizalar.
 *
 * Endeks yalnızca işlem günlerinde değer üretir, servet eğrisi ise
 * hafta sonu da kayıt tutabilir. Kesişim alınmazsa grafikte tarihler
 * kayar ve karşılaştırma anlamsızlaşır.
 */
export function alignSeries(
  a: SeriesPoint[],
  b: SeriesPoint[],
): { a: SeriesPoint[]; b: SeriesPoint[] } {
  const bByDate = new Map(b.map((p) => [p.date, p.value]));
  const outA: SeriesPoint[] = [];
  const outB: SeriesPoint[] = [];

  for (const point of a) {
    const match = bByDate.get(point.date);
    if (match === undefined) continue;
    outA.push(point);
    outB.push({ date: point.date, value: match });
  }

  return { a: outA, b: outB };
}

/** Seriyi başlangıcı 100 olacak şekilde ölçekler. */
export function normalize(series: SeriesPoint[]): SeriesPoint[] {
  if (series.length === 0) return [];
  const base = series[0].value;
  if (base === 0) return series.map((p) => ({ ...p, value: 0 }));
  return series.map((p) => ({ date: p.date, value: (p.value / base) * 100 }));
}

/**
 * Karşılaştırmayı hesaplar.
 *
 * Ortak tarih iki günden azsa `null` döner — tek noktadan getiri
 * hesaplanamaz ve uydurma bir sonuç üretmektense hiçbir şey göstermemek
 * doğrusudur.
 */
export function compareToBenchmark(
  portfolio: SeriesPoint[],
  benchmark: SeriesPoint[],
): BenchmarkComparison | null {
  const aligned = alignSeries(portfolio, benchmark);
  if (aligned.a.length < 2) return null;

  const pFirst = aligned.a[0].value;
  const pLast = aligned.a[aligned.a.length - 1].value;
  const bFirst = aligned.b[0].value;
  const bLast = aligned.b[aligned.b.length - 1].value;

  if (pFirst === 0 || bFirst === 0) return null;

  const portfolioReturn = new Decimal(pLast).minus(pFirst).dividedBy(pFirst);
  const benchmarkReturn = new Decimal(bLast).minus(bFirst).dividedBy(bFirst);

  const days = Math.round(
    (new Date(aligned.a[aligned.a.length - 1].date).getTime() -
      new Date(aligned.a[0].date).getTime()) /
      86_400_000,
  );

  return {
    portfolio: normalize(aligned.a),
    benchmark: normalize(aligned.b),
    portfolioReturn,
    benchmarkReturn,
    excessReturn: portfolioReturn.minus(benchmarkReturn),
    counterfactualValue: new Decimal(pFirst).times(
      new Decimal(1).plus(benchmarkReturn),
    ),
    actualValue: new Decimal(pLast),
    days,
  };
}
