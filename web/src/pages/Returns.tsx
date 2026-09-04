import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api, openReport } from "../api/client";
import type { StatutoryReturn } from "../api/types";
import { useAuth } from "../lib/auth";
import { Badge, Clause, Empty, Panel } from "../lib/ui";

export default function Returns() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [selected, setSelected] = useState<number | null>(null);

  const { data } = useQuery({
    queryKey: ["returns"],
    queryFn: async () =>
      (await api.get<{ items: StatutoryReturn[] }>("/returns")).data.items,
  });

  const draft = useMutation({
    mutationFn: async () =>
      (
        await api.post<StatutoryReturn>("/returns/draft", {
          mine_id: user?.mine_id ?? 1,
          period: "2026-H1",
          return_type: "EIA_HALF_YEARLY",
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
        await api.post<StatutoryReturn>(`/returns/${id}/sign`, {
          signature_name: user?.full_name ?? "Officer",
          certificate_no: "MGR/2019/4471",
        })
      ).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["returns"] }),
  });

  const items = data ?? [];
  const current = items.find((r) => r.id === selected) ?? items[0] ?? null;
  const canSign = user?.role === "mine_manager";

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Panel
        title="Returns"
            right={
              <div className="flex items-center gap-2">
                {/* The return as the document it becomes - draft-stamped
                    until signed. Nothing here files anything. */}
                <button
                  onClick={() => void openReport(`/reports/return/${current.id}`)}
                  className="rounded border border-[var(--line)] px-2 py-1 text-xs font-medium hover:bg-slate-50"
                >
                  Print / PDF
                </button>
            <button
              onClick={() => draft.mutate()}
              disabled={draft.isPending}
              className="rounded bg-[var(--accent)] px-2 py-1 text-xs font-medium text-white disabled:opacity-60"
            >
              {draft.isPending ? "Drafting…" : "Draft EIA H1"}
            </button>
              </div>
            }
      >
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
                Review &amp; sign
              </button>
            )
          }
        >
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
  );
}
