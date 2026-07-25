import Link from "next/link";
import { cn } from "@/lib/cn";
import type { AuditFinding } from "@/lib/services/audit";

/**
 * Tutarlılık uyarı şeridi.
 *
 * Hatalar sayıların doğruluğunu etkilediği için gizlenmiyor —
 * kullanıcı yanlış bir servet rakamına bakarken bunu bilmeli.
 * Bilgilendirme düzeyindeki notlar sade tutuluyor ki gürültü olmasın.
 */
export function AuditBanner({ findings }: { findings: AuditFinding[] }) {
  const serious = findings.filter((f) => f.severity !== "info");
  if (serious.length === 0) return null;

  return (
    <ul className="mb-4 space-y-2">
      {serious.map((f) => (
        <li
          key={f.key}
          className={cn(
            "rounded-lg border px-4 py-3",
            f.severity === "error"
              ? "border-loss/50 bg-loss/10"
              : "border-warn/50 bg-warn/10",
          )}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p
                className={cn(
                  "text-sm font-medium",
                  f.severity === "error" ? "text-loss" : "text-warn",
                )}
              >
                {f.title}
              </p>
              <p className="num mt-1 text-pretty text-xs text-ink-muted">{f.detail}</p>
            </div>
            {f.href && (
              <Link
                href={f.href}
                className="shrink-0 rounded-md border border-line bg-surface px-2.5 py-1 text-xs text-ink transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                İncele
              </Link>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
