import { randomUUID } from "node:crypto";
import { db } from "@/db/client";
import { loginAttempts, settings } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * Güvenlik politikası.
 *
 * Panel internete açıldığında yerel kullanımdakinden farklı bir tehdit
 * modeline girer: artık sizin bilgisayarınıza fiziksel erişimi olan
 * biri değil, adresi bulan herkes deneyebilir. Bu dosya o farkı
 * kapatan kuralları toplar.
 *
 * `SERVET_PUBLIC=1` ortam değişkeni kuralları sıkılaştırır.
 */

export const isPublicDeployment = process.env.SERVET_PUBLIC === "1";

/** Parola asgari uzunluğu — internete açıkken çok daha uzun. */
export const MIN_SECRET_LENGTH = isPublicDeployment ? 12 : 4;

export interface PasswordCheck {
  ok: boolean;
  errors: string[];
  /** 0-4 arası kaba güç göstergesi. */
  strength: number;
}

/**
 * Parola politikası.
 *
 * Karmaşıklık kuralları (büyük harf + rakam + sembol zorunlu) yerine
 * uzunluğa ağırlık veriyoruz: "Parola123!" kısa ve tahmin edilebilir,
 * "kirmizi kedi merdivende uyudu" uzun ve çok daha güçlü. NIST'in
 * güncel önerisi de bu yönde.
 */
export function checkPassword(value: string): PasswordCheck {
  const errors: string[] = [];

  if (value.length < MIN_SECRET_LENGTH) {
    errors.push(
      isPublicDeployment
        ? `Panel internete açık — parola en az ${MIN_SECRET_LENGTH} karakter olmalı. Uzun bir cümle kullanmak en kolayı.`
        : `Parola en az ${MIN_SECRET_LENGTH} karakter olmalı.`,
    );
  }
  if (value.length > 200) errors.push("Parola çok uzun.");

  const common = [
    "123456", "password", "parola", "111111", "qwerty",
    "123456789", "12345678", "1234", "sifre", "şifre",
  ];
  if (common.includes(value.toLowerCase())) {
    errors.push("Bu parola çok yaygın kullanılıyor — tahmin edilmesi kolay.");
  }

  // Tek karakterin tekrarı veya ardışık dizi
  if (/^(.)\1+$/.test(value)) {
    errors.push("Aynı karakterin tekrarı güvenli değil.");
  }
  if (/^(0123456789|1234567890|abcdefgh)/.test(value.toLowerCase())) {
    errors.push("Ardışık karakter dizisi güvenli değil.");
  }

  let strength = 0;
  if (value.length >= 8) strength++;
  if (value.length >= 12) strength++;
  if (value.length >= 16) strength++;
  if (/[^a-zA-Z0-9]/.test(value) || /\s/.test(value)) strength++;

  return { ok: errors.length === 0, errors, strength };
}

/* ------------------------------------------------------------------ */
/* Kalıcı giriş denemesi kaydı                                         */
/* ------------------------------------------------------------------ */

/**
 * Denemeleri veritabanına yazıyoruz.
 *
 * Bellekte tutmak yeterli değil: sunucu yeniden başladığında sayaç
 * sıfırlanır ve saldırgan bunu tetikleyip kilidi atlayabilir.
 */
export function recordAttempt(opts: {
  ip: string | null;
  userAgent: string | null;
  success: boolean;
  reason?: string;
}): void {
  db.insert(loginAttempts)
    .values({
      id: randomUUID(),
      ip: opts.ip,
      userAgent: opts.userAgent?.slice(0, 200) ?? null,
      success: opts.success,
      reason: opts.reason ?? null,
      at: new Date().toISOString(),
    })
    .run();

  // Kayıtları sınırla — güvenlik günlüğü sonsuza kadar büyümesin
  db.run(
    sql`DELETE FROM login_attempts WHERE id NOT IN (
          SELECT id FROM login_attempts ORDER BY at DESC LIMIT 500
        )`,
  );
}

export interface LockState {
  locked: boolean;
  remainingSeconds: number;
  recentFailures: number;
}

/**
 * Son 15 dakikadaki başarısız denemelere göre kilit durumu.
 *
 * Kademeli: 5 denemeden sonra kilitlenir ve her denemede süre katlanır.
 * Tavan 15 dakika — kalıcı kilit, meşru kullanıcıyı da dışarıda
 * bırakacağı için tercih edilmedi.
 */
export function checkLock(ip: string | null): LockState {
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();

  const recent = db
    .select()
    .from(loginAttempts)
    .all()
    .filter((a) => a.at >= cutoff && !a.success)
    // IP bilinmiyorsa tüm başarısızlıkları say (yerel kullanım)
    .filter((a) => !ip || !a.ip || a.ip === ip);

  const failures = recent.length;
  if (failures < 5) {
    return { locked: false, remainingSeconds: 0, recentFailures: failures };
  }

  const lastAttempt = recent
    .map((a) => new Date(a.at).getTime())
    .sort((a, b) => b - a)[0];

  const waitMs = Math.min(2 ** (failures - 4) * 1000, 15 * 60_000);
  const remaining = Math.ceil((lastAttempt + waitMs - Date.now()) / 1000);

  return {
    locked: remaining > 0,
    remainingSeconds: Math.max(0, remaining),
    recentFailures: failures,
  };
}

/** Başarılı girişten sonra sayacı sıfırlar. */
export function clearAttempts(): void {
  db.delete(loginAttempts).run();
}

/** Güvenlik günlüğü — ayarlar sayfasında gösterilir. */
export function recentAttempts(limit = 20) {
  return db
    .select()
    .from(loginAttempts)
    .all()
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* IP kısıtlama                                                        */
/* ------------------------------------------------------------------ */

/**
 * İzin verilen IP listesi. Boşsa kısıtlama yok.
 *
 * CIDR desteklenir (192.168.1.0/24). Ev IP'niz sabitse bu, paneli
 * pratikte dünyanın geri kalanından tamamen gizler.
 */
export function isIpAllowed(ip: string | null): boolean {
  const row = db.select().from(settings).where(eq(settings.id, "singleton")).get();
  const raw = row?.allowedIps?.trim();
  if (!raw) return true;
  if (!ip) return false;

  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .some((rule) => matchesIp(ip, rule));
}

function matchesIp(ip: string, rule: string): boolean {
  if (!rule.includes("/")) return ip === rule;

  const [network, bitsRaw] = rule.split("/");
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;

  const toInt = (addr: string): number | null => {
    const parts = addr.split(".");
    if (parts.length !== 4) return null;
    let value = 0;
    for (const p of parts) {
      const n = Number(p);
      if (!Number.isInteger(n) || n < 0 || n > 255) return null;
      value = (value << 8) | n;
    }
    return value >>> 0;
  };

  const a = toInt(ip);
  const b = toInt(network);
  if (a === null || b === null) return false;

  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}

/** İstekten istemci IP'sini çıkarır (ters vekil başlıkları dahil). */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return (
    headers.get("x-real-ip") ??
    headers.get("cf-connecting-ip") ??
    headers.get("fly-client-ip") ??
    null
  );
}
