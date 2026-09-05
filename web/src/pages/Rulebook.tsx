import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../api/client";
import type {
  ClauseMatch,
  DutiesOut,
  ExtractedDuty,
  RetrieveOut,
} from "../api/types";
import { useAuth } from "../lib/auth";
import { Badge, Clause, Empty, Panel } from "../lib/ui";
import railsBg from "../assets/photos/rails-wide.jpg";
import PageHero from "../lib/PageHero";

/** A DGMS-style circular, so the demo mines real statutory language. */
const SAMPLE = `Circular No. DGMS(Tech)/2026/14

Sub: Strengthening of ventilation monitoring in degree-III gassy seams.

The Ventilation Officer shall determine the efficiency of every main
mechanical ventilator once in each quarter and shall record the result in the
prescribed register. Air samples drawn from the return airway shall be
analysed within forty-eight hours of collection, and the manager shall satisfy
himself that the results are placed before the Safety Committee.`;

const ROLES = [
  "Mine Manager", "Safety Officer", "Ventilation Officer", "Environment Officer",
  "Medical Officer", "Welfare Officer", "Workmen's Inspector",
  "Rescue Superintendent", "Owner/Agent", "Surveyor",
];
const FREQS = [
  "continuous", "daily", "weekly", "4x_weekly", "fortnightly", "monthly",
  "quarterly", "half_yearly", "annual", "event_driven", "one_time",
];
const EVIDENCE = [
  "photo", "reading", "document", "register", "meeting_minutes",
  "diary_entry", "sample_result", "return_filing", "certificate", "survey",
];

/** A regulation number that does not exist, to demonstrate the guard. */
const FABRICATED = "CMR 2017 · Reg. 999";

