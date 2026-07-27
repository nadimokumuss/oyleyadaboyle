import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { assets, liabilities, transactions } from "@/db/schema";
import { Money, formatMoney } from "@/lib/money";
import { monthlyPayment, expectedPaymentsByNow } from "@/lib/finance/loan";
import Decimal from "decimal.js";
import { record } from "./notify";

/**
 * Kredi taksitlerinin kendiliğinden ilerlemesi.
 *
 * `liabilities.paymentsMade` bugüne kadar elle artırılan bir sayaçtı;
 * kimse artırmazsa borç hiç azalmıyor, net servet olduğundan düşük
 * görünüyordu. Ödeme planı `lib/finance/loan.ts` içinde zaten üretiliyordu —
 * eksik olan tek şey onu zamana bağlamaktı.
 *
 * ## Neden varsayılan kapalı
 *
 * Arka planda çalışan bir iş, nakit hesabınızdan para düşer. Bu,
 * kullanıcının açıkça istemesi gereken bir davranış — `autoPay` alanı
 * varsayılan `false` ve mevcut kayıtlar hiçbir şekilde etkilenmez.
 *
 * ## Neden ilk çalıştırma para hareketi üretmez
 *
 * `paymentsMade` sıfırken açılan bir kredi aylar öncesine ait olabilir.
 * O durumda geçmişin tamamını nakitten düşmek yanlış olur: taksitler
 * gerçekte zaten ödenmiştir, panel sadece bilmiyordur. İlk tur sayacı
 * bugüne **eşitler** (referans alma), sonraki turlar gerçek hareket üretir.
 */

export interface AutopayResult {
  processed: number;
  installments: number;
  baselined: number;
}

export function runLoanAutopay(now = new Date()): AutopayResult {
  const rows = db
    .select()
    .from(liabilities)
    .all()
    .filter((r) => r.status === "active" && r.autoPay);

  let installments = 0;
  let baselined = 0;
  let processed = 0;

  for (const loan of rows) {
    const expected = Math.min(
      expectedPaymentsByNow(new Date(loan.startDate), loan.termMonths, now),
      loan.termMonths,
    );
    if (expected <= loan.paymentsMade) continue;

    processed++;

    // İlk kez devreye giriyor: geçmişi para hareketiyle canlandırma,
    // yalnızca sayacı bugüne getir.
    if (loan.paymentsMade === 0 && expected > 1) {
      db.update(liabilities)
        .set({ paymentsMade: expected, updatedAt: new Date().toISOString() })
        .where(eq(liabilities.id, loan.id))
        .run();
      baselined++;
      continue;
    }

    const due = expected - loan.paymentsMade;
    const payment = monthlyPayment({
      principal: Money.of(loan.principal, loan.currency),
      annualRate: new Decimal(loan.annualRate),
      termMonths: loan.termMonths,
      startDate: new Date(loan.startDate),
    });

    const cashAsset = loan.paymentAssetId
      ? db.select().from(assets).where(eq(assets.id, loan.paymentAssetId)).get()
      : undefined;

    // Sayaç ilerletme ve nakit çıkışı tek transaction'da — arada çökme
    // olursa ikisi de geri alınır, borç azalıp para yerinde kalmaz.
    db.transaction((tx) => {
      if (cashAsset) {
        for (let i = 0; i < due; i++) {
          const installmentNo = loan.paymentsMade + i + 1;
          tx.insert(transactions)
            .values({
              id: randomUUID(),
              assetId: cashAsset.id,
              type: "withdraw",
              date: new Date().toISOString().slice(0, 10),
              amount: payment.toDb(),
              currency: loan.currency,
              fxRateToUsd: loan.currency.toUpperCase() === "USD" ? "1" : null,
              note: `${loan.name} ${installmentNo}. taksit (otomatik)`,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            })
            .run();
        }
      }

      tx.update(liabilities)
        .set({
          paymentsMade: expected,
          status: expected >= loan.termMonths ? "paid" : "active",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(liabilities.id, loan.id))
        .run();
    });

    installments += due;

    record({
      kind: "loan",
      severity: "info",
      title: `${loan.name}: ${due} taksit işlendi`,
      body: cashAsset
        ? `Toplam ${formatMoney(payment.times(due))} ${cashAsset.name} hesabından düşüldü. ` +
          `Kalan taksit: ${loan.termMonths - expected}.`
        : `Sayaç ilerletildi (nakit hesabı seçilmediği için para hareketi yazılmadı). ` +
          `Kalan taksit: ${loan.termMonths - expected}.`,
      dedupeKey: `loan:${loan.id}:${expected}`,
    });
  }

  return { processed, installments, baselined };
}
