import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone } from "lucide-react";
import { useState } from "react";

import { api } from "../api/client";
import type { Alert, Directive } from "../api/types";
import { Empty, Panel } from "./ui";

/**
 * Raising an instruction, and seeing whether anyone underground received it.
 *
 * The alert is arithmetic: a threshold was crossed. What this adds is the
 * decision about it, attributed to a person, and - the part that usually goes
 * missing - proof that somebody on site acknowledged it. An alert nobody acted
 * on and an alert somebody stood down look identical on a sensor chart.
 */

const ACTIONS = [
  { key: "WITHDRAW_MEN", label: "Withdraw all persons" },
  { key: "STOP_WORK", label: "Stop work" },
  { key: "EVACUATE", label: "Evacuate" },
  { key: "VENTILATE", label: "Restore ventilation" },
  { key: "INSPECT", label: "Inspect now" },
];

export function useDirectives() {
  return useQuery({
    queryKey: ["directives"],
    queryFn: async () => (await api.get<Directive[]>("/directives")).data,
    refetchInterval: 6000,
  });
}

export function RaiseDirective({ alert }: { alert: Alert }) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState(ACTIONS[0].key);
  const [message, setMessage] = useState("");
  const qc = useQueryClient();

  const raise = useMutation({
    mutationFn: async () =>
      api.post("/directives", {
        alert_id: alert.id,
        severity: alert.severity,
        action,
        message: message.trim(),
      }),
    onSuccess: () => {
      setOpen(false);
      setMessage("");
      void qc.invalidateQueries({ queryKey: ["directives"] });
    },
  });

  if (!open)
    return (
      <button
        onClick={() => {
          // Pre-fill from the alert. The officer is confirming a decision, not
          // composing prose while a threshold is being exceeded.
          setMessage(
            `${alert.message} Act on this and report back when the reading is inside the limit.`,
          );
          setOpen(true);
        }}
        className="flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--line)] px-2 py-1 text-[11px] font-medium text-[var(--ink-soft)] hover:border-[var(--crit)] hover:text-[var(--crit)]"
      >
        <Megaphone size={13} />
        Instruct site
      </button>
    );

  return (
    <div className="mt-2 grid gap-2 rounded-lg border border-[var(--line)] bg-slate-50/70 p-3">
      <select
        value={action}
        onChange={(e) => setAction(e.target.value)}
        className="rounded-md border border-[var(--line)] bg-white px-2 py-1.5 text-[12px]"
      >
        {ACTIONS.map((a) => (
          <option key={a.key} value={a.key}>
            {a.label}
          </option>
        ))}
      </select>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        className="rounded-md border border-[var(--line)] bg-white px-2 py-1.5 text-[12px]"
      />
      <div className="flex justify-end gap-2">
        <button
          onClick={() => setOpen(false)}
          className="rounded-md border border-[var(--line)] px-2.5 py-1 text-[12px] hover:bg-white"
        >
          Cancel
        </button>
        <button
          onClick={() => raise.mutate()}
          disabled={raise.isPending || !message.trim()}
          className="rounded-md bg-[var(--crit)] px-2.5 py-1 text-[12px] font-medium text-white disabled:opacity-40"
        >
          {raise.isPending ? "Sending…" : "Send to handsets"}
        </button>
      </div>
    </div>
  );
}

export function DirectiveLog() {
  const { data } = useDirectives();
  const items = data ?? [];

  return (
    <Panel title="Instructions to site">
      {items.length === 0 ? (
        <Empty>
          Nothing issued. Raise one from an alert and it appears on every
          handset at this mine until an officer acknowledges it.
        </Empty>
      ) : (
        <ul className="-my-1 divide-y divide-[var(--line)]">
          {items.slice(0, 8).map((d) => {
            const acked = d.acknowledged_at != null;
            return (
              <li key={d.id} className="flex items-start gap-3 py-2.5">
                <span
                  className={`mt-0.5 w-1 shrink-0 self-stretch rounded-full ${
                    acked ? "bg-emerald-500" : "bg-red-500"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[12px] font-semibold tracking-wide uppercase">
                      {d.action?.replace(/_/g, " ") ?? "Instruction"}
                    </span>
                    {d.location_label && (
                      <span className="text-[11px] text-[var(--ink-soft)]">
                        {d.location_label}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[13px]">{d.message}</p>
                  <p className="mt-1 text-[11px] text-[var(--ink-soft)]">
                    {d.issued_by_name ?? "control room"} ·{" "}
                    {new Date(d.created_at).toLocaleTimeString()}
                    {acked ? (
                      <span className="ml-2 font-medium text-emerald-700">
                        acknowledged by {d.acknowledged_by_name} at{" "}
                        {new Date(d.acknowledged_at!).toLocaleTimeString()}
                      </span>
                    ) : (
                      <span className="ml-2 font-medium text-red-700">
                        waiting for acknowledgement
                      </span>
                    )}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
