import Link from "next/link";
import Decimal from "decimal.js";
import { PageShell, EmptyState, ScrollTable } from "@/components/PageShell";
import { loadCollectibles } from "@/lib/finance/otherAssetService";
import { CATEGORY_LABEL } from "@/lib/finance/collectible";
import { Money, formatMoney, formatPercent } from "@/lib/money";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

export default function KiymetliEsyaPage() {
  const items = loadCollectibles();

  if (items.length === 0) {
    return (
      <PageShell title="Kıymetli eşya" subtitle="Sanat, saat, mücevher ve koleksiyon.">
        <EmptyState
          title="Henüz kıymetli eşya yok"
          description="Eklediğinizde değer değişimi, taşıma maliyeti ve net sonuç burada takip edilir. Canlı fiyat kaynağı olmadığı için değeri siz girersiniz."
          action={
            <Link
              href="/ekle/kiymetli-esya"
              className="inline-flex items-center rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-surface transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Kıymetli eşya ekle
            </Link>
          }
        />
      </PageShell>
    );
  }

  const stale = items.filter((i) => i.appraisalStale);

  return (
    <PageShell
      title="Kıymetli eşya"
      subtitle="Değer değişimi, taşıma maliyeti ve net sonuç."
      actions={
        <Link
          href="/ekle/kiymetli-esya"
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-surface transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          + Eşya ekle
        </Link>
      }
    >
      {stale.length > 0 && (
        <div className="mb-4 rounded-md border border-warn/40 bg-warn/10 px-3 py-2.5">
          <p className="text-pretty text-xs text-ink-muted">
            <strong className="text-warn">
              {stale.length} parçanın ekspertizi iki yıldan eski.
            </strong>{" "}
            Kıymetli eşyada değer sadece sizin girdiğiniz rakamdır; eskidikçe
            servetiniz gerçeğinden uzaklaşır.
          </p>
        </div>
      )}

      <ScrollTable
        label="Kıymetli eşya tablosu"
        className="rounded-lg border border-line bg-surface-raised"
      >
        <table className="w-full min-w-[56rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-faint">
              <th className="px-4 py-2.5 font-medium">Parça</th>
              <th className="px-4 py-2.5 font-medium">Kaynak</th>
              <th className="px-4 py-2.5 text-right font-medium">Alış</th>
              <th className="px-4 py-2.5 text-right font-medium">Güncel</th>
              <th className="px-4 py-2.5 text-right font-medium">Değer artışı</th>
              <th className="px-4 py-2.5 text-right font-medium">Taşıma maliyeti</th>
              <th className="px-4 py-2.5 text-right font-medium">Net sonuç</th>
              <th className="px-4 py-2.5 text-right font-medium">Yıllık</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => {
              const gross = new Decimal(i.unrealizedPnl);
              const net = new Decimal(i.netResult);
              return (
                <tr key={i.assetId} className="border-b border-line/50 last:border-0">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/ekle/kiymetli-esya?id=${i.assetId}`}
                      className="block truncate font-medium text-ink hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      {i.name}
                    </Link>
                    <span className="block truncate text-xs text-ink-faint">
                      {CATEGORY_LABEL[i.category] ?? i.category}
                      {i.maker ? ` · ${i.maker}` : ""}
                      {i.year ? ` · ${i.year}` : ""} · {i.holdingYears} yıl
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={cn(
                        "inline-flex rounded border px-1.5 py-0.5 text-[11px]",
                        i.basis === "appraisal"
                          ? i.appraisalStale
                            ? "border-warn/50 text-warn"
                            : "border-line text-ink-muted"
                          : "border-line text-ink-faint",
                      )}
                    >
                      {i.basis === "appraisal"
                        ? `ekspertiz${
                            i.appraisalAgeDays !== null ? ` · ${i.appraisalAgeDays}g` : ""
                          }`
                        : "defter"}
                    </span>
                  </td>
                  <td className="num px-4 py-2.5 text-right text-ink-muted">
                    {formatMoney(Money.of(i.purchasePrice, i.currency), { compact: true })}
                  </td>
                  <td className="num px-4 py-2.5 text-right font-medium text-ink">
                    {formatMoney(Money.of(i.currentValue, i.currency), { compact: true })}
                  </td>
                  <td
                    className={cn(
                      "num px-4 py-2.5 text-right",
                      gross.isNegative() ? "text-loss" : "text-gain",
                    )}
                  >
                    {formatMoney(Money.of(i.unrealizedPnl, i.currency), {
                      compact: true,
                      signed: true,
                    })}
                  </td>
                  <td className="num px-4 py-2.5 text-right text-loss">
                    {Number(i.cumulativeCosts) > 0
                      ? `−${formatMoney(Money.of(i.cumulativeCosts, i.currency), {
                          compact: true,
                        })}`
                      : "—"}
                  </td>
                  <td
                    className={cn(
                      "num px-4 py-2.5 text-right font-medium",
                      net.isNegative() ? "text-loss" : "text-gain",
                    )}
                  >
                    {formatMoney(Money.of(i.netResult, i.currency), {
                      compact: true,
                      signed: true,
                    })}
                  </td>
                  <td className="num px-4 py-2.5 text-right text-ink-muted">
                    {i.annualizedReturn
                      ? formatPercent(new Decimal(i.annualizedReturn), {
                          signed: true,
                          decimals: 1,
                        })
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollTable>

      <p className="mt-4 text-pretty text-xs text-ink-faint">
        Kıymetli eşya için canlı fiyat kaynağı <strong>yoktur</strong> ve
        modellenmez — gayrimenkulde konut endeksi, araçta amortisman eğrisi
        kullanmak savunulabilir ama bir tablonun değeri endeksten türetilemez.
        Bu yüzden burada &ldquo;model&rdquo; rozeti hiç görünmez: değer ya alış
        fiyatıdır ya da sizin girdiğiniz ekspertiz.
      </p>

      <p className="mt-2 text-pretty text-xs text-ink-faint">
        <strong className="text-ink-muted">Net sonuç</strong> sütunu sigorta,
        saklama ve bakım masrafını düşer. Değeri artan bir parçanın net
        sonucunun negatif çıkması mümkündür ve bunu görmek önemlidir.
      </p>
    </PageShell>
  );
}
