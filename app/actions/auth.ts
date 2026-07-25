"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { settings } from "@/db/schema";
import {
  setPin, verifyPin, createSessionToken, ensureSettingsRow, getAuthState,
  verifySecondFactor, enableTotp, disableTotp,
  SESSION_COOKIE, SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth";
import {
  checkPassword, recordAttempt, checkLock, clearAttempts,
  isIpAllowed, clientIp, isPublicDeployment,
} from "@/lib/security";
import { generateSecret, verifyCode, generateRecoveryCodes, otpauthUrl } from "@/lib/totp";
import { toDecimal } from "@/lib/money";

export interface ActionState {
  error?: string;
  fieldErrors?: Record<string, string>;
  /** İkinci faktör isteniyor. */
  needsSecondFactor?: boolean;
}

async function requestContext(): Promise<{ ip: string | null; ua: string | null }> {
  const h = await headers();
  return { ip: clientIp(h), ua: h.get("user-agent") };
}

async function startSession(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    // İnternete açık kurulumda çerez yalnızca HTTPS üzerinden gider
    secure: isPublicDeployment,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/* ------------------------------------------------------------------ */
/* Kurulum                                                             */
/* ------------------------------------------------------------------ */

export async function completeSetup(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (getAuthState().setupCompleted) {
    return { error: "Kurulum zaten tamamlanmış." };
  }

  const pin = String(formData.get("pin") ?? "");
  const pinConfirm = String(formData.get("pinConfirm") ?? "");
  const baseCurrency = String(formData.get("baseCurrency") ?? "USD").toUpperCase();
  const livingCostRaw = String(formData.get("monthlyLivingCost") ?? "").trim();
  const horizonRaw = String(formData.get("horizonYears") ?? "20");
  const riskProfile = String(formData.get("riskProfile") ?? "balanced");

  const fieldErrors: Record<string, string> = {};

  const strength = checkPassword(pin);
  if (!strength.ok) fieldErrors.pin = strength.errors[0];
  if (pin !== pinConfirm) fieldErrors.pinConfirm = "Parolalar eşleşmiyor";

  let livingCost = "0";
  if (livingCostRaw) {
    try {
      const d = toDecimal(livingCostRaw.replace(/\./g, "").replace(",", "."));
      if (d.isNegative()) throw new Error();
      livingCost = d.toFixed();
    } catch {
      fieldErrors.monthlyLivingCost = "Geçerli bir tutar girin";
    }
  }

  const horizon = Number(horizonRaw);
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 60) {
    fieldErrors.horizonYears = "1 ile 60 yıl arasında olmalı";
  }
  if (!["conservative", "balanced", "aggressive"].includes(riskProfile)) {
    fieldErrors.riskProfile = "Geçersiz risk profili";
  }

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  ensureSettingsRow();
  setPin(pin);

  db.update(settings)
    .set({
      baseCurrency,
      monthlyLivingCost: livingCost,
      livingCostCurrency: baseCurrency,
      horizonYears: horizon,
      riskProfile: riskProfile as "conservative" | "balanced" | "aggressive",
      setupCompleted: true,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(settings.id, "singleton"))
    .run();

  clearAttempts();
  await startSession();
  redirect("/");
}

/* ------------------------------------------------------------------ */
/* Giriş                                                               */
/* ------------------------------------------------------------------ */

export async function login(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { ip, ua } = await requestContext();

  // IP kısıtlaması varsa önce o
  if (!isIpAllowed(ip)) {
    recordAttempt({ ip, userAgent: ua, success: false, reason: "IP izinli değil" });
    return { error: "Bu ağdan erişim izniniz yok." };
  }

  const lock = checkLock(ip);
  if (lock.locked) {
    return {
      error:
        `Çok fazla hatalı deneme (${lock.recentFailures}). ` +
        `${lock.remainingSeconds} saniye sonra tekrar deneyin.`,
    };
  }

  const pin = String(formData.get("pin") ?? "");
  const code = String(formData.get("code") ?? "").trim();
  if (!pin) return { fieldErrors: { pin: "Parola girin" } };

  if (!verifyPin(pin)) {
    recordAttempt({ ip, userAgent: ua, success: false, reason: "Hatalı parola" });
    const after = checkLock(ip);
    return {
      fieldErrors: {
        pin: after.locked
          ? `Hatalı parola. ${after.remainingSeconds} saniye bekleyin.`
          : "Hatalı parola",
      },
    };
  }

  // Parola doğru — ikinci faktör gerekiyor mu?
  const state = getAuthState();
  if (state.totpEnabled) {
    if (!code) {
      // Parolayı doğru bildiğini biliyoruz; kodu iste
      return { needsSecondFactor: true };
    }
    if (!verifySecondFactor(code)) {
      recordAttempt({ ip, userAgent: ua, success: false, reason: "Hatalı 2FA kodu" });
      return {
        needsSecondFactor: true,
        fieldErrors: { code: "Kod geçersiz veya süresi dolmuş" },
      };
    }
  }

  recordAttempt({ ip, userAgent: ua, success: true });
  clearAttempts();
  await startSession();
  redirect("/");
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/giris");
}

/* ------------------------------------------------------------------ */
/* İki faktörlü doğrulama kurulumu                                     */
/* ------------------------------------------------------------------ */

export interface TotpSetupState {
  error?: string;
  secret?: string;
  otpauth?: string;
  /** Yalnızca bir kez gösterilir. */
  recoveryCodes?: string[];
  enabled?: boolean;
}

/** Yeni bir gizli anahtar üretir ve kullanıcıya gösterir (henüz açmaz). */
export async function beginTotpSetup(): Promise<TotpSetupState> {
  const secret = generateSecret();
  return { secret, otpauth: otpauthUrl(secret) };
}

/**
 * Kullanıcının ürettiği kodu doğrulayıp 2FA'yı açar.
 * Doğrulamadan açmıyoruz — yanlış kurulmuş bir uygulama yüzünden
 * kullanıcının kendini kilitlemesi en kötü sonuç olurdu.
 */
export async function confirmTotpSetup(
  _prev: TotpSetupState,
  formData: FormData,
): Promise<TotpSetupState> {
  const secret = String(formData.get("secret") ?? "");
  const code = String(formData.get("code") ?? "").trim();

  if (!secret) return { error: "Kurulum oturumu bulunamadı, tekrar başlayın." };
  if (!verifyCode(secret, code)) {
    return {
      secret,
      otpauth: otpauthUrl(secret),
      error: "Kod doğrulanamadı. Uygulamadaki güncel kodu girin.",
    };
  }

  const { plain, hashed } = generateRecoveryCodes(8);
  enableTotp(secret, hashed);

  return { enabled: true, recoveryCodes: plain };
}

export async function disableTotpAction(formData: FormData): Promise<void> {
  const pin = String(formData.get("pin") ?? "");
  if (!verifyPin(pin)) throw new Error("Parola yanlış — 2FA kapatılmadı.");
  disableTotp();
  redirect("/ayarlar");
}
