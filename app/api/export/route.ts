import { db } from "@/db/client";
import { transactions, assets } from "@/db/schema";
import { eq } from "drizzle-orm";
import { computeNetWorth } from "@/lib/valuation";
import { loadSnapshots } from "@/lib/snapshot";
import { assertAuth } from "@/lib/session";
import { ensureSettingsRow } from "@/lib/auth";
import { loadTaxReport } from "@/lib/finance/taxService";
import type { LotMethod } from "@/lib/finance/realized";

export const dynamic = "force-dynamic";

/**
 * CSV dışa aktarım: /api/export?type=positions|transactions|snapshots|tax
 *
 * Excel'in Türkçe yerel ayarında CSV'yi doğru açması için ayraç olarak
 * noktalı virgül kullanılır ve dosya BOM ile başlar — aksi halde Türkçe
 * karakterler bozulur ve sütunlar tek hücreye yığılır.
 */

const SEP = ";";
const BOM = "﻿";

export async function GET(request: Request) {
  await assertAuth();
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") ?? "positions";

  let rows: string[][];
  let filename: string;

  switch (type) {
    case "transactions": {
      const data = db
        .select({ tx: transactions, asset: assets })
        .from(transactions)
        .innerJoin(assets, eq(transactions.assetId, assets.id))
        .all()
        .sort((a, b) => a.tx.date.localeCompare(b.tx.date));

      rows = [
        ["Tarih", "Varlık", "Sembol", "İşlem", "Miktar", "Tutar", "Para birimi", "Komisyon", "Not"],
        ...data.map(({ tx, asset }) => [
          tx.date,
          asset.name,
          asset.symbol ?? "",
          TX_LABEL[tx.type] ?? tx.type,
          tx.quantity ?? "",
          tx.amount,
          tx.currency,
          tx.fee ?? "",
          tx.note ?? "",
        ]),
      ];
      filename = "islemler";
      break;
    }

    case "tax": {
      const cfg = ensureSettingsRow();
      const report = await loadTaxReport({
        method: cfg.lotMethod as LotMethod,
        longTermDays: cfg.longTermDays,
      });

      rows = [
        [
          "Yıl", "Tarih", "Varlık", "Sembol", "Miktar", "Hasılat", "Maliyet",
          "K/Z", "Para birimi", "K/Z (USD)", "Kısa vade", "Uzun vade", "Tutma (gün)",
        ],
        ...report.years.flatMap((y) =>
          y.lines.map((l) => [
            String(y.year),
            l.date,
            l.assetName,
            l.symbol ?? "",
            l.quantity,
            l.proceeds,
            l.costBasis,
            l.gain,
            l.currency,
            l.gainUsd,
            l.shortTermGain,
            l.longTermGain,
            String(l.maxHoldingDays),
          ]),
        ),
      ];
      filename = `vergi-${report.method}`;
      break;
    }

    case "snapshots": {
      const data = loadSnapshots(3650);
      rows = [
        ["Tarih", "Net servet (USD)"],
        ...data.map((s) => [s.date, s.totalUsd]),
      ];
      filename = "servet-gecmisi";
      break;
    }

    default: {
      const nw = await computeNetWorth();
      rows = [
        [
          "Varlık", "Tür", "Sembol", "Ülke", "Para birimi",
          "Değer (yerel)", "Değer (USD)", "Maliyet", "K/Z", "Değer kaynağı",
        ],
        ...nw.assets.map((a) => [
          a.name,
          KIND_LABEL[a.kind] ?? a.kind,
          a.symbol ?? "",
          a.country ?? "",
          a.currency,
          a.valueLocal.toDb(),
          a.valueUsd.toDb(),
          a.costLocal?.toDb() ?? "",
          a.unrealizedPnl?.toDb() ?? "",
          BASIS_LABEL[a.basis] ?? a.basis,
        ]),
        [],
        ["TOPLAM", "", "", "", "USD", "", nw.totalUsd.toDb(), "", "", ""],
      ];
      filename = "varliklar";
    }
  }

  const csv = BOM + rows.map((r) => r.map(escapeCell).join(SEP)).join("\r\n");
  const date = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="servet-${filename}-${date}.csv"`,
    },
  });
}

function escapeCell(value: string): string {
  // Ondalık ayracı virgüle çevrilmez — sayılar ham haliyle kalır ki
  // başka bir araca aktarıldığında yanlış okunmasın.
  if (value.includes(SEP) || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const KIND_LABEL: Record<string, string> = {
  equity: "Hisse", crypto: "Kripto", commodity: "Emtia", deposit: "Mevduat",
  realestate: "Gayrimenkul", vehicle: "Araç", venture: "Girişim", cash: "Nakit",
};

const BASIS_LABEL: Record<string, string> = {
  live: "Canlı fiyat",
  stale: "Bayat fiyat",
  accrual: "Faiz tahakkuku",
  model: "Model",
  book: "Defter değeri",
};

const TX_LABEL: Record<string, string> = {
  buy: "Alım", sell: "Satım", dividend: "Temettü", interest: "Faiz",
  rent: "Kira", staking: "Staking", expense: "Gider", fee: "Komisyon",
  tax: "Vergi", deposit_in: "Para girişi", withdraw: "Para çıkışı",
  capital_call: "Sermaye çağrısı", distribution: "Dağıtım", valuation: "Değerleme",
};
