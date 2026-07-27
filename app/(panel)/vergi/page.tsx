import Link from "next/link";
import Decimal from "decimal.js";
import { PageShell, Card, EmptyState, ScrollTable } from "@/components/PageShell";
import { loadTaxReport } from "@/lib/finance/taxService";
import { ensureSettingsRow } from "@/lib/auth";
import { Money, formatMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import type { LotMethod } from "@/lib/finance/realized";

export const dynamic = "force-dynamic";

const METHOD_LABEL: Record<LotMethod, string> = {
  fifo: "FIFO — en eski lot önce",
  lifo: "LIFO — en yeni lot önce",
  hifo: "HIFO — en pahalı lot önce",
};

export default async function VergiPage() {
  const cfg = ensureSettingsRow();
  const report = await loadTaxReport({
    method: cfg.lotMethod as LotMethod,
    longTermDays: cfg.longTermDays,
  });

  const hasAnything = report.years.some(
    (y) => y.lines.length > 0 || Number(y.depositWithholdingUsd) > 0,
  );

  return (
    <PageShell
      title="Vergi"
      subtitle="Takvim yılı bazında gerçekleşen kâr/zarar ve kesilen stopaj."
    >
      <div className="mb-4 rounded-md border border-warn/40 bg-warn/10 px-3 py-2.5">
        <p className="text-pretty text-xs text-ink-muted">
          <strong className="text-warn">Bu bir vergi hesaplama aracı değildir.</strong>{" "}
          Mevzuat ülkeye göre değişir; istisnalar, endeksleme ve indirimler burada
          modellenmez. Rakamlar beyanınız için başlangıç noktasıdır — sonuç değil.
          Mali müşavirinize danışın.
        </p>
      </div>

      {!hasAnything ? (
        <EmptyState
          title="Henüz vergi doğuran bir olay yok"
          description="Bir pozisyonu sattığınızda gerçekleşen kâr veya zarar burada takvim yılına göre listelenir. Mevduat stopajı da vade yılına yazılır."
          action={
            <Link
              href="/portfoy"
              className="inline-flex items-center rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink hover:bg-surface-hover"
            >
              Portföye git
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {report.years.map((y) => {
            const gain = new Decimal(y.totals.gainUsd);
            return (
              <Card
                key={y.year}
                title={String(y.year)}
                hint={`${y.lines.length} satış`}
              >
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Stat
                    label="Net gerçekleşen K/Z"
                    value={formatMoney(Money.of(y.totals.gainUsd, "USD"), { signed: true })}
                    tone={gain.isNegative() ? "loss" : "gain"}
                  />
                  <Stat
                    label="Kısa vade"
                    value={formatMoney(Money.of(y.totals.shortTermUsd, "USD"), {
                      signed: true,
                      compact: true,
                    })}
                    sub={`< ${report.longTermDays} gün`}
                  />
                  <Stat
                    label="Uzun vade"
                    value={formatMoney(Money.of(y.totals.longTermUsd, "USD"), {
                      signed: true,
                      compact: true,
                    })}
                    sub={`≥ ${report.longTermDays} gün`}
                  />
                  <Stat
                    label="Mevduat stopajı"
                    value={formatMoney(Money.of(y.depositWithholdingUsd, "USD"), {
                      compact: true,
                    })}
                    sub="tahakkuk üzerinden"
                  />
                </div>

                {Number(y.totals.lossesOnlyUsd) < 0 && (
                  <p className="mt-3 text-pretty text-xs text-ink-muted">
                    Kârlı satışlar{" "}
                    <span className="num text-gain">
                      {formatMoney(Money.of(y.totals.gainsOnlyUsd, "USD"), { compact: true })}
                    </span>
                    , zararlı satışlar{" "}
                    <span className="num text-loss">
                      {formatMoney(Money.of(y.totals.lossesOnlyUsd, "USD"), { compact: true })}
                    </span>
                    . Çoğu ülkede zararlar aynı yılın kârlarından mahsup edilebilir.
                  </p>
                )}

                {y.lines.length > 0 && (
                  <ScrollTable label={`${y.year} yılı satış tablosu`} className="mt-3">
                    <table className="w-full min-w-[52rem] text-sm">
                      <thead>
                        <tr className="border-b border-line text-left text-xs text-ink-faint">
                          <th className="py-2 pr-4 font-medium">Tarih</th>
                          <th className="py-2 pr-4 font-medium">Varlık</th>
                          <th className="py-2 pr-4 text-right font-medium">Miktar</th>
                          <th className="py-2 pr-4 text-right font-medium">Hasılat</th>
                          <th className="py-2 pr-4 text-right font-medium">Maliyet</th>
                          <th className="py-2 pr-4 text-right font-medium">K/Z</th>
                          <th className="py-2 text-right font-medium">Tutma</th>
                        </tr>
                      </thead>
                      <tbody>
                        {y.lines.map((l, i) => {
                          const g = new Decimal(l.gain);
                          return (
                            <tr
                              key={`${l.assetId}-${l.date}-${i}`}
                              className="border-b border-line/50 last:border-0"
                            >
                              <td className="num py-2 pr-4 text-ink-muted">{l.date}</td>
                              <td className="py-2 pr-4 text-ink">
                                {l.symbol ?? l.assetName}
                              </td>
                              <td className="num py-2 pr-4 text-right text-ink-muted">
                                {l.quantity}
                              </td>
                              <td className="num py-2 pr-4 text-right text-ink">
                                {formatMoney(Money.of(l.proceeds, l.currency), {
                                  compact: true,
                                })}
                              </td>
                              <td className="num py-2 pr-4 text-right text-ink-muted">
                                {formatMoney(Money.of(l.costBasis, l.currency), {
                                  compact: true,
                                })}
                              </td>
                              <td
                                className={cn(
                                  "num py-2 pr-4 text-right",
                                  g.isNegative() ? "text-loss" : "text-gain",
                                )}
                              >
                                {formatMoney(Money.of(l.gain, l.currency), {
                                  signed: true,
                                  compact: true,
                                })}
                              </td>
                              <td className="num py-2 text-right text-ink-faint">
                                {l.maxHoldingDays} gün
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </ScrollTable>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Card title="Yöntem" className="mt-4">
        <p className="text-pretty text-sm text-ink-muted">
          Lot seçimi:{" "}
          <strong className="text-ink">{METHOD_LABEL[report.method]}</strong>. Uzun
          vade eşiği <strong className="text-ink">{report.longTermDays} gün</strong>.
          İkisi de{" "}
          <Link href="/ayarlar" className="text-accent underline">
            Ayarlar
          </Link>{" "}
          sayfasından değiştirilebilir — seçim gerçekleşen kârı doğrudan değiştirir.
        </p>

        {report.unconvertedCurrencies.length > 0 && (
          <p className="mt-2 text-pretty text-xs text-warn">
            Şu para birimleri için kur bulunamadı ve USD toplamlarına
            katılmadılar: {report.unconvertedCurrencies.join(", ")}. Satır
            bazındaki yerel tutarlar doğrudur.
          </p>
        )}

        <p className="mt-2 text-pretty text-xs text-ink-faint">
          USD karşılıkları bugünkü kurla hesaplanır, işlem tarihindeki kurla
          değil. Beyan yerel para biriminde yapılıyorsa satır bazındaki tutarları
          kullanın.
        </p>

        <div className="mt-3">
          <a
            href="/api/export?type=tax"
            className="inline-flex items-center rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            CSV indir
          </a>
        </div>
      </Card>
    </PageShell>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "gain" | "loss";
}) {
  return (
    <div className="rounded-md border border-line p-3">
      <p className="truncate text-xs text-ink-faint">{label}</p>
      <p
        className={cn(
          "num mt-1 text-lg font-semibold",
          tone === "gain" && "text-gain",
          tone === "loss" && "text-loss",
          !tone && "text-ink",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 truncate text-xs text-ink-faint">{sub}</p>}
    </div>
  );
}
