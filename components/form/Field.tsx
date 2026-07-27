"use client";

import { useId, useState, forwardRef } from "react";
import { cn } from "@/lib/cn";

/**
 * Form alanları.
 *
 * Ortak kurallar:
 *  - Hata mesajı her zaman alanın hemen altında (uzaktaki bir özet değil)
 *  - `aria-invalid` ve `aria-describedby` bağlı, ekran okuyucu hatayı okur
 *  - Yapıştırma asla engellenmez
 *  - Sayısal alanlar Türkçe biçimle gösterilir, sunucuya ham değer gider
 */

export function Field({
  label,
  hint,
  error,
  required,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-sm font-medium text-ink"
      >
        {label}
        {required && <span className="ml-1 text-loss">*</span>}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-xs text-loss">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-pretty text-xs text-ink-faint">{hint}</p>
      ) : null}
    </div>
  );
}

const inputBase =
  "w-full rounded-md border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent " +
  "disabled:opacity-50";

export const TextInput = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { error?: string }
>(function TextInput({ className, error, ...props }, ref) {
  return (
    <input
      ref={ref}
      {...props}
      aria-invalid={error ? true : undefined}
      className={cn(inputBase, error ? "border-loss" : "border-line", className)}
    />
  );
});

export function Select({
  className,
  error,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { error?: string }) {
  return (
    <select
      {...props}
      aria-invalid={error ? true : undefined}
      className={cn(inputBase, error ? "border-loss" : "border-line", className)}
    >
      {children}
    </select>
  );
}

export function TextArea({
  className,
  error,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: string }) {
  return (
    <textarea
      {...props}
      rows={props.rows ?? 3}
      aria-invalid={error ? true : undefined}
      className={cn(inputBase, "resize-y", error ? "border-loss" : "border-line", className)}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Para girişi                                                         */
/* ------------------------------------------------------------------ */

/**
 * Türkçe biçimli para girişi: yazarken 1.234.567,89 gösterir,
 * sunucuya gizli alanla ham `1234567.89` gönderir.
 *
 * Neden gizli alan: kullanıcı binlik ayraçlı görmeli ama sunucudaki
 * Decimal ayrıştırıcısı ham değer beklemeli. İkisini ayırmak, yerel
 * ayraç kurallarının hesaba sızmasını önler.
 */
export function MoneyInput({
  name,
  defaultValue,
  currency,
  error,
  id,
  required,
  placeholder,
  onValueChange,
}: {
  name: string;
  defaultValue?: string | number;
  currency?: string;
  error?: string;
  id?: string;
  required?: boolean;
  placeholder?: string;
  /** Ham (ondalık) değeri bildirir — canlı toplam hesabı için. */
  onValueChange?: (raw: string) => void;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const [display, setDisplay] = useState(() =>
    defaultValue !== undefined && defaultValue !== ""
      ? formatTr(String(defaultValue))
      : "",
  );

  const raw = parseTr(display);

  return (
    <div className="relative">
      <input
        id={inputId}
        inputMode="decimal"
        autoComplete="off"
        required={required}
        placeholder={placeholder ?? "0,00"}
        value={display}
        onChange={(e) => {
          const next = sanitize(e.target.value);
          setDisplay(next);
          onValueChange?.(parseTr(next));
        }}
        onBlur={() => setDisplay((v) => (v ? formatTr(parseTr(v)) : ""))}
        aria-invalid={error ? true : undefined}
        className={cn(
          inputBase,
          "num pr-12 text-right",
          error ? "border-loss" : "border-line",
        )}
      />
      {currency && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-faint">
          {currency}
        </span>
      )}
      <input type="hidden" name={name} value={raw} />
    </div>
  );
}

/** Yalnızca rakam, nokta ve virgüle izin verir. */
function sanitize(value: string): string {
  return value.replace(/[^\d.,-]/g, "");
}

/** "1.234.567,89" → "1234567.89" */
function parseTr(value: string): string {
  if (!value) return "";
  const cleaned = value.replace(/\./g, "").replace(",", ".");
  return /^-?\d*\.?\d*$/.test(cleaned) ? cleaned : "";
}

/** "1234567.89" → "1.234.567,89" */
function formatTr(raw: string): string {
  if (!raw) return "";
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  const [int, dec] = raw.split(".");
  const grouped = new Intl.NumberFormat("tr-TR", {
    maximumFractionDigits: 0,
  }).format(Number(int || 0));
  return dec !== undefined ? `${grouped},${dec}` : grouped;
}

/* ------------------------------------------------------------------ */
/* Yüzde girişi                                                        */
/* ------------------------------------------------------------------ */

/**
 * Kullanıcı 42,5 yazar; sunucuya 0.425 gider.
 * Oranı kullanıcıya ondalık olarak yazdırmak (0,425) sık yapılan bir
 * hata kaynağıdır — kimse faizi böyle düşünmez.
 */
export function PercentInput({
  name,
  defaultValue,
  error,
  id,
  required,
  max,
  onValueChange,
}: {
  name: string;
  /** Oran olarak (0.425), yüzde olarak değil. */
  defaultValue?: string | number;
  error?: string;
  id?: string;
  required?: boolean;
  max?: number;
  /** Ham oranı bildirir (0.425). */
  onValueChange?: (raw: string) => void;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const [display, setDisplay] = useState(() =>
    defaultValue !== undefined && defaultValue !== ""
      ? String(Number(defaultValue) * 100).replace(".", ",")
      : "",
  );

  const raw = display ? String(Number(parseTr(display)) / 100) : "";

  return (
    <div className="relative">
      <input
        id={inputId}
        inputMode="decimal"
        autoComplete="off"
        required={required}
        placeholder="0,00"
        value={display}
        onChange={(e) => {
          const next = sanitize(e.target.value);
          setDisplay(next);
          onValueChange?.(next ? String(Number(parseTr(next)) / 100) : "");
        }}
        aria-invalid={error ? true : undefined}
        className={cn(
          inputBase,
          "num pr-8 text-right",
          error ? "border-loss" : "border-line",
        )}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-faint">
        %
      </span>
      <input type="hidden" name={name} value={raw} />
      {max !== undefined && Number(raw) > max && (
        <p className="mt-1 text-xs text-warn">
          %{max * 100} üzerinde bir değer girdiniz — emin misiniz?
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Para birimi ve tarih                                                */
/* ------------------------------------------------------------------ */

const CURRENCIES = [
  "USD", "EUR", "TRY", "GBP", "CHF", "AED", "JPY", "CAD", "AUD",
] as const;

export function CurrencySelect({
  name,
  defaultValue = "USD",
  id,
  error,
  onChange,
}: {
  name: string;
  defaultValue?: string;
  id?: string;
  error?: string;
  /** Seçim değiştiğinde — tutar alanının para birimi etiketini güncellemek için. */
  onChange?: React.ChangeEventHandler<HTMLSelectElement>;
}) {
  return (
    <Select name={name} defaultValue={defaultValue} id={id} error={error} onChange={onChange}>
      {CURRENCIES.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </Select>
  );
}

export function DateInput({
  name,
  defaultValue,
  id,
  error,
  required,
  max,
}: {
  name: string;
  defaultValue?: string;
  id?: string;
  error?: string;
  required?: boolean;
  max?: string;
}) {
  return (
    <TextInput
      type="date"
      name={name}
      id={id}
      required={required}
      error={error}
      max={max ?? new Date().toISOString().slice(0, 10)}
      defaultValue={defaultValue?.slice(0, 10)}
      className="num"
    />
  );
}
