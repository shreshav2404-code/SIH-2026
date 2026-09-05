/**
 * The open-cast mining cycle, and where compliance attaches to it.
 *
 * DRAWN, not copied. The reference for this was a figure extracted from an
 * academic paper - copyright of its publisher, and not ours to ship. The
 * process it depicts is factual and not protectable, so this is an original
 * drawing of the same sequence, in this product's own visual language and as
 * vector rather than a 1238x806 raster of a scanned page.
 *
 * It earns its place by doing something the source figure did not: each stage
 * names the duty ANUPALAN actually tracks there, drawn from this mine's real
 * ledger. That turns a generic process diagram into an answer to the question
 * a judge asks, which is "where does your system actually touch the mine?".
 */

const STAGES: {
  name: string;
  duty: string;
  clause: string;
  /** Which subsystem does the checking - the amber/blue split from the deck. */
  by: "deterministic" | "model";
}[] = [
  {
    name: "Survey & pit design",
    duty: "Working inside the lease boundary",
    clause: "MMR 1961",
    by: "deterministic",
  },
  {
    name: "Land clearing",
    duty: "Topsoil removal and storage",
    clause: "EC condition",
    by: "model",
  },
  {
    name: "Drilling & blasting",
    duty: "Ground vibration within limits",
    clause: "CMR 2017",
    by: "deterministic",
  },
  {
    name: "Overburden removal",
    duty: "Dump slope stability check",
    clause: "CMR 2017",
    by: "model",
  },
  {
    name: "Coal extraction",
    duty: "Methane below the trigger",
    clause: "CMR 2017 R.46",
    by: "deterministic",
  },
  {
    name: "Preparation & dispatch",
    duty: "PM10 within consent",
    clause: "CPCB consent",
    by: "deterministic",
  },
  {
    name: "Rehabilitation",
    duty: "Biological reclamation target",
    clause: "EC condition",
    by: "model",
  },
];

export default function Lifecycle() {
  return (
    <div className="overflow-x-auto">
      {/* The row scrolls rather than wrapping. A seven-stage cycle folded onto
          two lines stops reading as a sequence, which is the only thing this
          diagram is for. */}
      <ol className="flex min-w-[900px] items-stretch gap-0">
        {STAGES.map((s, i) => (
          <li key={s.name} className="relative flex flex-1 flex-col">
            {/* the spine */}
            <div className="flex items-center">
              <div
                className={`h-0.5 flex-1 ${i === 0 ? "bg-transparent" : "bg-[var(--line)]"}`}
              />
              <span
                className={`grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold ring-2 ${
                  s.by === "deterministic"
                    ? "bg-[#14539a] text-white ring-[#14539a]/20"
                    : "bg-amber-500 text-white ring-amber-500/20"
                }`}
              >
                {i + 1}
              </span>
              <div
                className={`h-0.5 flex-1 ${
                  i === STAGES.length - 1 ? "bg-transparent" : "bg-[var(--line)]"
                }`}
              />
            </div>

            <div className="px-2 pt-2 text-center">
              <p className="text-[12px] leading-tight font-semibold">{s.name}</p>
              <p className="mt-1 text-[11px] leading-snug text-[var(--ink-soft)]">
                {s.duty}
              </p>
              <p className="clause mt-1 block">{s.clause}</p>
            </div>
          </li>
        ))}
      </ol>

      {/* The legend is the argument, not decoration: it is the line the deck
          draws between what arithmetic decides and what the model drafts. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-[var(--line)] pt-2.5 text-[11px] text-[var(--ink-soft)]">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-[#14539a]" />
          checked by arithmetic — thresholds, PostGIS, hash chain
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-amber-500" />
          drafted by the on-device model — an officer still signs
        </span>
      </div>
    </div>
  );
}
