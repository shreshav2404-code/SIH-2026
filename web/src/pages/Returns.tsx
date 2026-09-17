import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api, apiError, openReport } from "../api/client";
import type { StatutoryReturn } from "../api/types";
import { useAuth } from "../lib/auth";
import { Badge, Clause, Empty, Panel } from "../lib/ui";
import seamBg from "../assets/photos/seam-wide.jpg";
import PageHero from "../lib/PageHero";

/**
 * What can be drafted, and for which period.
 *
 * The button used to draft EIA 2026-H1 and nothing else. That return was
 * signed on 4 September, so every press came back 409 - and the error was
 * never shown, so the button simply did nothing. The period is now the one
 * actually due, and a refusal is said out loud.
 */
const RETURN_KINDS = [
  {
    key: "EIA_HALF_YEARLY",
    label: "EIA half-yearly",
    // EC compliance reports cover April-September and October-March.
    period: (d: Date) => `${d.getFullYear()}-H${d.getMonth() < 6 ? 1 : 2}`,
  },
  {
    key: "CMR_ANNUAL",
    label: "CMR annual (Reg. 4)",
    // Due 1 February for the preceding year.
    period: (d: Date) => String(d.getFullYear() - 1),
  },
  {
    key: "OSH_ANNUAL",
    label: "OSH annual (FORM-XVII)",
    // Due by the last day of February for the preceding year.
    period: (d: Date) => String(d.getFullYear() - 1),
  },
] as const;

type ReturnKind = (typeof RETURN_KINDS)[number]["key"];

export default function Returns() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [selected, setSelected] = useState<number | null>(null);

  const { data } = useQuery({
    queryKey: ["returns"],
    queryFn: async () =>
      (await api.get<{ items: StatutoryReturn[] }>("/returns")).data.items,
  });

  const [kind, setKind] = useState<ReturnKind>(RETURN_KINDS[0].key);
  const chosen = RETURN_KINDS.find((k) => k.key === kind)!;
  const period = chosen.period(new Date());

  const draft = useMutation({
    mutationFn: async () =>
      (
        await api.post<StatutoryReturn>("/returns/draft", {
          mine_id: user?.mine_id ?? 1,
          period,
          return_type: kind,
        })
      ).data,
    onSuccess: (r) => {
      setSelected(r.id);
      qc.invalidateQueries({ queryKey: ["returns"] });
    },
  });

  const sign = useMutation({
    mutationFn: async (id: number) =>
      (
        // Empty body on purpose. The server takes the name and the
        // certificate number from the token. This used to send them, which
        // meant the browser chose whose name went on a statutory return - and
        // it sent one hardcoded certificate number whoever was signed in, so
        // any other officer signed under the mine manager's certificate.
        await api.post<StatutoryReturn>(`/returns/${id}/sign`, {})
      ).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["returns"] }),
  });

  const items = data ?? [];
  const current = items.find((r) => r.id === selected) ?? items[0] ?? null;
  // Any signed-in member of the team may sign, matching the API. The point
  // the flow makes is not WHICH role signed but that a named person did: the
  // signature records their name and their own certificate number, or none
  // if they hold none.
  const canSign = !!user;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <PageHero
        image={seamBg}
        eyebrow="Statutory returns"
        title="Drafted here, filed by a certificated officer"
      >
        Every return leaves this system stamped DRAFT — NOT FILED. It reaches
        the DGMS because someone signed it, never because software decided it
        was ready.
      </PageHero>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Panel
        title="Returns"
        right={
          current && (
            // The return as the document it becomes - draft-stamped until
            // signed. Nothing here files anything.
            <button
              onClick={() => void openReport(`/reports/return/${current.id}`)}
              className="rounded border border-[var(--line)] px-2 py-1 text-xs font-medium hover:bg-slate-50"
            >
              Print / PDF
            </button>
          )
        }
      >
        <div className="mb-3 grid gap-2 rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-2.5">
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as ReturnKind);
              draft.reset();
            }}
            className="rounded-md border border-[var(--line)] bg-white px-2 py-1.5 text-xs"
          >
            {RETURN_KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => draft.mutate()}
            disabled={draft.isPending}
            className="rounded-md bg-[var(--accent)] px-2 py-1.5 text-xs font-medium text-white disabled:opacity-60"
          >
            {draft.isPending ? "Drafting…" : `Draft ${period}`}
          </button>
          {draft.isError && (
            <p className="rounded-md bg-amber-50 px-2 py-1.5 text-[11.5px] text-amber-900">
              {apiError(draft.error)}
            </p>
          )}
        </div>
        {items.length === 0 ? (
          <Empty>No returns yet.</Empty>
        ) : (
          <ul className="-my-1 divide-y divide-[var(--line)]">
            {items.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => setSelected(r.id)}
                  className={`w-full px-1 py-2.5 text-left ${
                    current?.id === r.id ? "font-semibold" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm">{r.period}</span>
                    <Badge kind={r.locked ? "verified" : "pending"}>
                      {r.locked ? "signed" : "draft"}
                    </Badge>
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--ink-soft)]">
                    {r.return_type.replace(/_/g, " ").toLowerCase()}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {current ? (
        <Panel
          title={`${current.return_type.replace(/_/g, " ")} · ${current.period}`}
          right={
            current.locked ? (
              <span className="text-xs text-emerald-700">
                Signed by {current.signature_name}
              </span>
            ) : (
              <button
                onClick={() => sign.mutate(current.id)}
                disabled={!canSign || sign.isPending}
                title={
                  canSign
                    ? undefined
                    : "Only a certificated Mine Manager may sign"
                }
                className="rounded bg-emerald-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
              >
                {sign.isPending ? "Signing…" : "Review & sign"}
              </button>
            )
          }
        >
          {sign.isError && (
            <p className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-800">{apiError(sign.error)}</p>
          )}
          <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <strong>The AI never files.</strong> This draft is assembled from
            collected evidence and every figure cites its clause and source
            records. It becomes a statutory filing only when a certificated
            officer signs it.
          </div>

          <div className="mb-3 flex gap-6 text-xs text-[var(--ink-soft)]">
            <span>
              <strong className="text-[var(--ink)]">
                {current.draft_json?.obligations_covered ?? 0}
              </strong>{" "}
              obligations
            </span>
            <span>
              <strong className="text-[var(--ink)]">
                {current.draft_json?.evidence_count ?? 0}
              </strong>{" "}
              evidence records
            </span>
            {current.signed_at && (
              <span>signed {new Date(current.signed_at).toLocaleString()}</span>
            )}
          </div>

          <ul className="divide-y divide-[var(--line)]">
            {(current.draft_json?.sections ?? []).map((s, i) => (
              <li key={i} className="py-2.5">
                <p className="text-sm font-medium">{s.heading}</p>
                <p className="mt-0.5 text-sm text-[var(--ink-soft)]">{s.body}</p>
                <p className="mt-1">
                  {s.citations.map((c) => (
                    <Clause key={c.clause_ref}>
                      {c.clause_ref} · {c.figure}
                    </Clause>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      ) : (
        <Panel title="Return">
          <Empty>Draft a return to see it here.</Empty>
        </Panel>
      )}
      </div>
    </div>
  );
}
