"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/db/client";
import { settings, targets, assets, transactions, withholdingRates } from "@/db/schema";
import { assertAuth } from "@/lib/session";
import { setPin, verifyPin } from "@/lib/auth";
import { validate, settingsSchema, assumptionsSchema } from "@/lib/schemas";
import { importPositionsCsv } from "@/lib/services/import";
import type { FormState } from "./assets";

/**
 * Ayarlar, hedef dağılım, stopaj oranları ve veri yönetimi.
 */

function revalidateAll(): void {
  for (const p of [
    "/", "/portfoy", "/mevduat", "/gayrimenkul", "/arac", "/girisim",
    "/nakit-akisi", "/firsatlar", "/senaryo", "/plan", "/ayarlar",
  ]) {
    revalidatePath(p);
  }
}

export async function saveSettingsAction(
  _p: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertAuth();

  const result = validate(settingsSchema, formData);
  if (!result.success) return { fieldErrors: result.fieldErrors };

  const d = result.data!;
  db.update(settings)
    .set({
      baseCurrency: d.baseCurrency,
      monthlyLivingCost: d.monthlyLivingCost,
      livingCostCurrency: d.livingCostCurrency,
      riskProfile: d.riskProfile,
      horizonYears: d.horizonYears,
      idleCashThreshold: d.idleCashThreshold,
      concentrationThreshold: d.concentrationThreshold,
      lotMethod: d.lotMethod,
      longTermDays: d.longTermDays,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(settings.id, "singleton"))
    .run();

  revalidateAll();
  return { savedId: "settings" };
}

/* ------------------------------------------------------------------ */
/* Varsayımlar — enflasyon ve referans getiriler                        */
/* ------------------------------------------------------------------ */

/**
 * Ayrı bir eylem, çünkü bunlar "tercih" değil **model girdisi**:
 * reel getiriyi ve karşı-olgusal karşılaştırmayı doğrudan üretirler.
 * Genel ayarlarla aynı forma sıkıştırmak ikisini de bulanıklaştırırdı.
 * `saveTargetsAction` ile aynı desen.
 */
export async function saveAssumptionsAction(
  _p: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertAuth();

  const result = validate(assumptionsSchema, formData);
  if (!result.success) return { fieldErrors: result.fieldErrors };

  const d = result.data!;
  db.update(settings)
    .set({
      inflationRates: {
        TRY: d.inflationTRY,
        USD: d.inflationUSD,
        EUR: d.inflationEUR,
        GBP: d.inflationGBP,
        CHF: d.inflationCHF,
      },
      benchmarkReturns: {
        usd_deposit: d.benchmark_usd_deposit,
        gold: d.benchmark_gold,
        sp500: d.benchmark_sp500,
      },
      capitalGainsRate: d.capitalGainsRate,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(settings.id, "singleton"))
    .run();

  revalidateAll();
  return { savedId: "assumptions" };
}

/* ------------------------------------------------------------------ */
/* PIN değiştirme                                                      */
/* ------------------------------------------------------------------ */

export async function changePinAction(
  _p: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertAuth();

  const current = String(formData.get("currentPin") ?? "");
  const next = String(formData.get("newPin") ?? "");
  const confirm = String(formData.get("newPinConfirm") ?? "");

  if (!verifyPin(current)) {
    return { fieldErrors: { currentPin: "Mevcut PIN yanlış" } };
  }
  if (next.length < 4) {
    return { fieldErrors: { newPin: "PIN en az 4 karakter olmalı" } };
  }
  if (next !== confirm) {
    return { fieldErrors: { newPinConfirm: "PIN'ler eşleşmiyor" } };
  }

  setPin(next);
  return { savedId: "pin" };
}

/* ------------------------------------------------------------------ */
/* Hedef dağılım                                                       */
/* ------------------------------------------------------------------ */

/**
 * Hedef dağılımı topluca kaydeder.
 *
 * Toplamın %100 olması zorunlu değil (nakit payı boş bırakılabilir)
 * ama %100'ü aşarsa uyarılır — aşan bir hedef hiçbir zaman
 * tutturulamaz ve `rebalance` kuralı sürekli yanlış uyarı verir.
 */
export async function saveTargetsAction(
  _p: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertAuth();

  const kinds = [
    "equity", "crypto", "deposit", "realestate", "vehicle", "venture", "cash", "commodity",
  ];

  const rows: Array<{ key: string; pct: number }> = [];
  for (const kind of kinds) {
    const raw = String(formData.get(`target_${kind}`) ?? "").trim();
    if (!raw) continue;
    const pct = Number(raw);
    if (!Number.isFinite(pct) || pct < 0 || pct > 1) {
      return { fieldErrors: { [`target_${kind}`]: "0 ile %100 arasında olmalı" } };
    }
    if (pct > 0) rows.push({ key: kind, pct });
  }

  const total = rows.reduce((a, r) => a + r.pct, 0);
  if (total > 1.0001) {
    return {
      error: `Hedeflerin toplamı %${(total * 100).toFixed(0)} — %100'ü aşamaz.`,
    };
  }

  const tolerance = String(formData.get("tolerance") ?? "0.05");

  db.delete(targets).where(eq(targets.dimension, "kind")).run();
  if (rows.length > 0) {
    db.insert(targets)
      .values(
        rows.map((r) => ({
          id: randomUUID(),
          dimension: "kind" as const,
          key: r.key,
          targetPct: String(r.pct),
          tolerancePct: tolerance,
        })),
      )
      .run();
  }

  revalidateAll();
  return { savedId: "targets" };
}

/* ------------------------------------------------------------------ */
/* Stopaj oranları                                                     */
/* ------------------------------------------------------------------ */

export async function saveWithholdingAction(formData: FormData): Promise<void> {
  await assertAuth();

  const id = String(formData.get("id") ?? "");
  const rate = String(formData.get("rate") ?? "");
  const parsed = Number(rate);
  if (!id || !Number.isFinite(parsed) || parsed < 0 || parsed > 1) return;

  db.update(withholdingRates)
    .set({ rate: String(parsed) })
    .where(eq(withholdingRates.id, id))
    .run();

  revalidateAll();
}

/* ------------------------------------------------------------------ */
/* Veri yönetimi                                                       */
/* ------------------------------------------------------------------ */

/** IP kısıtlama ayarlarını kaydeder. */
export async function saveSecurityAction(
  _p: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertAuth();

  const raw = String(formData.get("allowedIps") ?? "").trim();

  // Biçim doğrulaması: kendini yanlış bir kuralla kilitlememek için
  if (raw) {
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      const [addr, bits] = part.split("/");
      const octets = addr.split(".");
      const validAddr =
        octets.length === 4 &&
        octets.every((o) => {
          const n = Number(o);
          return Number.isInteger(n) && n >= 0 && n <= 255;
        });
      const validBits =
        bits === undefined ||
        (Number.isInteger(Number(bits)) && Number(bits) >= 0 && Number(bits) <= 32);

      if (!validAddr || !validBits) {
        return { fieldErrors: { allowedIps: `Geçersiz adres: ${part}` } };
      }
    }
  }

  db.update(settings)
    .set({ allowedIps: raw || null, updatedAt: new Date().toISOString() })
    .where(eq(settings.id, "singleton"))
    .run();

  revalidateAll();
  return { savedId: "security" };
}

export interface ImportState {
  error?: string;
  imported?: number;
  total?: number;
  skipped?: Array<{ line: number; reason: string }>;
}

/**
 * CSV içe aktarım.
 *
 * Hatalı satırlar tüm işlemi iptal etmez; geçenler yüklenir, geçmeyenler
 * satır numarasıyla raporlanır.
 */
export async function importCsvAction(
  _p: ImportState,
  formData: FormData,
): Promise<ImportState> {
  await assertAuth();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Bir CSV dosyası seçin" };
  }
  if (file.size > 5 * 1024 * 1024) {
    return { error: "Dosya çok büyük (en fazla 5 MB)" };
  }

  try {
    const content = await file.text();
    const result = await importPositionsCsv(content);
    revalidateAll();

    return {
      imported: result.imported,
      total: result.total,
      skipped: result.skipped.map((s) => ({ line: s.line, reason: s.reason })),
    };
  } catch (err) {
    return { error: `Dosya okunamadı: ${(err as Error).message}` };
  }
}

/**
 * Tüm varlık ve işlem kayıtlarını siler.
 *
 * Ayarlar, PIN ve stopaj tablosu korunur — kullanıcı verisini
 * temizlemek istiyor, kurulumu baştan yapmak değil.
 */
export async function clearAllDataAction(formData: FormData): Promise<void> {
  await assertAuth();

  const confirmation = String(formData.get("confirm") ?? "");
  if (confirmation !== "SİL") {
    throw new Error('Onay için kutuya "SİL" yazmanız gerekiyor');
  }

  db.delete(transactions).run();
  db.delete(assets).run();
  db.delete(targets).run();

  revalidateAll();
}
