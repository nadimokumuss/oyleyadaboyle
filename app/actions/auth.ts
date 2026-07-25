"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { settings } from "@/db/schema";
import {
  setPin, verifyPin, createSessionToken, ensureSettingsRow, getAuthState,
  SESSION_COOKIE, SESSION_MAX_AGE_SECONDS,
  registerFailedAttempt, clearFailedAttempts, lockRemainingSeconds,
} from "@/lib/auth";
import { toDecimal } from "@/lib/money";

export interface ActionState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

async function startSession(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    // Panel yerelde http üzerinden çalışıyor; secure zorlarsak çerez hiç
    // yazılmaz. Üretimde HTTPS ardına konursa burası açılmalı.
    secure: process.env.NODE_ENV === "production" && process.env.SERVET_HTTPS === "1",
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
  const state = getAuthState();
  if (state.setupCompleted) {
    return { error: "Kurulum zaten tamamlanmış." };
  }

  const pin = String(formData.get("pin") ?? "");
  const pinConfirm = String(formData.get("pinConfirm") ?? "");
  const baseCurrency = String(formData.get("baseCurrency") ?? "USD").toUpperCase();
  const livingCostRaw = String(formData.get("monthlyLivingCost") ?? "").trim();
  const horizonRaw = String(formData.get("horizonYears") ?? "20");
  const riskProfile = String(formData.get("riskProfile") ?? "balanced");

  const fieldErrors: Record<string, string> = {};

  if (pin.length < 4) fieldErrors.pin = "PIN en az 4 karakter olmalı";
  if (pin.length > 64) fieldErrors.pin = "PIN çok uzun";
  if (pin !== pinConfirm) fieldErrors.pinConfirm = "PIN'ler eşleşmiyor";

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

  clearFailedAttempts();
  await startSession();
  redirect("/");
}

/* ------------------------------------------------------------------ */
/* Giriş / çıkış                                                       */
/* ------------------------------------------------------------------ */

export async function login(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const locked = lockRemainingSeconds();
  if (locked > 0) {
    return { error: `Çok fazla hatalı deneme. ${locked} saniye sonra tekrar deneyin.` };
  }

  const pin = String(formData.get("pin") ?? "");
  if (!pin) return { fieldErrors: { pin: "PIN girin" } };

  if (!verifyPin(pin)) {
    registerFailedAttempt();
    const wait = lockRemainingSeconds();
    return {
      fieldErrors: {
        pin: wait > 0 ? `Hatalı PIN. ${wait} saniye bekleyin.` : "Hatalı PIN",
      },
    };
  }

  clearFailedAttempts();
  await startSession();
  redirect("/");
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/giris");
}
