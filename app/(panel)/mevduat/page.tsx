import { PageShell, EmptyState, Card } from "@/components/PageShell";
import { AccrualTicker } from "@/components/AccrualTicker";
import { loadDeposits } from "@/lib/finance/depositService";
import { Money, formatMoney } from "@/lib/money";
import { listCashAccounts } from "@/lib/services/funding";
import { DisposeButton } from "@/components/DisposeButton";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function MevduatPage() {
  const deposits = loadDeposits();
  const cashAccounts = listCashAccounts();

  if (deposits.length === 0) {
    return (
      <PageShell title="Mevduat" subtitle="Faiz motoru: canlı tahakkuk, stopaj ve reel getiri.">
        <EmptyState
          title="Kayıtlı mevduat yok"
          description="Demo senaryoyu yükleyerek örnek mevduat hesaplarını görebilirsiniz."
          action={
            <code className="inline-block rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink-muted">
              npm run db:seed
            </code>
          }
        />
      </PageShell>
    );
  }

  // Vadesi yaklaşanlar önce
  const sorted = [...deposits].sort((a, b) => {
    const ad = a.snapshot.daysToMaturity ?? Infinity;
    const bd = b.snapshot.daysToMaturity ?? Infinity;
    return ad - bd;
  });

  const upcoming = sorted.filter(
    (d) => d.snapshot.daysToMaturity !== null && d.snapshot.daysToMaturity <= 30,
  );

  return (
    <PageShell
      title="Mevduat"
      subtitle="Kazanç saniye saniye hesaplanır — sayfa kapalıyken de doğru kalır."
    >
      {upcoming.length > 0 && (
        <Card title="Vade takvimi" hint="30 gün içinde" className="mb-4">
          <ul className="space-y-1.5">
            {upcoming.map((d) => (
              <li key={d.assetId} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate text-ink-muted">{d.name}</span>
                <span className="num shrink-0 text-warn">
                  {d.snapshot.daysToMaturity} gün ·{" "}
                  {formatMoney(Money.of(d.snapshot.netBalance, d.currency), { compact: true })}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {sorted.map((d) => (
          <div key={d.assetId} className="space-y-2">
            <AccrualTicker deposit={d} />
            <div className="flex flex-wrap items-center gap-2">
              <DisposeButton
                kind="deposit"
                assetId={d.assetId}
                name={d.name}
                currency={d.currency}
                cashAccounts={cashAccounts}
                currentValue={d.snapshot.netBalance}
                cost={d.params.principal}
              />
              <Link
                href={`/ekle/mevduat?id=${d.assetId}`}
                className="rounded-md px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Düzenle
              </Link>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-6 text-pretty text-xs text-ink-faint">
        Stopaj oranları veritabanındaki tablodan gelir ve mevzuat değiştiğinde
        güncellenebilir. Enflasyon varsayımı reel getiri hesabında kullanılır;
        gerçek TÜFE farklıysa sonuç da farklı olur.
      </p>
    </PageShell>
  );
}
