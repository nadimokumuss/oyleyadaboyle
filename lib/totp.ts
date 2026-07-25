import { createHmac, randomBytes, timingSafeEqual, scryptSync } from "node:crypto";

/**
 * TOTP (RFC 6238) — iki faktörlü doğrulama.
 *
 * Google Authenticator, 1Password, Authy gibi uygulamalarla uyumlu.
 * Bağımlılık eklemek yerine doğrudan yazıldı: algoritma küçük ve
 * standart, kripto işini Node'un kendi `crypto` modülü yapıyor.
 *
 * Neden gerekli: servetinizi internete açıyorsanız tek faktör (PIN)
 * yetmez. Parolayı ele geçiren biri, telefonunuzdaki koda da sahip
 * olmadan giremez.
 */

const DIGITS = 6;
const PERIOD_SECONDS = 30;
/** Saat kayması toleransı: ±1 pencere (±30 sn). */
const WINDOW = 1;

/* ------------------------------------------------------------------ */
/* Base32 (RFC 4648) — kimlik doğrulama uygulamaları bunu bekler       */
/* ------------------------------------------------------------------ */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const char of clean) {
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) throw new Error("Geçersiz base32 karakteri");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/* ------------------------------------------------------------------ */
/* TOTP                                                                */
/* ------------------------------------------------------------------ */

/** Yeni bir gizli anahtar üretir (160 bit — RFC önerisi). */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

/**
 * Belirli bir zaman penceresi için kod üretir.
 *
 * HMAC-SHA1 kullanılıyor çünkü kimlik doğrulama uygulamalarının
 * tamamı bunu destekliyor. SHA1 burada parola hash'i olarak değil,
 * HMAC içinde kullanılıyor — bu bağlamda güvenli kabul ediliyor.
 */
export function generateCode(secret: string, counter: number): string {
  const key = base32Decode(secret);

  // 8 baytlık big-endian sayaç
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac("sha1", key).update(buf).digest();

  // Dinamik kırpma (RFC 4226 §5.4)
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function currentCounter(now: Date = new Date()): number {
  return Math.floor(now.getTime() / 1000 / PERIOD_SECONDS);
}

/**
 * Kodu doğrular.
 *
 * ±1 pencere toleransı var: telefon saati birkaç saniye kaymış olsa
 * bile giriş yapılabilsin. Daha geniş tolerans, kodun geçerlilik
 * süresini gereksiz uzatır.
 */
export function verifyCode(
  secret: string,
  code: string,
  now: Date = new Date(),
): boolean {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return false;

  const counter = currentCounter(now);
  for (let offset = -WINDOW; offset <= WINDOW; offset++) {
    const expected = generateCode(secret, counter + offset);
    // Sabit süreli karşılaştırma — zamanlama saldırısına karşı
    const a = Buffer.from(expected);
    const b = Buffer.from(clean);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

/**
 * Kimlik doğrulama uygulamasına okutulacak URI.
 * QR kod bundan üretilir.
 */
export function otpauthUrl(secret: string, label = "Servet Terminali"): string {
  const params = new URLSearchParams({
    secret,
    issuer: "Servet Terminali",
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

/* ------------------------------------------------------------------ */
/* Kurtarma kodları                                                    */
/* ------------------------------------------------------------------ */

/**
 * Telefonunuzu kaybederseniz girebilmeniz için tek kullanımlık kodlar.
 *
 * Düz metin saklanmaz — PIN gibi hash'lenir. Kullanıcıya yalnızca bir
 * kez gösterilir; kaybederse yeniden üretmesi gerekir.
 */
export function generateRecoveryCodes(count = 8): {
  plain: string[];
  hashed: string[];
} {
  const plain: string[] = [];
  const hashed: string[] = [];

  for (let i = 0; i < count; i++) {
    // 4-4 gruplu, okunması kolay kod
    const raw = randomBytes(5).toString("hex").toUpperCase().slice(0, 8);
    const formatted = `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
    plain.push(formatted);
    hashed.push(hashRecoveryCode(formatted));
  }

  return { plain, hashed };
}

/** Kurtarma kodları da hash'lenir; tuz sabit çünkü kodun kendisi rastgele. */
export function hashRecoveryCode(code: string): string {
  return scryptSync(code.toUpperCase().replace(/\s/g, ""), "servet-recovery", 32, {
    N: 16_384,
    r: 8,
    p: 1,
  }).toString("hex");
}

/**
 * Kurtarma kodunu doğrular ve kullanılanı listeden çıkarır.
 * Tek kullanımlık olması esas — aynı kod ikinci kez çalışmamalı.
 */
export function consumeRecoveryCode(
  code: string,
  hashedCodes: string[],
): { valid: boolean; remaining: string[] } {
  const attempt = hashRecoveryCode(code);
  const idx = hashedCodes.findIndex((h) => {
    const a = Buffer.from(h, "hex");
    const b = Buffer.from(attempt, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  });

  if (idx === -1) return { valid: false, remaining: hashedCodes };

  const remaining = [...hashedCodes];
  remaining.splice(idx, 1);
  return { valid: true, remaining };
}
