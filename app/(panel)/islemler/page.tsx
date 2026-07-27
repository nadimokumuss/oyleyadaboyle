import Link from "next/link";
import Decimal from "decimal.js";
import { PageShell, EmptyState, Card, ScrollTable } from "@/components/PageShell";
import { db } from "@/db/client";
import { transactions, assets } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Money, formatMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import { UndoTransaction, UndoSale } from "@/components/UndoTransaction";

export const dynamic = "force-dynamic";

const TX_LABEL: Record<string, string> = {
  buy: "Alım", sell: "Satım", dividend: "Temettü", interest: "Faiz",
  rent: "Kira", staking: "Staking", expense: "Gider", fee: "Komisyon",
  tax: "Vergi", deposit_in: "Para girişi", withdraw: "Para çıkışı",
  capital_call: "Sermaye çağrısı", distribution: "Dağıtım", valuation: "Değerleme",
};

/** Nakde giren mi çıkan mı — renk ve işaret için. */
const INFLOW = new Set(["deposit_in", "sell", "dividend", "interest", "rent", "staking", "distribution"]);

export default async function IslemlerPage({
  searchParams,
}: {
  searchParams: Promise<{ asset?: string; type?: string }>;
}) {
  const params = await searchParams;

  const rows = db
    .select({ tx: transactions, asset: assets })
    .from(transactions)
    .innerJoin(assets, eq(transactions.assetId, assets.id))
    .all()
    .filter((r) => !params.asset || r.tx.assetId === params.asset)
    .filter((r) => !params.type || r.tx.type === params.type)
    .sort((a, b) => {
      const d = b.tx.date.localeCompare(a.tx.date);
      return d !== 0 ? d : b.tx.createdAt.localeCompare(a.tx.createdAt);
    });

  const allAssets = db.select().from(assets).all();
  const soldAssets = allAssets.filter(
    (a) => a.status === "sold" || a.status === "closed",
  );

  if (rows.length === 0) {
    return (
      <PageShell title="İşlemler" subtitle="Tüm para hareketleri tek yerde.">
        <EmptyState
          title="Henüz işlem yok"
          description="Varlık ekledikçe alım, satım, faiz ve gider kayıtları burada birikir. Her kaydı buradan geri alabilirsiniz."
          action={
            <Link
              href="/ekle"
              className="inline-flex items-center rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-surface transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Varlık ekle
            </Link>
          }
        />
      </PageShell>
    );
  }

  return (
    <PageShell
      title="İşlemler"
      subtitle="Her kayıt geri alınabilir. Yanlış girdiğiniz bir işlemi silmek, etkilerini de geri alır."
    >
      {/* Satılan varlıkları geri alma */}
      {soldAssets.length > 0 && (
        <Card
          title="Satılan / kapatılan varlıklar"
          hint="satışı geri alabilirsiniz"
          className="mb-4"
        >
          <ul className="space-y-2">
            {soldAssets.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">{a.name}</span>
                  <span className="block text-xs text-ink-faint">
                    {a.status === "sold" ? "Satıldı" : "Kapatıldı"} ·{" "}
                    {new Date(a.updatedAt).toLocaleDateString("tr-TR")}
                  </span>
                </span>
                <UndoSale assetId={a.id} name={a.name} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Filtreler */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link
          href="/islemler"
          className={cn(
            "rounded-md border px-2.5 py-1 text-xs transition-colors",
            !params.asset && !params.type
              ? "border-accent/50 bg-accent/10 text-ink"
              : "border-line text-ink-muted hover:bg-surface-hover",
          )}
        >
          Tümü ({rows.length})
        </Link>
        {["buy", "sell", "withdraw", "deposit_in"].map((t) => (
          <Link
            key={t}
            href={`/islemler?type=${t}`}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs transition-colors",
              params.type === t
                ? "border-accent/50 bg-accent/10 text-ink"
                : "border-line text-ink-muted hover:bg-surface-hover",
            )}
          >
            {TX_LABEL[t]}
          </Link>
        ))}
      </div>

      <ScrollTable label="İşlem geçmişi tablosu" className="rounded-lg border border-line bg-surface-raised">
        <table className="w-full min-w-[52rem] text-sm">
          <caption className="sr-only">İşlem geçmişi</caption>
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-faint">
              <th scope="col" className="px-4 py-2.5 font-medium">Tarih</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Varlık</th>
              <th scope="col" className="px-4 py-2.5 font-medium">İşlem</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Miktar</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Tutar</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium"> </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ tx, asset }) => {
              const inflow = INFLOW.has(tx.type);
              const amount = Money.of(tx.amount, tx.currency);
              const isFunding = tx.note?.startsWith("FUNDING:");
              const isSale = tx.note?.startsWith("SALE:");

              return (
                <tr key={tx.id} className="border-b border-line/50 last:border-0">
                  <td className="num px-4 py-2.5 text-ink-muted">
                    {new Date(tx.date).toLocaleDateString("tr-TR")}
                  </td>

                  <td className="px-4 py-2.5">
                    <span className="block truncate text-ink">{asset.name}</span>
                    {(isFunding || isSale) && (
                      <span className="block text-xs text-ink-faint">
                        {isFunding ? "varlık alımı için" : "varlık satışından"}
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-2.5 text-ink-muted">
                    {TX_LABEL[tx.type] ?? tx.type}
                  </td>

                  <td className="num px-4 py-2.5 text-right text-ink-muted">
                    {tx.quantity ?? "—"}
                  </td>

                  <td
                    className={cn(
                      "num px-4 py-2.5 text-right font-medium",
                      inflow ? "text-gain" : "text-loss",
                    )}
                  >
                    {inflow ? "+" : "−"}
                    {formatMoney(amount).replace("+", "")}
                    {tx.fee && Number(tx.fee) > 0 && (
                      <span className="block text-xs font-normal text-ink-faint">
                        komisyon {formatMoney(Money.of(tx.fee, tx.currency), { compact: true })}
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-2.5 text-right">
                    <UndoTransaction
                      id={tx.id}
                      label={`${new Date(tx.date).toLocaleDateString("tr-TR")} · ${TX_LABEL[tx.type] ?? tx.type} · ${formatMoney(amount, { compact: true })}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollTable>

      <Summary rows={rows.map((r) => r.tx)} />

      <p className="mt-6 text-pretty text-xs text-ink-faint">
        Bir işlemi silmek onun tüm etkilerini geri alır: alım kaydını silerseniz
        pozisyon küçülür, para çıkışını silerseniz nakit geri gelir. Bağlı
        kayıtlar (bir alımın ödeme hareketi gibi) ayrı satırlardır ve ayrı
        silinir — varlığın tamamını kaldırmak istiyorsanız varlık sayfasından
        silin.
      </p>
    </PageShell>
  );
}

/** Dönem toplamları — nakit giriş/çıkış dengesi. */
function Summary({ rows }: { rows: Array<typeof transactions.$inferSelect> }) {
  let inflow = new Decimal(0);
  let outflow = new Decimal(0);

  for (const t of rows) {
    // Yalnızca USD kayıtları toplanır; karışık para birimlerini burada
    // çevirmek yanıltıcı olur (tarihsel kur gerekir)
    if (t.currency !== "USD") continue;
    const amount = new Decimal(t.amount || 0);
    if (INFLOW.has(t.type)) inflow = inflow.plus(amount);
    else outflow = outflow.plus(amount);
  }

  if (inflow.isZero() && outflow.isZero()) return null;

  return (
    <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 rounded-lg border border-line bg-surface-raised px-4 py-3 text-sm">
      <div>
        <dt className="text-xs text-ink-faint">Toplam giriş (USD kayıtlar)</dt>
        <dd className="num mt-0.5 font-medium text-gain">
          {formatMoney(Money.of(inflow.toFixed(), "USD"))}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-ink-faint">Toplam çıkış</dt>
        <dd className="num mt-0.5 font-medium text-loss">
          {formatMoney(Money.of(outflow.toFixed(), "USD"))}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-ink-faint">Net</dt>
        <dd
          className={cn(
            "num mt-0.5 font-medium",
            inflow.gte(outflow) ? "text-ink" : "text-loss",
          )}
        >
          {formatMoney(Money.of(inflow.minus(outflow).toFixed(), "USD"), { signed: true })}
        </dd>
      </div>
    </dl>
  );
}
