"use client";

import { useState } from "react";
import Decimal from "decimal.js";
import { Money, formatMoney } from "@/lib/money";
import { monthlyPayment, summarizeLoan } from "@/lib/finance/loan";
import { Field, TextInput, MoneyInput, PercentInput } from "./Field";
import { cn } from "@/lib/cn";

/**
 * Ödeme kaynağı seçici.
 *
 * Panelin temel muhasebe kuralını arayüze taşır: bir varlık kazanmak
 * ya nakit eksiltir ya borç doğurur. "Zaten sahibim" seçeneği bilinçli
 * bir istisnadır — eski varlıkları kaydederken bugünkü nakdinizin
 * erimemesi için.
 */

export interface CashAccount {
  id: string;
  name: string;
  currency: string;
  balance: string;
}

export function FundingSource({
  cashAccounts,
  cost,
  currency,
  purchaseDate,
  defaultMode = "cash",
}: {
  cashAccounts: CashAccount[];
  /** Varlığın toplam maliyeti (ham ondalık string). */
  cost: string;
  currency: string;
  purchaseDate: string;
  defaultMode?: "cash" | "external" | "loan";
}) {
  const [mode, setMode] = useState(defaultMode);
  const [cashId, setCashId] = useState(cashAccounts[0]?.id ?? "");
  const [downPayment, setDownPayment] = useState("");
  const [rate, setRate] = useState("");
  const [termMonths, setTermMonths] = useState("120");

  const costMoney = safeMoney(cost, currency);
  const selected = cashAccounts.find((a) => a.id === cashId);
  const balance = selected ? safeMoney(selected.balance, selected.currency) : null;

  const insufficient =
    mode === "cash" && balance && costMoney && costMoney.amount.gt(balance.amount);

  const loanPreview =
    mode === "loan" ? buildLoanPreview(costMoney, downPayment, rate, termMonths, currency) : null;

  return (
    <fieldset className="rounded-md border border-line bg-surface p-4">
      <legend className="px-1 text-sm font-medium text-ink">Ödeme kaynağı</legend>

      <div className="space-y-2">
        <Option
          checked={mode === "cash"}
          onSelect={() => setMode("cash")}
          title="Nakit hesabımdan öde"
          desc="Seçtiğiniz hesaptan tutar düşülür. Net servetiniz değişmez — nakit varlığa dönüşür."
        />
        <Option
          checked={mode === "loan"}
          onSelect={() => setMode("loan")}
          title="Kredi ile al"
          desc="Peşinat nakitten düşer, kalan için borç kaydı açılır. Net servet = varlık − kalan borç."
        />
        <Option
          checked={mode === "external"}
          onSelect={() => setMode("external")}
          title="Zaten sahibim / dışarıdan ödendi"
          desc="Nakit düşülmez. Eskiden aldığınız veya miras/hediye gelen varlıkları kaydetmek için."
        />
      </div>

      <input type="hidden" name="fundingMode" value={mode} />

      {/* --- Nakit hesabı seçimi --- */}
      {(mode === "cash" || mode === "loan") && (
        <div className="mt-4 space-y-3 border-t border-line pt-3">
          {cashAccounts.length === 0 ? (
            <p className="text-pretty text-xs text-warn">
              Kayıtlı nakit hesabınız yok. Önce bir nakit hesabı eklerseniz ödeme
              buradan düşülebilir; şimdilik varlık kaynağı belirsiz kaydedilecek.
            </p>
          ) : (
            <Field
              label={mode === "loan" ? "Peşinat hangi hesaptan?" : "Hangi hesaptan?"}
              htmlFor="fundingCashAssetId"
            >
              <select
                id="fundingCashAssetId"
                name="fundingCashAssetId"
                value={cashId}
                onChange={(e) => setCashId(e.target.value)}
                className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              >
                {cashAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {formatMoney(safeMoney(a.balance, a.currency) ?? Money.zero(a.currency))}
                  </option>
                ))}
                <option value="">Hesap seçme (kaynağı belirtme)</option>
              </select>
            </Field>
          )}

          {insufficient && costMoney && balance && (
            <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-pretty text-xs text-warn">
              Bu hesapta {formatMoney(costMoney)} yok — bakiye{" "}
              {formatMoney(balance)}. Yine de kaydedebilirsiniz ama nakit eksiye
              düşer. Kredi seçeneğini değerlendirin.
            </p>
          )}
        </div>
      )}

      {/* --- Kredi koşulları --- */}
      {mode === "loan" && (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Peşinat" htmlFor="fundingDownPayment">
              <MoneyInput
                id="fundingDownPayment"
                name="fundingDownPayment"
                currency={currency}
                onValueChange={setDownPayment}
              />
            </Field>

            <Field label="Kredi veren" htmlFor="loanLender">
              <TextInput
                id="loanLender"
                name="loanLender"
                placeholder="Örn. Garanti BBVA"
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Yıllık faiz oranı" htmlFor="loanAnnualRate">
              <PercentInput
                id="loanAnnualRate"
                name="loanAnnualRate"
                max={2}
                onValueChange={setRate}
              />
            </Field>

            <Field label="Vade (ay)" htmlFor="loanTermMonths">
              <TextInput
                id="loanTermMonths"
                name="loanTermMonths"
                type="number"
                min={1}
                max={600}
                value={termMonths}
                onChange={(e) => setTermMonths(e.target.value)}
                className="num text-right"
              />
            </Field>
          </div>

          <input type="hidden" name="loanStartDate" value={purchaseDate} />

          {loanPreview && (
            <div className="rounded-md border border-accent/40 bg-accent/5 px-3 py-2.5">
              <p className="text-xs font-medium text-ink">Kredi özeti</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-4">
                <Cell label="Kredi tutarı" value={loanPreview.principal} />
                <Cell label="Aylık taksit" value={loanPreview.monthly} />
                <Cell label="Toplam faiz" value={loanPreview.totalInterest} tone="loss" />
                <Cell label="Toplam ödeme" value={loanPreview.totalPayment} />
              </dl>
              <p className="mt-2 text-pretty text-xs text-ink-muted">
                Bu kredi net servetinizi <strong>değiştirmez</strong> — varlık
                artar, borç artar. Değiştirdiği şey aylık nakit akışınız:{" "}
                <span className="num text-loss">−{loanPreview.monthly}/ay</span>
              </p>
            </div>
          )}
        </div>
      )}

      {mode === "external" && (
        <p className="mt-3 rounded-md border border-line bg-surface-raised px-3 py-2 text-pretty text-xs text-ink-muted">
          Bu varlık net servetinize <strong className="text-ink">eklenecek</strong>{" "}
          ama hiçbir hesaptan para düşülmeyecek. Yeni bir alım yapıyorsanız bu
          seçenek servetinizi olduğundan büyük gösterir.
        </p>
      )}
    </fieldset>
  );
}

