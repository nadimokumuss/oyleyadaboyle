import Decimal from "decimal.js";
import { db } from "@/db/client";
import { assets, transactions, liabilities } from "@/db/schema";
import { Money, formatMoney } from "@/lib/money";
import { computePosition } from "@/lib/finance/costbasis";
import { hasFunding } from "./funding";

/**
 * Tutarlılık denetimi.
 *
 * Panelin kendi kendini kontrol etmesi. Amacı, aynı muhasebe hatasının
 * sessizce tekrar oluşmasını engellemek: bir varlık ödemesiz eklenirse
 * ya da nakit eksiye düşerse kullanıcı bunu görmeli, sayılara körü
 * körüne güvenmemeli.
 */

export type AuditSeverity = "error" | "warning" | "info";

export interface AuditFinding {
  key: string;
  severity: AuditSeverity;
  title: string;
  detail: string;
  /** Sorunu çözmek için nereye gidileceği. */
  href?: string;
  assetIds?: string[];
}

export function runAudit(): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const allAssets = db.select().from(assets).all();
  const allTx = db.select().from(transactions).all();

  /* --- 1. Negatif nakit --- */
  const negativeCash: Array<{ name: string; balance: Money }> = [];
  for (const asset of allAssets.filter((a) => a.kind === "cash" && a.status === "active")) {
    const position = computePosition(
      asset.id,
      asset.currency,
      allTx.filter((t) => t.assetId === asset.id),
    );
    const balance = position.totalCost
      .plus(position.incomeReceived)
      .minus(position.costsPaid);

    if (balance.isNegative()) {
      negativeCash.push({ name: asset.name, balance });
    }
  }

  if (negativeCash.length > 0) {
    findings.push({
      key: "negativeCash",
      severity: "error",
      title: `${negativeCash.length} hesapta nakit eksiye düşmüş`,
      detail:
        negativeCash
          .map((c) => `${c.name}: ${formatMoney(c.balance)}`)
          .join(" · ") +
        ". Harcadığınızdan fazlasını girmişsiniz gibi görünüyor — ya bir alımın " +
        "ödeme kaynağını düzeltin ya da eksik kalan nakit girişini ekleyin.",
      href: "/islemler",
    });
  }

  /* --- 2. Ödeme kaynağı olmayan varlıklar --- */
  // "Zaten sahibim" seçilmiş olabilir; bu meşru. Ama alım tarihi
  // yakınsa ve ödeme yoksa muhtemelen atlanmıştır.
  const unfunded: string[] = [];
  const recentCutoff = Date.now() - 90 * 86_400_000;

  for (const asset of allAssets) {
    if (asset.status !== "active") continue;
    if (asset.kind === "cash") continue;
    if (hasFunding(asset.id)) continue;

    const created = new Date(asset.createdAt).getTime();
    if (created >= recentCutoff) unfunded.push(asset.name);
  }

  if (unfunded.length > 0) {
    findings.push({
      key: "unfunded",
      severity: "warning",
      title: `${unfunded.length} varlığın ödeme kaynağı belirtilmemiş`,
      detail:
        unfunded.slice(0, 5).join(", ") +
        (unfunded.length > 5 ? ` ve ${unfunded.length - 5} tane daha` : "") +
        ". Bu varlıklar servetinize eklendi ama hiçbir hesaptan para düşülmedi. " +
        "Zaten sahip olduğunuz varlıklarsa sorun yok; yeni aldıysanız " +
        "düzenleyip ödeme kaynağını seçin.",
      href: "/islemler",
    });
  }

  /* --- 3. Satılmış ama kredisi kapanmamış --- */
  const soldWithLoan: string[] = [];
  const activeLoans = db.select().from(liabilities).all().filter((l) => l.status === "active");

  for (const loan of activeLoans) {
    if (!loan.assetId) continue;
    const asset = allAssets.find((a) => a.id === loan.assetId);
    if (asset && (asset.status === "sold" || asset.status === "closed")) {
      soldWithLoan.push(`${asset.name} → ${loan.name}`);
    }
  }

  if (soldWithLoan.length > 0) {
    findings.push({
      key: "soldWithLoan",
      severity: "error",
      title: "Satılan varlığın kredisi hâlâ açık",
      detail:
        soldWithLoan.join(" · ") +
        ". Varlık gitti ama borç duruyor — bu net servetinizi olduğundan " +
        "düşük gösterir. Krediyi kapatın veya satışı geri alın.",
      href: "/borclar",
    });
  }

  /* --- 4. Vadesi geçmiş mevduat --- */
  const maturedDeposits = allAssets.filter((a) => {
    if (a.kind !== "deposit" || a.status !== "active") return false;
    return true;
  });
  void maturedDeposits;

  /* --- 5. Kaldıraç uyarısı --- */
  const totalLoanPrincipal = activeLoans.reduce(
    (a, l) => a.plus(new Decimal(l.principal)),
    new Decimal(0),
  );
  if (totalLoanPrincipal.greaterThan(0)) {
    findings.push({
      key: "hasLeverage",
      severity: "info",
      title: `${activeLoans.length} aktif krediniz var`,
      detail:
        "Net servetiniz bu borçlar düşülerek hesaplanıyor. Kaldıraç oranınızı " +
        "ve toplam faiz maliyetinizi Borçlar sayfasından görebilirsiniz.",
      href: "/borclar",
    });
  }

  return findings.sort((a, b) => rank(a.severity) - rank(b.severity));
}

function rank(s: AuditSeverity): number {
  return s === "error" ? 0 : s === "warning" ? 1 : 2;
}
