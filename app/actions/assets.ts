"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertAuth } from "@/lib/session";
import {
  validate, cashSchema, positionSchema, depositSchema,
  propertySchema, vehicleSchema, ventureSchema, transactionSchema,
  watchlistSchema, bondSchema, pensionSchema, collectibleSchema,
} from "@/lib/schemas";
import * as other from "@/lib/services/otherAssets";
import * as svc from "@/lib/services/assets";
import { db } from "@/db/client";
import { watchlist } from "@/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

/**
 * Server Action katmanı — kasten ince.
 *
 * Her eylem üç şey yapar: yetki kontrolü, şema doğrulaması, servis
 * çağrısı. İş mantığı `lib/services` içinde, doğrulama `lib/schemas`
 * içinde; ikisi de bu dosyadan bağımsız test edilebiliyor.
 */

export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Başarılıysa oluşan/güncellenen kaydın kimliği. */
  savedId?: string;
}

/** Değişiklikten sonra tazelenmesi gereken sayfalar. */
function revalidateAll(): void {
  for (const p of [
    "/", "/portfoy", "/mevduat", "/gayrimenkul", "/arac", "/girisim",
    "/nakit-akisi", "/firsatlar", "/senaryo", "/plan", "/kesfet", "/ayarlar",
    "/tahvil", "/emeklilik", "/kiymetli-esya", "/vergi",
  ]) {
    revalidatePath(p);
  }
}

/**
 * Ortak sarmalayıcı: doğrula → kaydet → tazele → yönlendir.
 * `redirect` bir istisna fırlattığı için try bloğunun dışında çağrılır.
 */
async function handle<T>(
  formData: FormData,
  schema: Parameters<typeof validate<T>>[0],
  save: (data: T) => Promise<string> | string,
  redirectTo?: string,
): Promise<FormState> {
  await assertAuth();

  const result = validate(schema, formData);
  if (!result.success) return { fieldErrors: result.fieldErrors };

  let savedId: string;
  try {
    savedId = await save(result.data!);
  } catch (err) {
    return { error: (err as Error).message || "Kaydedilemedi" };
  }

  revalidateAll();
  if (redirectTo) redirect(redirectTo);
  return { savedId };
}

/* ------------------------------------------------------------------ */
/* Varlık kaydetme                                                     */
/* ------------------------------------------------------------------ */

export async function saveCashAction(_p: FormState, fd: FormData): Promise<FormState> {
  return handle(fd, cashSchema, svc.saveCash, "/portfoy");
}

export async function savePositionAction(_p: FormState, fd: FormData): Promise<FormState> {
  const target = String(fd.get("status")) === "planned" ? "/plan" : "/portfoy";
  return handle(fd, positionSchema, svc.savePosition, target);
}

export async function saveDepositAction(_p: FormState, fd: FormData): Promise<FormState> {
  return handle(fd, depositSchema, svc.saveDeposit, "/mevduat");
}

export async function savePropertyAction(_p: FormState, fd: FormData): Promise<FormState> {
  const target = String(fd.get("status")) === "planned" ? "/plan" : "/gayrimenkul";
  return handle(fd, propertySchema, svc.saveProperty, target);
}

export async function saveVehicleAction(_p: FormState, fd: FormData): Promise<FormState> {
  const target = String(fd.get("status")) === "planned" ? "/plan" : "/arac";
  return handle(fd, vehicleSchema, svc.saveVehicle, target);
}

export async function saveVentureAction(_p: FormState, fd: FormData): Promise<FormState> {
  const target = String(fd.get("status")) === "planned" ? "/plan" : "/girisim";
  return handle(fd, ventureSchema, svc.saveVenture, target);
}

export async function saveBondAction(_p: FormState, fd: FormData): Promise<FormState> {
  const target = String(fd.get("status")) === "planned" ? "/plan" : "/tahvil";
  return handle(fd, bondSchema, other.saveBond, target);
}

export async function savePensionAction(_p: FormState, fd: FormData): Promise<FormState> {
  return handle(fd, pensionSchema, other.savePension, "/emeklilik");
}

export async function saveCollectibleAction(_p: FormState, fd: FormData): Promise<FormState> {
  const target = String(fd.get("status")) === "planned" ? "/plan" : "/kiymetli-esya";
  return handle(fd, collectibleSchema, other.saveCollectible, target);
}

export async function saveTransactionAction(_p: FormState, fd: FormData): Promise<FormState> {
  return handle(fd, transactionSchema, svc.saveTransaction);
}

/* ------------------------------------------------------------------ */
/* Silme ve durum değişikliği                                          */
/* ------------------------------------------------------------------ */

export async function deleteAssetAction(formData: FormData): Promise<void> {
  await assertAuth();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Silinecek varlık belirtilmedi");

  svc.deleteAsset(id);
  revalidateAll();

  const back = String(formData.get("redirectTo") ?? "");
  if (back) redirect(back);
}

export async function deleteTransactionAction(formData: FormData): Promise<void> {
  await assertAuth();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Silinecek işlem belirtilmedi");

  svc.deleteTransaction(id);
  revalidateAll();
}

export async function markPurchasedAction(formData: FormData): Promise<void> {
  await assertAuth();
  const assetId = String(formData.get("assetId") ?? "");
  if (!assetId) throw new Error("Varlık belirtilmedi");

  const cashAssetId = String(formData.get("cashAssetId") ?? "");
  const amount = String(formData.get("amount") ?? "");
  const currency = String(formData.get("currency") ?? "");

  svc.markAsPurchased(assetId, {
    deductFromCashAssetId: cashAssetId || undefined,
    amount: amount || undefined,
    currency: currency || undefined,
  });

  revalidateAll();
  redirect("/plan");
}

/* ------------------------------------------------------------------ */
/* İzleme listesi                                                      */
/* ------------------------------------------------------------------ */

export async function addToWatchlistAction(formData: FormData): Promise<void> {
  await assertAuth();

  const result = validate(watchlistSchema, formData);
  if (!result.success) throw new Error("İzleme listesine eklenemedi");

  const d = result.data!;
  db.insert(watchlist)
    .values({
      id: randomUUID(),
      symbol: d.symbol,
      name: d.name,
      kind: d.kind,
      exchange: d.exchange,
      currency: d.currency,
      note: d.note,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .run();

  revalidatePath("/kesfet");
}

export async function removeFromWatchlistAction(formData: FormData): Promise<void> {
  await assertAuth();
  const symbol = String(formData.get("symbol") ?? "").toUpperCase();
  if (!symbol) return;

  db.delete(watchlist).where(eq(watchlist.symbol, symbol)).run();
  revalidatePath("/kesfet");
}
