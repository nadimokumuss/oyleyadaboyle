"use client";

import { useFormStatus } from "react-dom";
import { cn } from "@/lib/cn";

const base =
  "inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium " +
  "transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const variants = {
  primary: "bg-accent text-surface hover:opacity-90",
  secondary: "border border-line bg-surface-raised text-ink hover:bg-surface-hover",
  danger: "border border-loss/50 bg-loss/10 text-loss hover:bg-loss/20",
  ghost: "text-ink-muted hover:bg-surface-hover hover:text-ink",
} as const;

export function Button({
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
}) {
  return <button {...props} className={cn(base, variants[variant], className)} />;
}

/**
 * Gönderim düğmesi — form gönderilirken kendini devre dışı bırakır.
 * Çift tıklamayla iki kayıt oluşmasını engeller.
 */
export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
  className,
}: {
  children: React.ReactNode;
  pendingText?: string;
  variant?: keyof typeof variants;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={cn(base, variants[variant], className)}
    >
      {pending ? (pendingText ?? "Kaydediliyor…") : children}
    </button>
  );
}
