import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../api/client";
import type { Obligation, Page } from "../api/types";
import { Badge, Clause, Empty, Panel, RiskBar } from "../lib/ui";

const STATUSES = ["", "overdue", "due", "pending", "submitted", "verified"];

export default function Ledger() {
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<"due_date" | "risk">("due_date");

  const { data, isLoading } = useQuery({
    queryKey: ["obligations", status, sort],
    queryFn: async () => {
      const { data } = await api.get<Page<Obligation>>("/obligations", {
        params: { status: status || undefined, sort, limit: 200 },
      });
      return data;
    },
  });

  const items = data?.items ?? [];

  return (
    <Panel
      title="Obligation ledger"
      right={
        <div className="flex items-center gap-2">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded border border-[var(--line)] px-2 py-1 text-xs"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === "" ? "All statuses" : s}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as "due_date" | "risk")}
            className="rounded border border-[var(--line)] px-2 py-1 text-xs"
          >
            <option value="due_date">By due date</option>
            <option value="risk">By risk</option>
          </select>
        </div>
      }
      className="overflow-hidden"
    >
      {isLoading ? (
        <Empty>Loading the ledger…</Empty>
      ) : items.length === 0 ? (
        <Empty>No obligations match.</Empty>
      ) : (
        <div className="-mx-4 -my-4 overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-left text-[11px] uppercase tracking-wide text-[var(--ink-soft)]">
                <th className="px-4 py-2 font-medium">Duty</th>
                <th className="px-3 py-2 font-medium">Owner</th>
                <th className="px-3 py-2 font-medium">Frequency</th>
                <th className="px-3 py-2 font-medium">Due</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Evidence</th>
                <th className="px-4 py-2 font-medium">Risk</th>
              </tr>
            </thead>
            <tbody>
              {items.map((o) => (
                <tr
                  key={o.id}
                  className="border-b border-[var(--line)] last:border-0 hover:bg-slate-50/60"
                >
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{o.title}</div>
                    {/* The citation is the point — never hide it. */}
                    <Clause>{o.clause_ref}</Clause>
                  </td>
                  <td className="px-3 py-2.5 text-[var(--ink-soft)]">
                    {o.owner_role}
                  </td>
                  <td className="px-3 py-2.5 text-[var(--ink-soft)]">
                    {o.frequency.replace(/_/g, " ")}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-[var(--ink-soft)]">
                    {o.due_date ?? "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge kind={o.status}>{o.status}</Badge>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-[var(--ink-soft)]">
                    {o.evidence_count}
                  </td>
                  <td className="px-4 py-2.5">
                    <RiskBar score={o.risk_score} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
