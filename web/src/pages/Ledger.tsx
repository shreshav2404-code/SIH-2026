import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { api } from "../api/client";
import type { Obligation, Page } from "../api/types";
import { useAuth } from "../lib/auth";
import { Badge, Clause, Empty, Panel, RiskBar } from "../lib/ui";

const STATUSES = ["", "overdue", "due", "pending", "submitted", "verified"];

/** The statuses a person may set by hand. */
const SETTABLE = ["pending", "due", "overdue", "submitted", "verified", "waived"];

/**
 * Roles a duty can be assigned to.
 *
 * A free-text box here would quietly fragment the register - "Safety Officer",
 * "safety officer" and "Sfty Officer" are three different owners as far as
 * every query in this system is concerned, and the mobile app groups by this
 * string. A fixed list is the difference between a register you can filter and
 * a register you cannot.
 */
const ROLES = [
  "Mine Manager",
  "Safety Officer",
  "Ventilation Officer",
  "Environment Officer",
  "Medical Officer",
  "Surveyor",
  "Workmen's Inspector",
  "Electrical Supervisor",
];

const FREQUENCIES = [
  "daily",
  "weekly",
  "fortnightly",
  "monthly",
  "quarterly",
  "half_yearly",
  "annual",
  "one_off",
];

const EVIDENCE_TYPES = [
  "photo",
  "register_entry",
  "diary_entry",
  "meeting_minutes",
  "survey",
  "return_filing",
  "certificate",
];

interface Statute {
  id: number;
  act: string;
  clause_ref: string;
  title: string;
}

type Draft = {
  id?: number;
  statute_id: number;
  title: string;
  owner_role: string;
  frequency: string;
  evidence_type: string;
  due_date: string;
  status: string;
  /** Display only, on edit. The clause a duty cites cannot be changed. */
  clause_ref?: string;
};

