"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertAuth } from "@/lib/session";
import * as svc from "@/lib/services/dispose";
import { db } from "@/db/client";
import { liabilities } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Satış, kapatma ve geri alma eylemleri.
 * İnce sarmalayıcı — mantık `lib/services/dispose.ts` içinde.
 */

export interface DisposeState {
  error?: string;
  warnings?: string[];
  done?: boolean;
}

function revalidateAll(): void {
  for (const p of [
    "/", "/portfoy", "/mevduat", "/gayrimenkul", "/arac", "/girisim",
    "/nakit-akisi", "/firsatlar", "/senaryo", "/plan", "/borclar", "/islemler",
  ]) {
    revalidatePath(p);
  }
}

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

export async function sellPositionAction(
  _p: DisposeState,
  fd: FormData,
): Promise<DisposeState> {
  await assertAuth();
  try {
    const result = await svc.sellPosition({
      assetId: str(fd, "assetId"),
      quantity: str(fd, "quantity"),
      pricePerUnit: str(fd, "pricePerUnit"),
      date: str(fd, "date") || svc.today(),
      fee: str(fd, "fee") || null,
      proceedsToCashId: str(fd, "proceedsToCashId") || null,
    });
    revalidateAll();
    return { done: true, warnings: result.warnings };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function sellPhysicalAction(
  _p: DisposeState,
  fd: FormData,
): Promise<DisposeState> {
  await assertAuth();
  try {
    const result = await svc.sellPhysicalAsset({
      assetId: str(fd, "assetId"),
      salePrice: str(fd, "salePrice"),
      date: str(fd, "date") || svc.today(),
      costs: str(fd, "costs") || null,
      proceedsToCashId: str(fd, "proceedsToCashId") || null,
    });
    revalidateAll();
    return { done: true, warnings: result.warnings };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function closeDepositAction(
  _p: DisposeState,
  fd: FormData,
): Promise<DisposeState> {
  await assertAuth();
  try {
    const result = await svc.closeDeposit({
      assetId: str(fd, "assetId"),
      date: str(fd, "date") || svc.today(),
      proceedsToCashId: str(fd, "proceedsToCashId") || null,
      interestForfeitRate: str(fd, "interestForfeitRate") || undefined,
    });
    revalidateAll();
    return { done: true, warnings: result.warnings };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function exitVentureAction(
  _p: DisposeState,
  fd: FormData,
): Promise<DisposeState> {
  await assertAuth();
  try {
    const result = await svc.exitVenture({
      assetId: str(fd, "assetId"),
      proceeds: str(fd, "proceeds") || "0",
      date: str(fd, "date") || svc.today(),
      proceedsToCashId: str(fd, "proceedsToCashId") || null,
    });
    revalidateAll();
    return { done: true, warnings: result.warnings };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function undoSaleAction(fd: FormData): Promise<void> {
  await assertAuth();
  const assetId = str(fd, "assetId");
  if (!assetId) return;
  svc.undoSale(assetId);
  revalidateAll();
}

export async function cancelPlannedAction(fd: FormData): Promise<void> {
  await assertAuth();
  const assetId = str(fd, "assetId");
  if (!assetId) return;
  svc.cancelPlanned(assetId);
  revalidateAll();
  redirect("/plan");
}

/** Krediyi erken kapatır. */
export async function settleLoanAction(fd: FormData): Promise<void> {
  await assertAuth();
  const id = str(fd, "id");
  if (!id) return;

  db.update(liabilities)
    .set({ status: "settled", updatedAt: new Date().toISOString() })
    .where(eq(liabilities.id, id))
    .run();

  revalidateAll();
  redirect("/borclar");
}
