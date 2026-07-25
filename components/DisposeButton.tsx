"use client";

import { useActionState, useState } from "react";
import Decimal from "decimal.js";
import {
  sellPositionAction, sellPhysicalAction, closeDepositAction, exitVentureAction,
  type DisposeState,
} from "@/app/actions/dispose";
import { Button, SubmitButton } from "@/components/form/Button";
import { Field, TextInput, MoneyInput } from "@/components/form/Field";
import { Money, formatMoney, formatPercent } from "@/lib/money";
import { cn } from "@/lib/cn";
import type { CashAccount } from "@/components/form/FundingSource";

const initial: DisposeState = {};

/**
 * Satış / kapatma düğmesi.
 *
 * Kaydetmeden önce ne kazanacağınızı gösterir — satış kararının
 * tamamı bu sayıya bakar. Bağlı kredi varsa ondan da haberdar eder;
 * ev satıp borcun kaldığını sonradan öğrenmek kötü bir sürpriz olur.
 */

export type DisposeKind = "position" | "physical" | "deposit" | "venture";

export function DisposeButton({
  kind,
  assetId,
  name,
  currency,
  cashAccounts,
  /** Pozisyonda: elde kalan miktar. */
  quantity,
  /** Mevcut piyasa/model değeri — satış fiyatı için başlangıç. */
  currentValue,
  /** Maliyet — K/Z önizlemesi için. */
  cost,
  /** Bağlı kredinin kalan bakiyesi. */
  outstandingLoan,
  label,
}: {
  kind: DisposeKind;
  assetId: string;
  name: string;
  currency: string;
  cashAccounts: CashAccount[];
  quantity?: string;
  currentValue?: string;
  cost?: string;
  outstandingLoan?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {label ?? DEFAULT_LABEL[kind]}
      </Button>
    );
  }

  return (
    <DisposeForm
      kind={kind}
      assetId={assetId}
      name={name}
      currency={currency}
      cashAccounts={cashAccounts}
      quantity={quantity}
      currentValue={currentValue}
      cost={cost}
      outstandingLoan={outstandingLoan}
      onClose={() => setOpen(false)}
    />
  );
}

const DEFAULT_LABEL: Record<DisposeKind, string> = {
  position: "Sat",
  physical: "Sat",
  deposit: "Hesabı kapat",
  venture: "Çıkış yap",
};

const ACTIONS = {
  position: sellPositionAction,
  physical: sellPhysicalAction,
  deposit: closeDepositAction,
  venture: exitVentureAction,
};

