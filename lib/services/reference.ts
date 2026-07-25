import { randomUUID } from "node:crypto";
import { db } from "@/db/client";
import { withholdingRates } from "@/db/schema";

/**
 * Referans verisi — demo verisi DEĞİL.
 *
 * Stopaj oranları olmadan mevduat hesabı brüt getiriyi net gibi
 * gösterir ve serveti olduğundan büyük tahmin eder. Bu yüzden boş bir
 * kurulumda bile varsayılan oranlar yüklenir.
 *
 * Oranlar temsilîdir ve mevzuat değiştikçe ayarlar sayfasından
 * güncellenebilir; koda gömülü değildir.
 */

const DEFAULT_WITHHOLDING = [
  { currency: "TRY", maxTermDays: 180, rate: "0.15", note: "6 aya kadar TL vadeli" },
  { currency: "TRY", maxTermDays: 365, rate: "0.12", note: "1 yıla kadar TL vadeli" },
  { currency: "TRY", maxTermDays: null, rate: "0.10", note: "1 yıl üzeri TL vadeli" },
  { currency: "USD", maxTermDays: null, rate: "0.25", note: "Döviz mevduat" },
  { currency: "EUR", maxTermDays: null, rate: "0.25", note: "Döviz mevduat" },
  { currency: "GBP", maxTermDays: null, rate: "0.25", note: "Döviz mevduat" },
] as const;

/** Stopaj tablosu boşsa varsayılanları yükler. Var olanı ezmez. */
export function ensureReferenceData(): void {
  const existing = db.select().from(withholdingRates).all();
  if (existing.length > 0) return;

  db.insert(withholdingRates)
    .values(
      DEFAULT_WITHHOLDING.map((r) => ({
        id: randomUUID(),
        currency: r.currency,
        maxTermDays: r.maxTermDays,
        rate: r.rate,
        effectiveFrom: "2025-01-01",
        note: r.note,
      })),
    )
    .run();
}
