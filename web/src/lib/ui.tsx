import type { ReactNode } from "react";

export function Panel({
  title,
  right,
  children,
  className = "",
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-[var(--line)] bg-[var(--panel)] ${className}`}
    >
      {title && (
        <header className="flex items-center justify-between border-b border-[var(--line)] px-4 py-2.5">
          <h2 className="text-[13px] font-semibold tracking-wide uppercase text-[var(--ink-soft)]">
            {title}
          </h2>
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const STATUS: Record<string, string> = {
  overdue: "bg-red-50 text-red-800 ring-red-200",
  due: "bg-amber-50 text-amber-800 ring-amber-200",
  pending: "bg-slate-50 text-slate-700 ring-slate-200",
  submitted: "bg-blue-50 text-blue-800 ring-blue-200",
  verified: "bg-green-50 text-green-800 ring-green-200",
  waived: "bg-slate-50 text-slate-500 ring-slate-200",
  critical: "bg-red-50 text-red-800 ring-red-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  info: "bg-blue-50 text-blue-800 ring-blue-200",
};

export function Badge({
  kind,
  children,
}: {
  kind?: string;
  children: ReactNode;
}) {
  const cls = STATUS[kind ?? ""] ?? "bg-slate-50 text-slate-700 ring-slate-200";
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ring-1 ring-inset ${cls}`}
    >
      {children}
    </span>
  );
}

export function Clause({ children }: { children: ReactNode }) {
  return <span className="clause">{children}</span>;
}

/** Risk bar. Colour by band, and always show the number — a score you cannot
 *  read is a score you cannot challenge. */
export function RiskBar({ score }: { score: number | null }) {
  if (score == null)
    return <span className="text-xs text-[var(--ink-soft)]">—</span>;

  const colour =
    score >= 70 ? "bg-red-600" : score >= 40 ? "bg-amber-500" : "bg-emerald-600";

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full ${colour}`}
          style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
        />
      </div>
      <span className="w-7 text-right text-xs font-semibold tabular-nums">
        {Math.round(score)}
      </span>
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "bad" | "good" | "warn";
}) {
  const tones = {
    default: "text-[var(--ink)]",
    bad: "text-red-700",
    good: "text-emerald-700",
    warn: "text-amber-700",
  };
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--panel)] px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--ink-soft)]">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tones[tone]}`}>
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-[11px] text-[var(--ink-soft)]">{hint}</div>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="py-8 text-center text-sm text-[var(--ink-soft)]">
      {children}
    </div>
  );
}
