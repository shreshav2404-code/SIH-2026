import type { LucideIcon } from "lucide-react";
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
      className={`rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-sm ${className}`}
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
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "bad" | "good" | "warn";
  icon?: LucideIcon;
}) {
  // Tone drives three things at once - the number, the icon chip and the rule
  // down the left edge - so the card's state is legible from across a room,
  // which is the actual viewing distance during a demo.
  const tones = {
    default: {
      value: "text-[var(--ink)]",
      rule: "bg-slate-300",
      chip: "bg-slate-100 text-slate-500",
    },
    bad: {
      value: "text-red-700",
      rule: "bg-red-500",
      chip: "bg-red-50 text-red-600",
    },
    good: {
      value: "text-emerald-700",
      rule: "bg-emerald-500",
      chip: "bg-emerald-50 text-emerald-600",
    },
    warn: {
      value: "text-amber-700",
      rule: "bg-amber-500",
      chip: "bg-amber-50 text-amber-600",
    },
  }[tone];

  return (
    <div className="relative overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-3 shadow-sm">
      <span className={`absolute inset-y-0 left-0 w-1 ${tones.rule}`} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--ink-soft)]">
            {label}
          </div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${tones.value}`}>
            {value}
          </div>
        </div>
        {Icon && (
          <span className={`grid size-7 shrink-0 place-items-center rounded-lg ${tones.chip}`}>
            <Icon size={15} />
          </span>
        )}
      </div>
      {hint && (
        <div className="mt-0.5 text-[11px] text-[var(--ink-soft)]">{hint}</div>
      )}
    </div>
  );
}

/**
 * An empty panel that says only "no data" reads as broken. Pair the sentence
 * with a drawn placeholder and it reads as a designed state instead - which
 * matters because a judge may see this dashboard before the simulator starts.
 */
export function Empty({
  children,
  art,
}: {
  children: ReactNode;
  art?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center text-sm text-[var(--ink-soft)]">
      {art && <div className="text-[var(--ink-soft)]">{art}</div>}
      <p className="max-w-xs">{children}</p>
    </div>
  );
}
