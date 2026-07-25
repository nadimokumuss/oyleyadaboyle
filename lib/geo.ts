/**
 * Konum → konut fiyat endeksi eşlemesi.
 *
 * Saf fonksiyon; hem arama ucu hem formlar hem testler kullanır.
 * Eşleşme yoksa null döner — uygun olmayan bir endeksi zorla atamak,
 * mülkü yanlış bir bölgenin trendiyle değerlemek olurdu.
 */

/** Kalıplar normalize edilmiş (ASCII, küçük harf) metinle eşleşir. */
const INDEX_BY_CITY: Array<{ match: RegExp; country: string; key: string }> = [
  { match: /istanbul/, country: "TR", key: "TR-IST-HPI" },
  { match: /ankara/, country: "TR", key: "TR-ANK-HPI" },
  { match: /lisboa|lisbon|lizbon/, country: "PT", key: "PT-LIS-HPI" },
  { match: /dubai/, country: "AE", key: "AE-DXB-HPI" },
  { match: /berlin/, country: "DE", key: "DE-BER-HPI" },
  { match: /london|londra/, country: "GB", key: "GB-LON-HPI" },
];

/** Şehir eşleşmezse ülke geneli endeksi. */
const INDEX_BY_COUNTRY: Record<string, string> = {
  US: "US-NATIONAL-HPI",
};

/**
 * Türkçe karakterleri ASCII karşılıklarına indirger.
 *
 * Gerekli çünkü JavaScript'in büyük/küçük harf duyarsız eşleştirmesi
 * "İ" ile "i" harfini eşleştiremez (İ küçültüldüğünde noktalı bir
 * birleşik karaktere dönüşür). Bu yüzden "İstanbul" düz bir
 * /istanbul/i kalıbıyla eşleşmez.
 */
export function normalizeText(value: string): string {
  return value
    .replace(/İ/g, "I")
    .replace(/ı/g, "i")
    .normalize("NFD")
    // Birleşik aksan işaretlerini at
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ğ/g, "g")
    .replace(/ş/g, "s")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u");
}

export function resolveIndexKey(city: string, countryCode: string): string | null {
  const cc = countryCode.toUpperCase();
  const normalized = normalizeText(city);
  const hit = INDEX_BY_CITY.find(
    (x) => x.country === cc && x.match.test(normalized),
  );
  if (hit) return hit.key;
  return INDEX_BY_COUNTRY[cc] ?? null;
}

export const COUNTRY_NAMES: Record<string, string> = {
  TR: "Türkiye",
  US: "ABD",
  PT: "Portekiz",
  AE: "BAE",
  DE: "Almanya",
  GB: "Birleşik Krallık",
  FR: "Fransa",
  ES: "İspanya",
  IT: "İtalya",
  NL: "Hollanda",
  CH: "İsviçre",
  GR: "Yunanistan",
};

export function countryName(code: string | null | undefined): string {
  if (!code) return "bilinmiyor";
  return COUNTRY_NAMES[code.toUpperCase()] ?? code.toUpperCase();
}
