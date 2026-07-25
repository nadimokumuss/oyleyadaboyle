import { scryptSync, randomBytes, timingSafeEqual, createHmac } from "node:crypto";
import { db } from "@/db/client";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureReferenceData } from "./services/reference";

/**
 * Tek kullanıcılı PIN kilidi.
 *
 * Panel kendi makinenizde çalıştığı için karmaşık bir kimlik sistemine
 * gerek yok; amaç bilgisayarınıza erişen birinin tüm servetinizi
 * görmesini engellemek.
 *
 * PIN asla düz metin saklanmaz: scrypt ile türetilir, sadece sonuç ve
 * tuz tutulur. Karşılaştırma `timingSafeEqual` ile yapılır — normal
 * string karşılaştırması, doğru karakterlerde daha uzun sürdüğü için
 * PIN'i karakter karakter tahmin etmeye izin verirdi.
 */

const KEY_LEN = 64;
// scrypt maliyet parametresi. Yüksek olması kaba kuvveti yavaşlatır;
// 2^15 tek bir doğrulamada ~100ms sürer, kullanıcı fark etmez ama
// saniyede milyonlarca deneme yapmayı imkânsız kılar.
const SCRYPT_OPTS = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const SESSION_COOKIE = "servet_oturum";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 saat

export interface AuthState {
  /** Kurulum yapıldı mı? */
  setupCompleted: boolean;
  /** PIN belirlenmiş mi? */
  hasPin: boolean;
}

function readSettingsRow() {
  return db.select().from(settings).where(eq(settings.id, "singleton")).get();
}

/** Ayar satırı yoksa oluşturur — ilk açılışta gerekli. */
export function ensureSettingsRow() {
  const existing = readSettingsRow();
  if (existing) return existing;

  db.insert(settings)
    .values({ id: "singleton", sessionSecret: randomBytes(32).toString("hex") })
    .onConflictDoNothing()
    .run();

  ensureReferenceData();
  return readSettingsRow()!;
}

export function getAuthState(): AuthState {
  const row = ensureSettingsRow();
  return {
    setupCompleted: row.setupCompleted,
    hasPin: Boolean(row.pinHash && row.pinSalt),
  };
}

/* ------------------------------------------------------------------ */
/* PIN                                                                 */
/* ------------------------------------------------------------------ */

function derive(pin: string, salt: string): Buffer {
  return scryptSync(pin.normalize("NFKC"), salt, KEY_LEN, SCRYPT_OPTS);
}

export function setPin(pin: string): void {
  ensureSettingsRow();
  const salt = randomBytes(16).toString("hex");
  const hash = derive(pin, salt).toString("hex");

  db.update(settings)
    .set({ pinHash: hash, pinSalt: salt, updatedAt: new Date().toISOString() })
    .where(eq(settings.id, "singleton"))
    .run();
}

export function verifyPin(pin: string): boolean {
  const row = readSettingsRow();
  if (!row?.pinHash || !row.pinSalt) return false;

  const expected = Buffer.from(row.pinHash, "hex");
  const actual = derive(pin, row.pinSalt);

  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/* ------------------------------------------------------------------ */
/* Oturum çerezi                                                       */
/* ------------------------------------------------------------------ */

function getSecret(): string {
  const row = ensureSettingsRow();
  if (row.sessionSecret) return row.sessionSecret;

  const secret = randomBytes(32).toString("hex");
  db.update(settings)
    .set({ sessionSecret: secret })
    .where(eq(settings.id, "singleton"))
    .run();
  return secret;
}

/**
 * Çerez içeriği: `sonKullanma.imza`
 *
 * İmza HMAC-SHA256 ile üretilir; sunucu gizli anahtarı bilmeyen biri
 * geçerli bir çerez uyduramaz. İçerikte kişisel veri taşınmaz.
 */
export function createSessionToken(): string {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const signature = sign(String(expiresAt));
  return `${expiresAt}.${signature}`;
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;

  const [expiresRaw, signature] = token.split(".");
  if (!expiresRaw || !signature) return false;

  const expected = sign(expiresRaw);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  const expiresAt = Number(expiresRaw);
  return Number.isFinite(expiresAt) && Date.now() < expiresAt;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("hex");
}

export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_MS / 1000;

/* ------------------------------------------------------------------ */
/* Kaba kuvvet yavaşlatma                                              */
/* ------------------------------------------------------------------ */

let failedAttempts = 0;
let lockedUntil = 0;

export function registerFailedAttempt(): void {
  failedAttempts++;
  if (failedAttempts >= 5) {
    // 5. denemeden sonra katlanarak artan bekleme, tavan 5 dakika
    const waitMs = Math.min(2 ** (failedAttempts - 4) * 1000, 5 * 60_000);
    lockedUntil = Date.now() + waitMs;
  }
}

export function clearFailedAttempts(): void {
  failedAttempts = 0;
  lockedUntil = 0;
}

/** Kilitliyse kalan saniye, değilse 0. */
export function lockRemainingSeconds(): number {
  if (Date.now() >= lockedUntil) return 0;
  return Math.ceil((lockedUntil - Date.now()) / 1000);
}
