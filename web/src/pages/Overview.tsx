import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  AlertTriangle,
  CalendarClock,
  CircleAlert,
  ListChecks,
  ShieldCheck,
} from "lucide-react";

import { api } from "../api/client";
import type {
  Alert,
  Obligation,
  Page,
  SensorWindow,
  VerifyResult,
} from "../api/types";
import excavatorBg from "../assets/photos/excavator-wide.jpg";
import { EmptyAlerts, EmptyChart } from "../lib/brand";
import { DirectiveLog, RaiseDirective } from "../lib/Directives";
import Lifecycle from "../lib/lifecycle";
import { Badge, Clause, Empty, Panel, Stat } from "../lib/ui";

function useAlerts() {
  return useQuery({
    queryKey: ["alerts"],
    queryFn: async () =>
      (await api.get<{ items: Alert[] }>("/alerts", { params: { limit: 20 } }))
        .data.items,
    refetchInterval: 4000,
  });
}

function MethaneChart() {
  const { data } = useQuery({
    queryKey: ["window", "methane"],
    queryFn: async () =>
      (
        await api.get<SensorWindow>("/sensors/window", {
          params: { sensor_type: "methane", window_minutes: 60 },
        })
      ).data,
    refetchInterval: 3000,
  });

  if (!data || data.readings.length === 0)
    return (
      <Empty art={<EmptyChart />}>
        No readings yet — start <code>tools/sensor_sim.py</code> and the trace
        appears within seconds.
      </Empty>
    );

  const rows = data.readings.map((r) => ({
    t: new Date(r.recorded_at).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    v: r.value,
  }));

  return (
    <>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="#eef2f6" vertical={false} />
            <XAxis dataKey="t" tick={{ fontSize: 10 }} minTickGap={40} />
            {/* Always keep the trigger in frame. An auto-fitted axis hides the
                threshold line whenever readings are healthy, which is exactly
                when you want to see the headroom. */}
            <YAxis
              tick={{ fontSize: 10 }}
              width={38}
              domain={[0, (max: number) => Math.max(max, data.stats.threshold) * 1.15]}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 6 }}
              // Recharts types the value as ValueType | undefined, so it cannot
              // be narrowed to number in the signature.
              formatter={(v) => [`${Number(v ?? 0)} %`, "CH₄"]}
            />
            <ReferenceLine
              y={data.stats.threshold}
              stroke="#b3261e"
              strokeDasharray="4 3"
              label={{
                value: `trigger ${data.stats.threshold}%`,
                fontSize: 10,
                fill: "#b3261e",
                position: "insideTopRight",
              }}
            />
            <Line
              type="monotone"
              dataKey="v"
              stroke="#14539a"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {data.clause && (
        <p className="mt-2 border-t border-[var(--line)] pt-2 text-xs text-[var(--ink-soft)]">
          Governed by <Clause>{data.clause.clause_ref}</Clause> — detection is a
          rolling mean plus z-score against a static threshold, not a model.
        </p>
      )}
    </>
  );
}