function firstSentence(text: string, max = 90) {
  const s = text.split(/[.;]/)[0].trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export default function Rulebook() {
  const { user } = useAuth();
  const [text, setText] = useState(SAMPLE);
  const [matches, setMatches] = useState<ClauseMatch[]>([]);
  const [duties, setDuties] = useState<ExtractedDuty[]>([]);
  const [result, setResult] = useState<DutiesOut | null>(null);

  const retrieve = useMutation({
    mutationFn: async () =>
      (await api.post<RetrieveOut>("/rulebook/retrieve", { text, k: 3 })).data,
    onSuccess: (data) => {
      // Dedupe by clause_ref, keeping the strongest match for each.
      const best = new Map<string, ClauseMatch>();
      for (const chunk of data.chunks)
        for (const m of chunk.matches)
          if ((best.get(m.clause_ref)?.similarity ?? -1) < m.similarity)
            best.set(m.clause_ref, m);

      const ranked = [...best.values()].sort((a, b) => b.similarity - a.similarity);
      setMatches(ranked);
      setResult(null);

      // Draft one duty per retrieved clause, pre-filled from the corpus. In the
      // field app this step is Gemma's; here it is deterministic so the flow can
      // be demonstrated without a phone.
      setDuties(
        ranked.slice(0, 3).map((m) => ({
          title: firstSentence(m.text),
          owner_role: /ventilat/i.test(m.text)
            ? "Ventilation Officer"
            : /safety/i.test(m.text)
              ? "Safety Officer"
              : "Mine Manager",
          frequency: /quarter/i.test(m.text)
            ? "quarterly"
            : /daily|each day/i.test(m.text)
              ? "daily"
              : /annual|year/i.test(m.text)
                ? "annual"
                : "event_driven",
          evidence_type: /sample/i.test(m.text)
            ? "sample_result"
            : /record|register/i.test(m.text)
              ? "reading"
              : "document",
          clause_ref: m.clause_ref,
        })),
      );
    },
  });

  const commit = useMutation({
    mutationFn: async (payload: ExtractedDuty[]) =>
      (
        await api.post<DutiesOut>("/rulebook/duties", {
          mine_id: user?.mine_id ?? 1,
          source_text: text,
          duties: payload,
        })
      ).data,
    onSuccess: setResult,
  });

  function patch(i: number, field: keyof ExtractedDuty, value: string) {
    setDuties((d) => d.map((x, j) => (j === i ? { ...x, [field]: value } : x)));
  }

  return (
    <div className="grid gap-4">
      <PageHero
        image={railsBg}
        eyebrow="Regulation-as-Code"
        title="Circular text in, structured duties out"
      >
        A statutory circular is retrieved, read on the device, and returned as a
        duty with an owner, a frequency and the clause it came from. The model
        drafts; a qualified person still signs.
      </PageHero>

      <div className="rounded-lg border border-[var(--line)] bg-[var(--panel)] px-4 py-3">
        <h1 className="text-sm font-semibold">Regulation-as-Code</h1>
        <p className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)]">
          A circular becomes tracked duties. MiniLM retrieves the governing
          clauses first, and the extractor may only cite what it was handed — an
          answer with no citation, or one naming a regulation outside the
          corpus, is <strong>rejected by the system</strong>, not by a reviewer.
          In the field app this extraction runs on-device; this panel drives the
          same endpoints so the flow can be shown without a phone.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="1 · Paste a circular"
          right={
            <button
              onClick={() => {
                setText(SAMPLE);
                setMatches([]);
                setDuties([]);
                setResult(null);
              }}
              className="text-xs text-[var(--accent)] hover:underline"
            >
              Reset sample
            </button>
          }
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            className="w-full resize-y rounded border border-[var(--line)] p-3 font-mono text-xs leading-relaxed outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={() => retrieve.mutate()}
            disabled={retrieve.isPending || !text.trim()}
            className="mt-3 w-full rounded bg-[var(--accent)] py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {retrieve.isPending ? "Retrieving…" : "Retrieve governing clauses"}
          </button>
          {retrieve.isError && (
            <p className="mt-2 text-xs text-red-700">
              Retrieval failed. Is the clause corpus embedded? Run{" "}
              <code>python api/seed/seed.py --reset</code>.
            </p>
          )}
        </Panel>

        <Panel title="2 · Retrieved clauses (MiniLM over pgvector)">
          {matches.length === 0 ? (
            <Empty>Retrieve to see which clauses govern this text.</Empty>
          ) : (
            <ul className="-my-2 divide-y divide-[var(--line)]">
              {matches.slice(0, 6).map((m) => (
                <li key={m.clause_ref} className="py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <Clause>{m.clause_ref}</Clause>
                    <span className="shrink-0 text-[11px] tabular-nums text-[var(--ink-soft)]">
                      {(m.similarity * 100).toFixed(1)}% match
                    </span>
                  </div>
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full bg-[var(--accent)]"
                      style={{ width: `${Math.max(2, m.similarity * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-[var(--ink-soft)]">{m.text}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {duties.length > 0 && (
        <Panel
          title="3 · Duties to add to the ledger"
          right={
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  commit.mutate([
                    {
                      ...duties[0],
                      title: `${duties[0].title} (fabricated citation)`,
                      clause_ref: FABRICATED,
                    },
                  ])
                }
                disabled={commit.isPending}
                title="Submits a regulation number that does not exist, to show the guard"
                className="rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Try a fabricated clause
              </button>
              <button
                onClick={() => commit.mutate(duties)}
                disabled={commit.isPending}
                className="rounded bg-emerald-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
              >
                {commit.isPending ? "Adding…" : `Add ${duties.length} to ledger`}
              </button>
            </div>
          }
        >
          <div className="-mx-4 -my-4 overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-left text-[11px] uppercase tracking-wide text-[var(--ink-soft)]">
                  <th className="px-4 py-2 font-medium">Duty</th>
                  <th className="px-3 py-2 font-medium">Owner</th>
                  <th className="px-3 py-2 font-medium">Frequency</th>
                  <th className="px-3 py-2 font-medium">Evidence</th>
                  <th className="px-4 py-2 font-medium">Citation</th>
                </tr>
              </thead>
              <tbody>
                {duties.map((d, i) => (
                  <tr key={i} className="border-b border-[var(--line)] last:border-0">
                    <td className="px-4 py-2">
                      <input
                        value={d.title}
                        onChange={(e) => patch(i, "title", e.target.value)}
                        className="w-full rounded border border-transparent px-1 py-0.5 text-sm hover:border-[var(--line)] focus:border-[var(--accent)] focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={d.owner_role}
                        onChange={(e) => patch(i, "owner_role", e.target.value)}
                        className="rounded border border-[var(--line)] px-1 py-0.5 text-xs"
                      >
                        {ROLES.map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={d.frequency}
                        onChange={(e) => patch(i, "frequency", e.target.value)}
                        className="rounded border border-[var(--line)] px-1 py-0.5 text-xs"
                      >
                        {FREQS.map((f) => (
                          <option key={f}>{f}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={d.evidence_type}
                        onChange={(e) => patch(i, "evidence_type", e.target.value)}
                        className="rounded border border-[var(--line)] px-1 py-0.5 text-xs"
                      >
                        {EVIDENCE.map((ev) => (
                          <option key={ev}>{ev}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <Clause>{d.clause_ref}</Clause>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {result && (
        <Panel title="4 · Result">
          {result.created.length > 0 && (
            <div className="mb-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-emerald-700">
                Added to the ledger
              </p>
              <ul className="divide-y divide-[var(--line)]">
                {result.created.map((o) => (
                  <li
                    key={o.id}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <div>
                      <div className="text-sm font-medium">{o.title}</div>
                      <Clause>{o.clause_ref}</Clause>
                    </div>
                    <Badge kind="verified">#{o.id}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.rejected.length > 0 && (
            <div className="rounded border border-red-200 bg-red-50 p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-red-800">
                Rejected by the system
              </p>
              <ul className="grid gap-1.5">
                {result.rejected.map((r) => (
                  <li key={r.index} className="text-sm text-red-900">
                    <span className="font-medium">
                      {r.title ?? `duty ${r.index}`}
                    </span>
                    {r.clause_ref && (
                      <>
                        {" "}
                        — cited <Clause>{r.clause_ref}</Clause>
                      </>
                    )}
                    <div className="mt-0.5 text-xs">
                      <code>{r.reason}</code>
                      {r.reason === "CLAUSE_NOT_IN_CORPUS"
                        ? " — that regulation number is not in the statutory corpus."
                        : " — an answer with no citation is not accepted."}
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-2 border-t border-red-200 pt-2 text-xs text-red-800">
                This is the answer to “what if the AI misreads a provision?”. It
                drafts and must cite, and the citation is checked against the
                corpus before anything enters the ledger.
              </p>
            </div>
          )}

          {result.created.length === 0 && result.rejected.length === 0 && (
            <Empty>Nothing submitted.</Empty>
          )}
        </Panel>
      )}
    </div>
  );
}
