import Link from "next/link";
import { PageShell, EmptyState } from "@/components/PageShell";
import { DashboardLive } from "@/components/DashboardLive";
import { WealthCurve } from "@/components/WealthCurve";
import { db } from "@/db/client";
import { assets } from "@/db/schema";
import { loadSnapshots } from "@/lib/snapshot";
import { runAudit } from "@/lib/services/audit";
import { AuditBanner } from "@/components/AuditBanner";
import { BenchmarkCurve } from "@/components/BenchmarkCurve";
import { loadBenchmark } from "@/lib/finance/benchmarkService";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const assetCount = db.select({ id: assets.id }).from(assets).all().length;
  const history = loadSnapshots();
  const findings = runAudit();
  // Yeterli geçmiş veya endeks verisi yoksa null döner ve grafik hiç çizilmez.
  const benchmark = assetCount > 0 ? await loadBenchmark("sp500") : null;

  return (
    <PageShell
      title="Komuta Ekranı"
      subtitle="Tüm varlıklar tek ekranda, canlı fiyatlarla."
      actions={
        assetCount > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/ekle"
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-surface transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              + Varlık ekle
            </Link>
            {[
              { type: "positions", label: "Varlıklar" },
              { type: "transactions", label: "İşlemler" },
              { type: "snapshots", label: "Geçmiş" },
            ].map((x) => (
              <a
                key={x.type}
                href={`/api/export?type=${x.type}`}
                className="rounded-md border border-line bg-surface-raised px-2.5 py-1.5 text-xs text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {x.label} CSV
              </a>
            ))}
          </div>
        ) : undefined
      }
    >
      {assetCount === 0 ? (
        <EmptyState
          title="Servetinizi kurmaya başlayın"
          description="İlk adım genelde elinizdeki nakdi girmek. Sonra hisse, mevduat, ev ve araba ekleyerek tabloyu tamamlarsınız."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Link
                href="/ekle/nakit"
                className="inline-flex items-center rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-surface transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Nakit ekle
              </Link>
              <Link
                href="/ekle"
                className="inline-flex items-center rounded-md border border-line bg-surface px-3.5 py-2 text-sm text-ink transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Diğer varlık türleri
              </Link>
            </div>
          }
        />
      ) : (
        <div className="space-y-4">
          <AuditBanner findings={findings} />
          <DashboardLive />
          <WealthCurve points={history} />
          {benchmark && (
            <BenchmarkCurve
              comparison={benchmark.comparison}
              benchmarkLabel={benchmark.label}
            />
          )}
        </div>
      )}
    </PageShell>
  );
}