export default function Overview() {
  const { data: alerts } = useAlerts();

  const { data: obligations } = useQuery({
    queryKey: ["obligations", "overview"],
    queryFn: async () =>
      (await api.get<Page<Obligation>>("/obligations", { params: { limit: 300 } }))
        .data,
  });

  const { data: chain } = useQuery({
    queryKey: ["verify"],
    queryFn: async () =>
      (await api.get<VerifyResult>("/evidence/verify")).data,
    refetchInterval: 10000,
  });

  const items = obligations?.items ?? [];
  const overdue = items.filter((o) => o.status === "overdue").length;
  const dueToday = items.filter((o) => o.status === "due").length;
  const critical = (alerts ?? []).filter(
    (a) => a.severity === "critical" && !a.acknowledged_by,
  ).length;

  return (
    <div className="grid gap-4">
      {/* A bucket-wheel excavator on an open-cast bench - Pixabay
          (extraction-2781679) under the Pixabay licence: free for commercial
          use, no attribution required, no watermark. It says what this
          dashboard is about in the half-second before anyone reads a number,
          which is most of what a hero image is for. */}
      <section
        className="relative overflow-hidden rounded-xl bg-cover bg-center shadow-sm"
        style={{ backgroundImage: `url(${excavatorBg})` }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-[#0f2942]/92 via-[#0f2942]/70 to-[#0f2942]/25" />
        <div className="relative flex flex-wrap items-end justify-between gap-4 px-5 py-6">
          <div>
            <p className="text-[11px] font-medium tracking-[0.18em] text-sky-200/80 uppercase">
              Gevra Open Cast · Korba, Chhattisgarh
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
              Statutory compliance, continuously checked
            </h1>
            <p className="mt-1 max-w-xl text-[13px] text-sky-100/80">
              Duties tracked against the Mines Act and its regulations. Evidence
              hash-chained on capture. Thresholds checked by arithmetic, never
              by the model.
            </p>
          </div>
          <div className="rounded-lg bg-white/10 px-3 py-2 text-right backdrop-blur-sm">
            <div className="text-[10px] tracking-wide text-sky-100/80 uppercase">
              Evidence chain
            </div>
            <div
              className={`text-lg font-semibold ${
                chain?.ok === false ? "text-red-300" : "text-emerald-300"
              }`}
            >
              {chain ? (chain.ok ? "Intact" : "BROKEN") : "—"}
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat
          label="Tracked duties"
          value={obligations?.total ?? "—"}
          icon={ListChecks}
        />
        <Stat
          label="Overdue"
          value={overdue}
          tone={overdue ? "bad" : "good"}
          hint="past the statutory deadline"
          icon={AlertTriangle}
        />
        <Stat
          label="Due today"
          value={dueToday}
          tone={dueToday ? "warn" : "default"}
          icon={CalendarClock}
        />
        <Stat
          label="Open critical alerts"
          value={critical}
          tone={critical ? "bad" : "good"}
          icon={CircleAlert}
        />
        <Stat
          label="Evidence chain"
          value={chain ? (chain.ok ? "Intact" : "BROKEN") : "—"}
          tone={chain ? (chain.ok ? "good" : "bad") : "default"}
          hint={chain ? `${chain.checked} records verified` : undefined}
          icon={ShieldCheck}
        />
      </div>

      {chain && !chain.ok && chain.first_broken && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>Evidence chain broken</strong> at record #
          {chain.first_broken.evidence_id}. Expected{" "}
          <code className="text-[11px]">
            {chain.first_broken.expected.slice(0, 16)}…
          </code>
          , found{" "}
          <code className="text-[11px]">
            {chain.first_broken.found.slice(0, 16)}…
          </code>
          . A record was altered after capture.
        </div>
      )}

      <Panel title="Where compliance attaches to the mining cycle">
        <Lifecycle />
      </Panel>

      <DirectiveLog />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Methane — last 60 minutes">
          <MethaneChart />
        </Panel>

        <Panel title="Alerts">
          {!alerts || alerts.length === 0 ? (
            <Empty art={<EmptyAlerts />}>
              Nothing triggered. Run the simulator and press “m” to inject a
              methane spike.
            </Empty>
          ) : (
            <ul className="-my-1 divide-y divide-[var(--line)]">
              {alerts.slice(0, 7).map((a) => (
                <li key={a.id} className="flex items-start gap-3 py-2.5">
                  {/* A coloured rail per row. Seven identical amber badges in a
                      column is a wall of text; the rail gives the eye an edge
                      to run down and makes a critical row jump out. */}
                  <span
                    className={`mt-0.5 w-1 shrink-0 self-stretch rounded-full ${
                      a.severity === "critical"
                        ? "bg-red-500"
                        : a.severity === "warning"
                          ? "bg-amber-400"
                          : "bg-sky-400"
                    }`}
                  />
                  <Badge kind={a.severity}>{a.severity}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{a.message}</p>
                    <p className="mt-0.5">
                      {/* Every alert names the clause it threatens — that link
                          is what makes this a compliance alert. */}
                      <Clause>{a.clause_ref ?? "no clause linked"}</Clause>
                      <span className="ml-2 text-[11px] text-[var(--ink-soft)]">
                        {new Date(a.created_at).toLocaleTimeString()}
                      </span>
                    </p>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-[var(--ink-soft)]">
                        {a.location ? `at ${a.location.replace(/_/g, " ")}` : ""}
                      </span>
                      <RaiseDirective alert={a} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
