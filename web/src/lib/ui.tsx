import type { LucideIcon } from "lucide-react";
import { motion, type HTMLMotionProps } from "motion/react";
import type { ReactNode } from "react";

import { CountUp, EASE } from "./motion";

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
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -30px 0px" }}
      transition={{ duration: 0.45, ease: EASE }}
      className={`rounded-2xl border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-card)] transition-shadow duration-300 hover:shadow-[var(--shadow-lift)] ${className}`}
    >
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
          <h2 className="flex items-center gap-2 text-[12px] font-semibold tracking-[0.08em] uppercase text-[var(--ink-soft)]">
            <span className="h-3.5 w-1 rounded-full bg-gradient-to-b from-[var(--accent)] to-sky-400" />
            {title}
          </h2>
          {right}
        </header>
      )}
      {/* p-4, not more: pages cancel it with -m-4 so tables and the map run edge to edge. */}
      <div className="p-4">{children}</div>
    </motion.section>
  );
}

const STATUS: Record<string, { cls: string; dot: string }> = {
  overdue: { cls: "bg-red-50 text-red-800 ring-red-200", dot: "text-red-500" },
  due: { cls: "bg-amber-50 text-amber-800 ring-amber-200", dot: "text-amber-500" },
  pending: { cls: "bg-slate-50 text-slate-700 ring-slate-200", dot: "text-slate-400" },
  submitted: { cls: "bg-blue-50 text-blue-800 ring-blue-200", dot: "text-blue-500" },
  verified: { cls: "bg-emerald-50 text-emerald-800 ring-emerald-200", dot: "text-emerald-500" },
  waived: { cls: "bg-slate-50 text-slate-500 ring-slate-200", dot: "text-slate-300" },
  critical: { cls: "bg-red-50 text-red-800 ring-red-200", dot: "text-red-500" },
  warning: { cls: "bg-amber-50 text-amber-800 ring-amber-200", dot: "text-amber-500" },
  info: { cls: "bg-blue-50 text-blue-800 ring-blue-200", dot: "text-blue-500" },
};

/** Urgent states breathe; settled ones sit still. */
const LIVE = new Set(["overdue", "critical"]);

export function Badge({ kind, children }: { kind?: string; children: ReactNode }) {
  const s = STATUS[kind ?? ""] ?? { cls: "bg-slate-50 text-slate-700 ring-slate-200", dot: "text-slate-400" };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ring-1 ring-inset ${s.cls}`}
    >
      <span className={`size-1.5 rounded-full ${s.dot} ${LIVE.has(kind ?? "") ? "pulse-dot" : "bg-current"}`} />
      {children}
    </span>
  );
}

export function Clause({ children }: { children: ReactNode }) {
  return <span className="clause">{children}</span>;
}

/** Risk bar. Colour by band, and always show the number - a score you cannot
 *  read is a score you cannot challenge. */
export function RiskBar({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-[var(--ink-soft)]">—</span>;

  const pct = Math.min(100, Math.max(0, score));
  const colour =
    score >= 70
      ? "from-red-500 to-red-600"
      : score >= 40
        ? "from-amber-400 to-amber-500"
        : "from-emerald-500 to-emerald-600";

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200/80">
        <motion.div
          className={`h-full rounded-full bg-gradient-to-r ${colour}`}
          initial={{ width: 0 }}
          whileInView={{ width: `${pct}%` }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: EASE }}
        />
      </div>
      <span className="w-7 text-right text-xs font-semibold tabular-nums">{Math.round(score)}</span>
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
  // Tone drives the number, the icon chip, the edge rule and the glow at once,
  // so a card's state is legible from across a room - the actual viewing
  // distance during a demo.
  const tones = {
    default: { value: "text-[var(--ink)]", rule: "bg-slate-300", chip: "bg-slate-100 text-slate-500", glow: "from-sky-400/15" },
    bad: { value: "text-red-700", rule: "bg-red-500", chip: "bg-red-50 text-red-600", glow: "from-red-500/15" },
    good: { value: "text-emerald-700", rule: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-600", glow: "from-emerald-500/15" },
    warn: { value: "text-amber-700", rule: "bg-amber-500", chip: "bg-amber-50 text-amber-600", glow: "from-amber-500/15" },
  }[tone];

  return (
    <motion.div
      whileHover={{ y: -3 }}
      transition={{ type: "spring", stiffness: 400, damping: 28 }}
      className="group relative overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--panel)] px-4 py-3.5 shadow-[var(--shadow-card)] transition-shadow duration-300 hover:shadow-[var(--shadow-lift)]"
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${tones.rule}`} />
      <span
        className={`pointer-events-none absolute -top-12 -right-12 size-36 rounded-full bg-gradient-to-br ${tones.glow} to-transparent opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100`}
      />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--ink-soft)]">{label}</div>
          <div className={`stat-value mt-1.5 text-[28px] leading-none font-semibold tracking-tight ${tones.value}`}>
            <CountUp value={value} />
          </div>
        </div>
        {Icon && (
          <span
            className={`grid size-8 shrink-0 place-items-center rounded-xl transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6 ${tones.chip}`}
          >
            <Icon size={16} />
          </span>
        )}
      </div>
      {hint && <div className="mt-1.5 text-[11.5px] text-[var(--ink-soft)]">{hint}</div>}
    </motion.div>
  );
}

/**
 * An empty panel that says only "no data" reads as broken. Pair the sentence
 * with a drawn placeholder and it reads as a designed state instead - which
 * matters because a judge may see this dashboard before the simulator starts.
 */
export function Empty({ children, art }: { children: ReactNode; art?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center text-sm text-[var(--ink-soft)]">
      {art && (
        <motion.div
          className="text-[var(--ink-soft)]"
          animate={{ y: [0, -4, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        >
          {art}
        </motion.div>
      )}
      <p className="max-w-xs">{children}</p>
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "glass";

const BUTTON: Record<ButtonVariant, string> = {
  primary: "bg-[var(--accent)] text-white shadow-sm",
  secondary: "border border-[var(--line)] bg-white text-[var(--ink)] hover:bg-[var(--panel-2)]",
  ghost: "text-[var(--ink-soft)] hover:bg-slate-100 hover:text-[var(--ink)]",
  danger: "bg-[var(--crit)] text-white shadow-sm hover:bg-red-700",
  glass: "border border-white/20 bg-white/10 text-white hover:bg-white/20",
};

/** The one button: a variant and a size, everything else is a normal button prop. */
export function Button({
  variant = "primary",
  size = "md",
  icon: Icon,
  children,
  className = "",
  ...props
}: HTMLMotionProps<"button"> & {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  icon?: LucideIcon;
  children?: ReactNode;
}) {
  const sizes = {
    sm: "h-7 gap-1.5 rounded-lg px-2.5 text-xs",
    md: "h-9 gap-2 rounded-xl px-3.5 text-[13px]",
    lg: "h-11 gap-2 rounded-xl px-5 text-sm",
  }[size];
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      className={`inline-flex items-center justify-center font-medium disabled:cursor-not-allowed disabled:opacity-50 ${sizes} ${BUTTON[variant]} ${className}`}
      {...props}
    >
      {Icon && <Icon size={size === "sm" ? 13 : 15} />}
      {children}
    </motion.button>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}
