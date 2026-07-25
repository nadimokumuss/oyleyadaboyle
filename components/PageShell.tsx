import { cn } from "@/lib/cn";

export function PageShell({
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-7xl px-6 py-6", className)}>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-balance text-xl font-semibold text-ink">{title}</h1>
          {subtitle && (
            <p className="mt-1 text-pretty text-sm text-ink-muted">{subtitle}</p>
          )}
        </div>
        {actions}
      </header>
      {children}
    </div>
  );
}

/** Boş durum — her zaman tek net sonraki adım sunar. */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-surface-raised px-6 py-12 text-center">
      <p className="text-balance text-sm font-medium text-ink">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-pretty text-sm text-ink-muted">
        {description}
      </p>
      <div className="mt-5">{action}</div>
    </div>
  );
}

export function Card({
  title,
  hint,
  children,
  className,
}: {
  title?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border border-line bg-surface-raised p-4",
        className,
      )}
    >
      {title && (
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="truncate text-sm font-medium text-ink">{title}</h2>
          {hint && <span className="shrink-0 text-xs text-ink-faint">{hint}</span>}
        </div>
      )}
      {children}
    </section>
  );
}
