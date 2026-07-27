"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { assets, liabilities, settings } from "@/db/schema";
import { assertAuth } from "@/lib/session";
import {
  validate,
  alertSchema,
  recurringSchema,
  notifySettingsSchema,
  goalSchema,
} from "@/lib/schemas";
import { saveGoal, deleteGoal } from "@/lib/services/goals";
import { createAlert, deleteAlert } from "@/lib/services/alerts";
import { saveRecurring, deleteRecurring } from "@/lib/services/recurring";
import { markAllRead, postWebhook, webhookUrl } from "@/lib/services/notify";
import type { FormState } from "./assets";

/**
 * Otomasyon katmanının eylemleri: alarmlar, tekrarlayan hareketler,
 * bildirim ayarları.
 *
 * `app/actions/assets.ts` ile aynı desen — yetki, doğrulama, servis
 * çağrısı. İş mantığı burada durmaz.
 */

function revalidateAutomation(): void {
  for (const p of ["/", "/kesfet", "/nakit-akisi", "/ayarlar", "/islemler", "/borclar"]) {
    revalidatePath(p);
  }
}

/* ------------------------------------------------------------------ */
/* Fiyat alarmları                                                      */
/* ------------------------------------------------------------------ */

export async function createAlertAction(
  _p: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertAuth();

  const result = validate(alertSchema, formData);
  if (!result.success) return { fieldErrors: result.fieldErrors };

  const d = result.data!;
  const id = createAlert({
    symbol: d.symbol,
    condition: d.condition,
    threshold: d.threshold,
    currency: d.currency,
    note: d.note,
  });

  revalidateAutomation();
  return { savedId: id };
}

export async function deleteAlertAction(id: string): Promise<void> {
  await assertAuth();
  deleteAlert(id);
  revalidateAutomation();
}

/* ------------------------------------------------------------------ */
/* Tekrarlayan hareketler                                               */
/* ------------------------------------------------------------------ */

export async function saveRecurringAction(
  _p: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertAuth();

  const result = validate(recurringSchema, formData);
  if (!result.success) return { fieldErrors: result.fieldErrors };

  const d = result.data!;
  const id = saveRecurring({
    id: d.id,
    assetId: d.assetId,
    label: d.label,
    type: d.type,
    amount: d.amount,
    currency: d.currency,
    frequency: d.frequency,
    startDate: d.startDate,
    endDate: d.endDate,
    note: d.note,
  });

  revalidateAutomation();
  return { savedId: id };
}

export async function deleteRecurringAction(id: string): Promise<void> {
  await assertAuth();
  deleteRecurring(id);
  revalidateAutomation();
}

/* ------------------------------------------------------------------ */
/* Finansal hedefler                                                    */
/* ------------------------------------------------------------------ */

export async function saveGoalAction(
  _p: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertAuth();

  const result = validate(goalSchema, formData);
  if (!result.success) return { fieldErrors: result.fieldErrors };

  const d = result.data!;
  const id = saveGoal({
    id: d.id,
    name: d.name,
    targetAmount: d.targetAmount,
    currency: d.currency,
    targetDate: d.targetDate,
    kind: d.kind,
    priority: d.priority,
    note: d.note,
  });

  revalidatePath("/senaryo");
  revalidateAutomation();
  return { savedId: id };
}

export async function deleteGoalAction(id: string): Promise<void> {
  await assertAuth();
  deleteGoal(id);
  revalidatePath("/senaryo");
  revalidateAutomation();
}

/* ------------------------------------------------------------------ */
/* Kredi otomatik ödeme                                                 */
/* ------------------------------------------------------------------ */

export async function saveAutopayAction(
  _p: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertAuth();

  const liabilityId = String(formData.get("liabilityId") ?? "").trim();
  if (!liabilityId) return { error: "Kredi bulunamadı." };

  const autoPay = formData.get("autoPay") === "on";
  const rawAsset = String(formData.get("paymentAssetId") ?? "").trim();
  const paymentAssetId = rawAsset || null;

  // Nakit hesabı seçildiyse gerçekten var olduğunu ve nakit olduğunu
  // doğrula — form değerleri istemciden gelir, güvenilmez.
  if (paymentAssetId) {
    const asset = db.select().from(assets).where(eq(assets.id, paymentAssetId)).get();
    if (!asset || asset.kind !== "cash") {
      return { error: "Seçilen hesap bir nakit hesabı değil." };
    }
  }

  db.update(liabilities)
    .set({ autoPay, paymentAssetId, updatedAt: new Date().toISOString() })
    .where(eq(liabilities.id, liabilityId))
    .run();

  revalidateAutomation();
  return { savedId: liabilityId };
}

/* ------------------------------------------------------------------ */
/* Bildirim ayarları                                                    */
/* ------------------------------------------------------------------ */

export async function saveNotifySettingsAction(
  _p: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertAuth();

  const result = validate(notifySettingsSchema, formData);
  if (!result.success) return { fieldErrors: result.fieldErrors };

  const d = result.data!;
  db.update(settings)
    .set({
      webhookUrl: d.webhookUrl,
      schedulerEnabled: d.schedulerEnabled,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(settings.id, "singleton"))
    .run();

  revalidateAutomation();
  return { savedId: "notify" };
}

/**
 * Webhook'u test eder.
 *
 * Kaydedilmiş adrese gerçek bir istek atar — "kaydettim ama çalışıyor mu"
 * sorusunu panelden çıkmadan yanıtlar. Hata mesajı olduğu gibi gösterilir;
 * yanlış adresi ancak böyle fark edersiniz.
 */
export async function testWebhookAction(): Promise<FormState> {
  await assertAuth();

  const url = webhookUrl();
  if (!url) return { error: "Önce bir webhook adresi kaydedin." };

  try {
    await postWebhook(url, {
      kind: "system",
      severity: "info",
      title: "Servet Terminali — test bildirimi",
      body: "Bu mesajı gördüyseniz bildirimler çalışıyor.",
      at: new Date().toISOString(),
      text: "Servet Terminali — test bildirimi\nBu mesajı gördüyseniz bildirimler çalışıyor.",
    });
    return { savedId: "test" };
  } catch (err) {
    return { error: `Gönderilemedi: ${(err as Error).message}` };
  }
}

export async function markNotificationsReadAction(): Promise<void> {
  await assertAuth();
  markAllRead();
  revalidateAutomation();
}