const BLANK: Draft = {
  statute_id: 0,
  title: "",
  owner_role: ROLES[0],
  frequency: "monthly",
  evidence_type: "photo",
  due_date: "",
  status: "pending",
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium tracking-wide text-[var(--ink-soft)] uppercase">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

const INPUT =
  "w-full rounded-md border border-[var(--line)] px-2.5 py-1.5 text-sm " +
  "focus:border-[var(--accent)] focus:outline-none";

function DutyDialog({
  draft,
  statutes,
  saving,
  error,
  onChange,
  onSave,
  onClose,
}: {
  draft: Draft;
  statutes: Statute[];
  saving: boolean;
  error: string | null;
  onChange: (d: Draft) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const editing = draft.id != null;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-[var(--panel)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b border-[var(--line)] px-4 py-3">
          <h2 className="text-sm font-semibold">
            {editing ? "Edit duty" : "New duty"}
          </h2>
          <p className="mt-0.5 text-[11px] text-[var(--ink-soft)]">
            {editing
              ? "The clause cannot be changed — a duty pointing at a different clause is a different duty."
              : "Every duty is anchored to the clause that creates it."}
          </p>
        </header>

        <div className="grid gap-3 px-4 py-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Clause">
              {editing ? (
                <p className="clause py-1.5">{draft.clause_ref}</p>
              ) : (
                <select
                  className={INPUT}
                  value={draft.statute_id}
                  onChange={(e) =>
                    onChange({ ...draft, statute_id: Number(e.target.value) })
                  }
                >
                  <option value={0}>Select a clause…</option>
                  {statutes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.clause_ref} — {s.title}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field label="Title">
              <input
                className={INPUT}
                value={draft.title}
                onChange={(e) => onChange({ ...draft, title: e.target.value })}
                placeholder="What has to be done"
              />
            </Field>
          </div>

          <Field label="Assigned to">
            <select
              className={INPUT}
              value={draft.owner_role}
              onChange={(e) => onChange({ ...draft, owner_role: e.target.value })}
            >
              {ROLES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </Field>

          <Field label="Frequency">
            <select
              className={INPUT}
              value={draft.frequency}
              onChange={(e) => onChange({ ...draft, frequency: e.target.value })}
            >
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {f.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Evidence required">
            <select
              className={INPUT}
              value={draft.evidence_type}
              onChange={(e) =>
                onChange({ ...draft, evidence_type: e.target.value })
              }
            >
              {EVIDENCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Due date">
            <input
              type="date"
              className={INPUT}
              value={draft.due_date}
              onChange={(e) => onChange({ ...draft, due_date: e.target.value })}
            />
          </Field>

          {editing && (
            <Field label="Status">
              <select
                className={INPUT}
                value={draft.status}
                onChange={(e) => onChange({ ...draft, status: e.target.value })}
              >
                {SETTABLE.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
          )}
        </div>

        {error && (
          <p className="mx-4 mb-3 rounded-md bg-red-50 px-3 py-2 text-[12px] text-red-800">
            {error}
          </p>
        )}

        <footer className="flex justify-end gap-2 border-t border-[var(--line)] px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-md border border-[var(--line)] px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving || !draft.title || (!editing && !draft.statute_id)}
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {saving ? "Saving…" : editing ? "Save changes" : "Create duty"}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default function Ledger() {
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<"due_date" | "risk">("due_date");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { user } = useAuth();
  // A regulator inspects the register; the API refuses their writes, so the
  // buttons that would only produce a 403 are not shown to them.
  const canWrite = user?.role === "mine_manager" || user?.role === "safety_officer";
  const canDelete = user?.role === "mine_manager";

  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["obligations", status, sort],
    queryFn: async () => {
      const { data } = await api.get<Page<Obligation>>("/obligations", {
        params: { status: status || undefined, sort, limit: 200 },
      });
      return data;
    },
  });

  const { data: statutes } = useQuery({
    queryKey: ["statutes"],
    queryFn: async () => (await api.get<Statute[]>("/rulebook/statutes")).data,
    staleTime: 5 * 60_000,
  });

  /** Anything that changed the register invalidates the pages built on it. */
  function refresh() {
    void qc.invalidateQueries({ queryKey: ["obligations"] });
    void qc.invalidateQueries({ queryKey: ["duties"] });
  }

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const body = {
        title: d.title,
        owner_role: d.owner_role,
        frequency: d.frequency,
        evidence_type: d.evidence_type,
        due_date: d.due_date || null,
      };
      if (d.id != null) {
        await api.patch(`/obligations/${d.id}`, { ...body, status: d.status });
      } else {
        await api.post("/obligations", {
          ...body,
          statute_id: d.statute_id,
          mine_id: user?.mine_id,
        });
      }
    },
    onSuccess: () => {
      setDraft(null);
      setError(null);
      refresh();
    },
    onError: (e: unknown) => setError(apiError(e)),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => api.delete(`/obligations/${id}`),
    onSuccess: refresh,
    // Deleting a duty that still has evidence is refused with a 409 and a
    // sentence explaining why. That sentence is the useful part, so it is
    // shown rather than swallowed into a generic failure.
    onError: (e: unknown) => window.alert(apiError(e)),
  });

  const items = data?.items ?? [];

  return (
    <>
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
            {canWrite && (
              <button
                onClick={() => {
                  setError(null);
                  setDraft({ ...BLANK });
                }}
                className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-white"
              >
                <Plus size={14} />
                New duty
              </button>
            )}
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
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-left text-[11px] tracking-wide text-[var(--ink-soft)] uppercase">
                  <th className="px-4 py-2 font-medium">Duty</th>
                  <th className="px-3 py-2 font-medium">Owner</th>
                  <th className="px-3 py-2 font-medium">Frequency</th>
                  <th className="px-3 py-2 font-medium">Due</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Evidence</th>
                  <th className="px-4 py-2 font-medium">Risk</th>
                  {canWrite && <th className="px-3 py-2 font-medium"></th>}
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
                    {canWrite && (
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            title="Edit or reassign"
                            onClick={() => {
                              setError(null);
                              setDraft({
                                id: o.id,
                                statute_id: 0,
                                clause_ref: o.clause_ref,
                                title: o.title,
                                owner_role: o.owner_role,
                                frequency: o.frequency,
                                evidence_type: o.evidence_type,
                                due_date: o.due_date ?? "",
                                status: o.status,
                              });
                            }}
                            className="rounded p-1.5 text-[var(--ink-soft)] hover:bg-slate-100 hover:text-[var(--accent)]"
                          >
                            <Pencil size={14} />
                          </button>
                          {canDelete && (
                            <button
                              title="Delete duty"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Delete "${o.title}"? This removes it from the register.`,
                                  )
                                )
                                  remove.mutate(o.id);
                              }}
                              className="rounded p-1.5 text-[var(--ink-soft)] hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {draft && (
        <DutyDialog
          draft={draft}
          statutes={statutes ?? []}
          saving={save.isPending}
          error={error}
          onChange={setDraft}
          onSave={() => save.mutate(draft)}
          onClose={() => {
            setDraft(null);
            setError(null);
          }}
        />
      )}
    </>
  );
}

/** The API's own sentence, when it sent one. Axios' default message never is. */
function apiError(e: unknown): string {
  const detail = (e as { response?: { data?: { detail?: string } } })?.response
    ?.data?.detail;
  return detail ?? (e instanceof Error ? e.message : String(e));
}
