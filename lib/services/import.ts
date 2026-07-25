import Decimal from "decimal.js";
import { validate, cashSchema, positionSchema } from "@/lib/schemas";
import { saveCash, savePosition } from "./assets";

/**
 * CSV içe aktarım — dışa aktarımın aynası.
 *
 * Beklenen biçim `/api/export?type=positions` çıktısıyla aynı:
 * noktalı virgül ayraçlı, BOM'lu, Türkçe başlıklı.
 *
 * Tasarım kararı: hatalı satırlar tüm içe aktarımı iptal etmez.
 * 200 satırlık bir dosyada tek bir yazım hatası yüzünden hiçbir şeyin
 * yüklenmemesi işkence olurdu. Geçen satırlar yüklenir, geçmeyenler
 * satır numarası ve sebebiyle raporlanır.
 */

export interface ImportResult {
  imported: number;
  skipped: Array<{ line: number; reason: string; raw: string }>;
  total: number;
}

const KIND_MAP: Record<string, string> = {
  hisse: "equity",
  kripto: "crypto",
  emtia: "commodity",
  nakit: "cash",
};

export async function importPositionsCsv(content: string): Promise<ImportResult> {
  // BOM'u at
  const text = content.replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");

  if (lines.length < 2) {
    return { imported: 0, skipped: [], total: 0 };
  }

  const sep = detectSeparator(lines[0]);
  const headers = splitLine(lines[0], sep).map((h) => h.trim().toLowerCase());

  const col = (name: string) => headers.findIndex((h) => h.startsWith(name));
  const idx = {
    name: col("varlık"),
    kind: col("tür"),
    symbol: col("sembol"),
    country: col("ülke"),
    currency: col("para"),
    valueLocal: col("değer (yerel"),
    cost: col("maliyet"),
  };

  if (idx.name < 0 || idx.currency < 0) {
    return {
      imported: 0,
      total: lines.length - 1,
      skipped: [
        {
          line: 1,
          reason:
            "Başlık satırı tanınmadı. Dosyanın panelden dışa aktarılmış bir CSV olduğundan emin olun.",
          raw: lines[0],
        },
      ],
    };
  }

  const skipped: ImportResult["skipped"] = [];
  let imported = 0;

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    const cells = splitLine(raw, sep);
    const get = (n: number) => (n >= 0 ? (cells[n] ?? "").trim() : "");

    const name = get(idx.name);
    if (!name || name.toUpperCase() === "TOPLAM") continue;

    const kindLabel = get(idx.kind).toLowerCase();
    const kind = KIND_MAP[kindLabel];

    // Yalnızca nakit ve piyasa pozisyonları içe aktarılabilir; mevduat,
    // gayrimenkul ve girişim için CSV'de yeterli alan yok (faiz oranı,
    // konum, sahiplik oranı gibi). Bunlar atlanır ve sebebi söylenir.
    if (!kind) {
      skipped.push({
        line: i + 1,
        reason: `"${get(idx.kind) || "?"}" türü CSV'den içe aktarılamıyor — bu varlığı formdan ekleyin.`,
        raw,
      });
      continue;
    }

    const currency = get(idx.currency);
    const value = normalizeNumber(get(idx.valueLocal));

    try {
      if (kind === "cash") {
        const result = validate(
          cashSchema,
          toFormData({
            name,
            currency,
            amount: value,
            country: get(idx.country),
          }),
        );
        if (!result.success) {
          skipped.push({
            line: i + 1,
            reason: firstError(result.fieldErrors),
            raw,
          });
          continue;
        }
        saveCash(result.data!);
        imported++;
      } else {
        const symbol = get(idx.symbol);
        if (!symbol) {
          skipped.push({ line: i + 1, reason: "Sembol boş", raw });
          continue;
        }

        // CSV'de miktar yok, sadece değer ve maliyet var. Miktarı 1
        // kabul edip birim fiyatı maliyet olarak alıyoruz — pozisyonun
        // toplam maliyeti korunur, adet bilgisi kaybolur. Kullanıcı
        // sonradan düzeltebilir.
        const cost = normalizeNumber(get(idx.cost)) || value;
        const result = validate(
          positionSchema,
          toFormData({
            kind,
            symbol,
            name,
            currency,
            country: get(idx.country),
            quantity: "1",
            pricePerUnit: cost,
            purchaseDate: new Date().toISOString().slice(0, 10),
            status: "active",
          }),
        );
        if (!result.success) {
          skipped.push({
            line: i + 1,
            reason: firstError(result.fieldErrors),
            raw,
          });
          continue;
        }
        await savePosition(result.data!);
        imported++;
      }
    } catch (err) {
      skipped.push({ line: i + 1, reason: (err as Error).message, raw });
    }
  }

  return { imported, skipped, total: lines.length - 1 };
}

/* ------------------------------------------------------------------ */

function detectSeparator(header: string): string {
  const semis = (header.match(/;/g) ?? []).length;
  const commas = (header.match(/,/g) ?? []).length;
  return semis >= commas ? ";" : ",";
}

/** Tırnak içindeki ayraçları koruyarak satırı böler. */
function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === sep && !inQuotes) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

/**
 * Türkçe veya İngilizce biçimli sayıyı ondalık string'e çevirir.
 * "1.234,56" ve "1234.56" ikisi de kabul edilir.
 */
export function normalizeNumber(value: string): string {
  const v = value.trim();
  if (!v) return "";

  // Hem nokta hem virgül varsa: son gelen ondalık ayracıdır
  const lastDot = v.lastIndexOf(".");
  const lastComma = v.lastIndexOf(",");

  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    normalized =
      lastComma > lastDot
        ? v.replace(/\./g, "").replace(",", ".")
        : v.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // Sadece virgül: binlik mi ondalık mı? Virgülden sonra 3 hane ve
    // başka virgül yoksa binlik ayracı olma ihtimali yüksek ama
    // Türkçe bağlamda ondalık kabul etmek daha güvenli.
    normalized = v.replace(",", ".");
  } else {
    normalized = v;
  }

  try {
    const d = new Decimal(normalized);
    return d.isFinite() ? d.toFixed() : "";
  } catch {
    return "";
  }
}

function toFormData(obj: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(obj)) fd.append(k, v);
  return fd;
}

function firstError(errors?: Record<string, string>): string {
  if (!errors) return "Doğrulama hatası";
  const [field, message] = Object.entries(errors)[0] ?? [];
  return field ? `${field}: ${message}` : "Doğrulama hatası";
}
