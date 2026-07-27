"use client";

import { useActionState, useState } from "react";
import Decimal from "decimal.js";
import { savePensionAction, type FormState } from "@/app/actions/assets";
import { FormShell } from "@/components/form/FormShell";
import {
  Field,
  TextInput,
  MoneyInput,
  DateInput,
  CurrencySelect,
} from "@/components/form/Field";
import { Money, formatMoney, formatPercent } from "@/lib/money";
import { DEFAULT_VESTING_TIERS } from "@/lib/finance/pension";

const initial: FormState = {};

export interface PensionDefaults {
  id?: string;
  name?: string;
  provider?: string;
  currency?: string;
  country?: string;
  startDate?: string;
  participantBalance?: string;
  stateContribution?: string;
  monthlyContribution?: string;
  retirementDate?: string;
  note?: string;
}

const today = () => new Date().toISOString().slice(0, 10);

export function PensionForm({ defaults = {} }: { defaults?: PensionDefaults }) {
  const [state, action] = useActionState(savePensionAction, initial);
  const err = state.fieldErrors ?? {};

  const [currency, setCurrency] = useState(defaults.currency ?? "TRY");
  const [startDate, setStartDate] = useState(defaults.startDate ?? today());
  const [participant, setParticipant] = useState(defaults.participantBalance ?? "");
  const [stateAmount, setStateAmount] = useState(defaults.stateContribution ?? "");

  // Hak ediş önizlemesi: girilen tarihe göre bugün ne kadarı sizin.
  const preview = (() => {
    if (!startDate) return null;
    const years =
      (Date.now() - new Date(startDate).getTime()) / (365.25 * 86_400_000);
    if (years < 0) return null;

    let ratio = 0;
    for (const tier of DEFAULT_VESTING_TIERS) {
      if (years >= tier.years) ratio = Math.max(ratio, Number(tier.pct));
    }

    const stateNum = Number(stateAmount);
    const vested = Number.isFinite(stateNum) ? stateNum * ratio : 0;
    const unvested = Number.isFinite(stateNum) ? stateNum - vested : 0;

    const next = DEFAULT_VESTING_TIERS.filter((t) => years < t.years).sort(
      (a, b) => a.years - b.years,
    )[0];

    return { years, ratio, vested, unvested, next };
  })();

  return (
    <form action={action}>
      {defaults.id && <input type="hidden" name="id" value={defaults.id} />}

      <FormShell
        title={defaults.id ? "Emeklilik hesabını düzenle" : "Emeklilik hesabı ekle"}
        description="BES veya benzeri emeklilik planı."
        error={state.error}
        editingId={defaults.id}
        deleteRedirect="/emeklilik"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ad" htmlFor="name" error={err.name}>
            <TextInput
              id="name"
              name="name"
              placeholder="BES — Agresif fon"
              defaultValue={defaults.name}
              error={err.name}
              required
            />
          </Field>

          <Field label="Kurum" htmlFor="provider" error={err.provider}>
            <TextInput
              id="provider"
              name="provider"
              placeholder="Anadolu Hayat"
              defaultValue={defaults.provider}
              error={err.provider}
              required
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Sisteme giriş"
            htmlFor="startDate"
            error={err.startDate}
            hint="Hak ediş bu tarihten sayılır"
          >
            <DateInput
              id="startDate"
              name="startDate"
              defaultValue={defaults.startDate ?? today()}
              error={err.startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
          </Field>

          <Field label="Para birimi" htmlFor="currency">
            <CurrencySelect
              id="currency"
              name="currency"
              defaultValue={currency}
              onChange={(e) => setCurrency(e.target.value)}
            />
          </Field>

          <Field label="Ülke" htmlFor="country" error={err.country}>
            <TextInput
              id="country"
              name="country"
              placeholder="TR"
              defaultValue={defaults.country ?? "TR"}
              error={err.country}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Kendi birikiminiz"
            htmlFor="participantBalance"
            error={err.participantBalance}
            hint="Katkı payı + getirisi"
          >
            <MoneyInput
              id="participantBalance"
              name="participantBalance"
              currency={currency}
              defaultValue={defaults.participantBalance}
              error={err.participantBalance}
              onValueChange={setParticipant}
            />
          </Field>

          <Field
            label="Devlet katkısı"
            htmlFor="stateContribution"
            error={err.stateContribution}
            hint="Hesabınızdaki toplam"
          >
            <MoneyInput
              id="stateContribution"
              name="stateContribution"
              currency={currency}
              defaultValue={defaults.stateContribution}
              error={err.stateContribution}
              onValueChange={setStateAmount}
            />
          </Field>

          <Field
            label="Aylık katkı"
            htmlFor="monthlyContribution"
            error={err.monthlyContribution}
          >
            <MoneyInput
              id="monthlyContribution"
              name="monthlyContribution"
              currency={currency}
              defaultValue={defaults.monthlyContribution}
              error={err.monthlyContribution}
            />
          </Field>
        </div>

        <Field
          label="Emeklilik hakkı tarihi"
          htmlFor="retirementDate"
          error={err.retirementDate}
          hint="Boşsa kademeli hak ediş uygulanır. Bu tarih geldiğinde katkının tamamı sizin olur."
        >
          <DateInput
            id="retirementDate"
            name="retirementDate"
            defaultValue={defaults.retirementDate}
            error={err.retirementDate}
            allowFuture
          />
        </Field>

        {preview && (
          <div className="rounded-md border border-line bg-surface px-3 py-2.5">
            <p className="mb-1.5 text-xs font-medium text-ink-muted">
              Hak ediş durumu
            </p>
            <dl className="num grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-ink-faint">Sistemde</dt>
                <dd className="text-ink">{preview.years.toFixed(1)} yıl</dd>
              </div>
              <div>
                <dt className="text-ink-faint">Hak edilen katkı</dt>
                <dd className="text-gain">
                  {formatMoney(Money.of(String(preview.vested), currency), {
                    compact: true,
                  })}{" "}
                  ({formatPercent(new Decimal(preview.ratio), { decimals: 0 })})
                </dd>
              </div>
              <div>
                <dt className="text-ink-faint">Henüz hak edilmemiş</dt>
                <dd className="text-warn">
                  {formatMoney(Money.of(String(preview.unvested), currency), {
                    compact: true,
                  })}
                </dd>
              </div>
            </dl>
            <p className="mt-1.5 text-pretty text-xs text-ink-faint">
              {preview.next
                ? `${(preview.next.years - preview.years).toFixed(1)} yıl sonra ` +
                  `katkının %${Number(preview.next.pct) * 100}'i hak edilecek. `
                : "Tüm kademeler doldu. "}
              <strong className="text-ink-muted">
                Net servetinize yalnızca hak edilmiş kısım yazılır
              </strong>{" "}
              — sahip olmadığınız parayı servet saymak yanıltıcı olurdu.
            </p>
          </div>
        )}

        <Field label="Not" htmlFor="note" error={err.note}>
          <TextInput id="note" name="note" defaultValue={defaults.note} />
        </Field>

        <p className="text-pretty text-xs text-ink-faint">
          Emeklilik hesabı ödeme kaynağı sormaz: katkı maaştan kesilir veya
          otomatik ödemeyle gider, tek seferlik bir alım değildir. Bakiyeyi
          zaman zaman kurumdan bakıp buradan güncelleyin.
        </p>
      </FormShell>
    </form>
  );
}