function DisposeForm({
  kind,
  assetId,
  name,
  currency,
  cashAccounts,
  quantity,
  currentValue,
  cost,
  outstandingLoan,
  onClose,
}: {
  kind: DisposeKind;
  assetId: string;
  name: string;
  currency: string;
  cashAccounts: CashAccount[];
  quantity?: string;
  currentValue?: string;
  cost?: string;
  outstandingLoan?: string;
  onClose: () => void;
}) {
  const [state, action] = useActionState(ACTIONS[kind], initial);

  const [sellQty, setSellQty] = useState(quantity ?? "");
  const [price, setPrice] = useState(
    kind === "position" && currentValue && quantity && Number(quantity) > 0
      ? new Decimal(currentValue).dividedBy(quantity).toFixed()
      : (currentValue ?? ""),
  );
  const [costs, setCosts] = useState("");
  const [proceeds, setProceeds] = useState(currentValue ?? "");

  const preview = buildPreview({
    kind, sellQty, price, costs, proceeds, cost, quantity,
    outstandingLoan, currency,
  });

  if (state.done) {
    return (
      <div className="w-full rounded-md border border-gain/50 bg-gain/10 p-4">
        <p className="text-sm font-medium text-gain">İşlem kaydedildi.</p>
        {state.warnings && state.warnings.length > 0 && (
          <ul className="mt-2 space-y-1">
            {state.warnings.map((w, i) => (
              <li key={i} className="text-pretty text-xs text-ink-muted">
                {w}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <form action={action} className="w-full rounded-md border border-line bg-surface p-4">
      <input type="hidden" name="assetId" value={assetId} />

      <p className="text-pretty text-sm text-ink">
        <strong>{name}</strong> {TITLES[kind]}
      </p>

      {state.error && (
        <p className="mt-2 rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">
          {state.error}
        </p>
      )}

      <div className="mt-3 space-y-3">
        {kind === "position" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Satılacak miktar" htmlFor={`qty-${assetId}`}>
              <TextInput
                id={`qty-${assetId}`}
                name="quantity"
                inputMode="decimal"
                required
                value={sellQty}
                onChange={(e) => setSellQty(e.target.value.replace(",", "."))}
                className="num text-right"
              />
              {quantity && (
                <button
                  type="button"
                  onClick={() => setSellQty(quantity)}
                  className="mt-1 text-xs text-accent hover:underline"
                >
                  Tamamı ({quantity})
                </button>
              )}
            </Field>

            <Field label="Birim satış fiyatı" htmlFor={`price-${assetId}`}>
              <MoneyInput
                id={`price-${assetId}`}
                name="pricePerUnit"
                currency={currency}
                required
                defaultValue={price}
                onValueChange={setPrice}
              />
            </Field>
          </div>
        )}

        {kind === "physical" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Satış fiyatı" htmlFor={`sale-${assetId}`}>
              <MoneyInput
                id={`sale-${assetId}`}
                name="salePrice"
                currency={currency}
                required
                defaultValue={currentValue}
                onValueChange={setPrice}
              />
            </Field>

            <Field
              label="Satış masrafları"
              htmlFor={`costs-${assetId}`}
              hint="Emlakçı komisyonu, tapu harcı vb."
            >
              <MoneyInput
                id={`costs-${assetId}`}
                name="costs"
                currency={currency}
                onValueChange={setCosts}
              />
            </Field>
          </div>
        )}

        {kind === "venture" && (
          <Field
            label="Çıkış tutarı"
            htmlFor={`proceeds-${assetId}`}
            hint="Girişim tamamen değersizleştiyse 0 girin."
          >
            <MoneyInput
              id={`proceeds-${assetId}`}
              name="proceeds"
              currency={currency}
              onValueChange={setProceeds}
            />
          </Field>
        )}

        {kind === "deposit" && (
          <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-pretty text-xs text-warn">
            Vadeden önce kapatırsanız bankalar genelde hiç faiz ödemez.
            Panel varsayılan olarak tüm faizin kaybedildiğini kabul eder;
            bankanız kısmi faiz ödüyorsa aşağıdaki oranı değiştirin.
          </p>
        )}

        {kind === "deposit" && (
          <Field
            label="Kaybedilen faiz oranı"
            htmlFor={`forfeit-${assetId}`}
            hint="1 = tüm faiz kaybedilir, 0 = tamamı ödenir."
          >
            <TextInput
              id={`forfeit-${assetId}`}
              name="interestForfeitRate"
              inputMode="decimal"
              defaultValue="1"
              className="num text-right"
            />
          </Field>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tarih" htmlFor={`date-${assetId}`}>
            <TextInput
              id={`date-${assetId}`}
              name="date"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
              className="num"
            />
          </Field>

          <Field label="Para hangi hesaba girsin?" htmlFor={`cash-${assetId}`}>
            <select
              id={`cash-${assetId}`}
              name="proceedsToCashId"
              defaultValue={cashAccounts[0]?.id ?? ""}
              className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            >
              {cashAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
              <option value="">Hesaba işleme</option>
            </select>
          </Field>
        </div>
      </div>

      {/* K/Z önizlemesi */}
      {preview && (
        <div
          className={cn(
            "mt-3 rounded-md border px-3 py-2.5",
            preview.profit ? "border-gain/40 bg-gain/10" : "border-loss/40 bg-loss/10",
          )}
        >
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
            {preview.rows.map((r) => (
              <div key={r.label}>
                <dt className="truncate text-xs text-ink-faint">{r.label}</dt>
                <dd className={cn("num mt-0.5 font-medium", r.className)}>{r.value}</dd>
              </div>
            ))}
          </dl>
          {preview.note && (
            <p className="mt-2 text-pretty text-xs text-ink-muted">{preview.note}</p>
          )}
        </div>
      )}

      {outstandingLoan && Number(outstandingLoan) > 0 && (
        <p className="mt-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-pretty text-xs text-warn">
          Bu varlığa bağlı{" "}
          {formatMoney(Money.of(outstandingLoan, currency), { compact: true })} kredi
          borcu var. Satışta önce bu kapatılacak, kalan tutar hesabınıza geçecek.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <SubmitButton variant="primary" pendingText="Kaydediliyor…">
          Onayla
        </SubmitButton>
        <Button type="button" variant="ghost" onClick={onClose}>
          Vazgeç
        </Button>
      </div>
    </form>
  );
}

const TITLES: Record<DisposeKind, string> = {
  position: "pozisyonundan çıkıyorsunuz.",
  physical: "satılıyor.",
  deposit: "hesabı kapatılıyor.",
  venture: "girişiminden çıkılıyor.",
};

function buildPreview(v: {
  kind: DisposeKind;
  sellQty: string;
  price: string;
  costs: string;
  proceeds: string;
  cost?: string;
  quantity?: string;
  outstandingLoan?: string;
  currency: string;
}) {
  try {
    const c = v.currency;
    const rows: Array<{ label: string; value: string; className: string }> = [];
    let pnl: Decimal | null = null;
    let note: string | null = null;

    if (v.kind === "position") {
      if (!v.sellQty || !v.price || !v.quantity || !v.cost) return null;
      const qty = new Decimal(v.sellQty);
      const gross = qty.times(v.price);
      // Orantılı maliyet: satılan miktarın payına düşen maliyet
      const unitCost = new Decimal(v.cost).dividedBy(v.quantity);
      const soldCost = unitCost.times(qty);
      pnl = gross.minus(soldCost);

      rows.push({ label: "Satış hasılatı", value: fmt(gross, c), className: "text-ink" });
      rows.push({ label: "Satılanın maliyeti", value: fmt(soldCost, c), className: "text-ink-muted" });
    } else if (v.kind === "physical") {
      if (!v.price) return null;
      const gross = new Decimal(v.price);
      const costs = new Decimal(v.costs || 0);
      const loan = new Decimal(v.outstandingLoan || 0);
      const net = gross.minus(costs).minus(loan);
      pnl = v.cost ? gross.minus(costs).minus(v.cost) : null;

      rows.push({ label: "Satış fiyatı", value: fmt(gross, c), className: "text-ink" });
      if (loan.greaterThan(0)) {
        rows.push({ label: "Kapanacak kredi", value: fmt(loan.negated(), c), className: "text-loss" });
      }
      rows.push({
        label: "Cebinize girecek",
        value: fmt(net, c),
        className: net.isNegative() ? "text-loss" : "text-gain",
      });
      if (net.isNegative()) {
        note = "Satış bedeli krediyi karşılamıyor — aradaki farkı siz ödeyeceksiniz.";
      }
    } else if (v.kind === "venture") {
      if (!v.proceeds) return null;
      const gross = new Decimal(v.proceeds);
      pnl = v.cost ? gross.minus(v.cost) : null;
      rows.push({ label: "Çıkış tutarı", value: fmt(gross, c), className: "text-ink" });
      if (gross.isZero()) note = "Tüm yatırım kaybedilmiş olarak kaydedilecek.";
    } else {
      return null;
    }

    if (pnl) {
      rows.push({
        label: "Gerçekleşen K/Z",
        value: fmt(pnl, c, true),
        className: pnl.isNegative() ? "text-loss" : "text-gain",
      });
      if (v.cost && Number(v.cost) > 0) {
        const ratio = pnl.dividedBy(v.cost);
        rows.push({
          label: "Getiri",
          value: formatPercent(ratio, { signed: true, decimals: 1 }),
          className: pnl.isNegative() ? "text-loss" : "text-gain",
        });
      }
    }

    return { rows, profit: !pnl || !pnl.isNegative(), note };
  } catch {
    return null;
  }
}

function fmt(d: Decimal, currency: string, signed = false): string {
  return formatMoney(Money.of(d.toFixed(), currency), { compact: true, signed });
}
