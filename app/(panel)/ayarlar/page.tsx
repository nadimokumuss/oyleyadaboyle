import { PageShell, Card, ScrollTable } from "@/components/PageShell";
import { db } from "@/db/client";
import { targets, withholdingRates } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureSettingsRow, getAuthState, remainingRecoveryCodes } from "@/lib/auth";
import { recentAttempts, isPublicDeployment } from "@/lib/security";
import { TotpForm } from "@/components/forms/TotpForm";
import { SecurityForm } from "@/components/forms/SecurityForm";
import { SettingsForm } from "@/components/forms/SettingsForm";
import { AssumptionsForm } from "@/components/forms/AssumptionsForm";
import { NotifyForm } from "@/components/forms/NotifyForm";
import { loadAssumptions } from "@/lib/assumptions";
import { TargetsForm } from "@/components/forms/TargetsForm";
import { PinForm } from "@/components/forms/PinForm";
import { DangerZone } from "@/components/forms/DangerZone";

export const dynamic = "force-dynamic";

export default function AyarlarPage() {
  const cfg = ensureSettingsRow();
  const targetRows = db
    .select()
    .from(targets)
    .where(eq(targets.dimension, "kind"))
    .all();
  const whRows = db.select().from(withholdingRates).all();
  const assumptions = loadAssumptions();
  const auth = getAuthState();
  const attempts = recentAttempts(10);

  const targetMap = Object.fromEntries(targetRows.map((t) => [t.key, t.targetPct]));
  const tolerance = targetRows[0]?.tolerancePct ?? "0.05";

  return (
    <PageShell title="Ayarlar" subtitle="Tercihler, hedefler ve veri yönetimi.">
      <div className="space-y-4">
        <Card title="Genel">
          <SettingsForm
            defaults={{
              baseCurrency: cfg.baseCurrency,
              monthlyLivingCost: cfg.monthlyLivingCost ?? "0",
              livingCostCurrency: cfg.livingCostCurrency ?? "USD",
              riskProfile: cfg.riskProfile,
              horizonYears: cfg.horizonYears ?? 20,
              idleCashThreshold: cfg.idleCashThreshold ?? "50000",
              concentrationThreshold: cfg.concentrationThreshold ?? "0.25",
              lotMethod: cfg.lotMethod,
              longTermDays: cfg.longTermDays,
            }}
          />
        </Card>

        <Card
          title="Varsayımlar"
          hint="Reel getiriyi üreten sayılar"
        >
          <AssumptionsForm
            inflation={assumptions.inflation}
            benchmarks={Object.fromEntries(
              assumptions.benchmarks.map((b) => [b.key, b.annualReturn]),
            )}
            capitalGainsRate={assumptions.capitalGainsRate}
          />
        </Card>

        <Card
          title="Hedef dağılım"
          hint="Fırsat motorunun yeniden dengeleme kuralı bunu takip eder"
        >
          <TargetsForm defaults={targetMap} tolerance={tolerance} />
        </Card>

        <Card title="Stopaj oranları" hint="Mevzuat değiştiğinde güncelleyin">
          <ScrollTable label="Stopaj oranları tablosu">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-faint">
                  <th className="py-2 pr-4 font-medium">Para birimi</th>
                  <th className="py-2 pr-4 font-medium">Vade üst sınırı</th>
                  <th className="py-2 pr-4 font-medium">Açıklama</th>
                  <th className="py-2 text-right font-medium">Oran</th>
                </tr>
              </thead>
              <tbody>
                {whRows.map((r) => (
                  <tr key={r.id} className="border-b border-line/50 last:border-0">
                    <td className="py-2 pr-4 text-ink">{r.currency}</td>
                    <td className="num py-2 pr-4 text-ink-muted">
                      {r.maxTermDays ? `${r.maxTermDays} gün` : "sınırsız"}
                    </td>
                    <td className="py-2 pr-4 text-pretty text-xs text-ink-faint">
                      {r.note}
                    </td>
                    <td className="num py-2 text-right text-ink">
                      %{(Number(r.rate) * 100).toFixed(0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
          <p className="mt-3 text-pretty text-xs text-ink-faint">
            Bu oranlar temsilîdir. Kendi mevduatınızın gerçek stopaj oranını
            bankanızdan teyit edin; mevduat eklerken tek tek de belirtebilirsiniz.
          </p>
        </Card>

        <Card
          title="Bildirimler ve otomasyon"
          hint="panel kapalıyken çalışan kısım"
        >
          <NotifyForm
            webhookUrl={cfg.webhookUrl ?? ""}
            schedulerEnabled={cfg.schedulerEnabled}
          />
        </Card>

        <Card title="Kilit">
          <PinForm />
        </Card>

        <Card
          title="İki faktörlü doğrulama"
          hint={auth.totpEnabled ? "açık" : "kapalı"}
        >
          <TotpForm
            enabled={auth.totpEnabled}
            remainingCodes={remainingRecoveryCodes()}
          />
        </Card>

        <Card title="Erişim kısıtlama">
          <SecurityForm
            allowedIps={cfg.allowedIps ?? ""}
            isPublic={isPublicDeployment}
          />
        </Card>

        <Card title="Giriş kayıtları" hint="son 10 deneme">
          {attempts.length === 0 ? (
            <p className="text-sm text-ink-faint">Henüz kayıt yok.</p>
          ) : (
            <ul className="space-y-1.5">
              {attempts.map((a) => (
                <li
                  key={a.id}
                  className="num flex flex-wrap items-baseline justify-between gap-3 text-xs"
                >
                  <span className={a.success ? "text-gain" : "text-loss"}>
                    {a.success ? "Başarılı giriş" : `Başarısız — ${a.reason ?? "?"}`}
                  </span>
                  <span className="text-ink-faint">
                    {a.ip ?? "yerel"} · {new Date(a.at).toLocaleString("tr-TR")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Veri">
          <DangerZone />
        </Card>
      </div>
    </PageShell>
  );
}