function Option({
  checked,
  onSelect,
  title,
  desc,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  desc: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors",
        checked ? "border-accent/50 bg-accent/5" : "border-line hover:bg-surface-hover",
      )}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onSelect}
        className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
      />
      <span>
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-pretty text-xs text-ink-muted">{desc}</span>
      </span>
    </label>
  );
}

function Cell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "loss";
}) {
  return (
    <div>
      <dt className="truncate text-xs text-ink-faint">{label}</dt>
      <dd className={cn("num mt-0.5 font-medium", tone === "loss" ? "text-loss" : "text-ink")}>
        {value}
      </dd>
    </div>
  );
}

function safeMoney(value: string, currency: string): Money | null {
  try {
    if (!value) return null;
    return Money.of(value, currency);
  } catch {
    return null;
  }
}

function buildLoanPreview(
  cost: Money | null,
  downPayment: string,
  rate: string,
  termMonths: string,
  currency: string,
) {
  try {
    if (!cost) return null;
    const down = downPayment ? new Decimal(downPayment) : new Decimal(0);
    const principal = cost.amount.minus(down);
    if (principal.lessThanOrEqualTo(0)) return null;

    const months = Number(termMonths);
    if (!Number.isInteger(months) || months < 1) return null;

    const terms = {
      principal: Money.of(principal.toFixed(), currency),
      annualRate: new Decimal(rate || 0),
      termMonths: months,
      startDate: new Date(),
    };

    const summary = summarizeLoan(terms, 0);
    return {
      principal: formatMoney(terms.principal, { compact: true }),
      monthly: formatMoney(monthlyPayment(terms), { compact: true }),
      totalInterest: formatMoney(summary.totalInterest, { compact: true }),
      totalPayment: formatMoney(summary.totalPayment, { compact: true }),
    };
  } catch {
    return null;
  }
}
