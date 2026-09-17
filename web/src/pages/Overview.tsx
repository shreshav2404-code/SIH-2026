import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
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
  Check,
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
import { item, stagger, useHeroReveal } from "../lib/motion";
import { PitBackdrop } from "../lib/three";
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

/**
 * Acknowledging an alert. The API has always accepted it, and the "open
 * critical alerts" count only counts unacknowledged ones - but nothing on
 * the dashboard or the phone could acknowledge, so that number could only
 * ever go up.
 */
function AckAlert({ alert }: { alert: Alert }) {
  const qc = useQueryClient();
  const ack = useMutation({
    mutationFn: async () => (await api.post<Alert>(`/alerts/${alert.id}/acknowledge`)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["alerts"] }),
  });

  if (alert.acknowledged_by)
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
        <Check size={12} /> acknowledged
      </span>
    );

  return (
    <button
      type="button"
      onClick={() => ack.mutate()}
      disabled={ack.isPending}
      className="rounded-md border border-[var(--line)] bg-white px-2 py-0.5 text-[11px] font-medium disabled:opacity-50"
    >
      {ack.isPending ? "Acknowledging…" : ack.isError ? "Retry acknowledge" : "Acknowledge"}
    </button>
  );
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
              stroke="#c42b2b"
              strokeDasharray="4 3"
              label={{
                value: `trigger ${data.stats.threshold}%`,
                fontSize: 10,
                fill: "#c42b2b",
                position: "insideTopRight",
              }}
            />
            <Line
              type="monotone"
              dataKey="v"
              stroke="#1b5bc4"
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
  const hero = useHeroReveal<HTMLElement>();
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
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {/* A bucket-wheel excavator on an open-cast bench - Pixabay
          (extraction-2781679) under the Pixabay licence: free for commercial
          use, no attribution required, no watermark. It says what this
          dashboard is about in the half-second before anyone reads a number,
          which is most of what a hero image is for. */}
      {/* The pit behind the title is drawn live (lib/three/PitScene): one red
          pin per overdue duty and one amber per duty due today, from the same
          counts as the cards below. The photograph stays underneath at low
          strength, so without WebGL the hero is still a finished picture. */}
      <section
        ref={hero}
        className="relative isolate min-h-[320px] overflow-hidden rounded-2xl bg-[var(--night-900)] shadow-[var(--shadow-lift)] ring-1 ring-black/5"
      >
        <div
          className="absolute inset-0 bg-cover bg-center opacity-25"
          style={{ backgroundImage: `url(${excavatorBg})` }}
        />
        <PitBackdrop markers={{ overdue, due: dueToday }} />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#081528] via-[#081528]/75 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#081528]/90 to-transparent" />

        <div className="relative flex min-h-[320px] flex-col justify-between gap-6 p-6 sm:p-8">
          <div className="max-w-xl">
            <p
              data-hero="eyebrow"
              className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.2em] text-sky-300/90 uppercase"
            >
              <span className="h-px w-6 bg-sky-300/70" />
              Gevra Open Cast · Korba, Chhattisgarh
            </p>
            <h1
              data-hero="title"
              className="mt-2 text-[30px] leading-[1.1] font-semibold tracking-tight text-white sm:text-[38px]"
            >
              Statutory compliance, continuously checked
            </h1>
            <p data-hero="body" className="mt-3 max-w-lg text-[14px] leading-relaxed text-sky-100/75">
              Duties tracked against the OSH Code 2020, the OSH (Central) Rules
              2026 and CMR 2017. Evidence hash-chained on capture. Thresholds
              checked by arithmetic, never by the model.
            </p>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-4">
            <div data-hero="body" className="flex flex-wrap gap-2 text-[11.5px] text-sky-100/80">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 backdrop-blur-sm">
                <span className="pulse-dot size-1.5 text-red-400" /> {overdue} overdue
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 backdrop-blur-sm">
                <span className="size-1.5 rounded-full bg-amber-400" /> {dueToday} due today
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 backdrop-blur-sm">
                <span className="h-0.5 w-3 rounded-full bg-[var(--amber)]" /> haul road
              </span>
            </div>

            <div
              data-hero="aside"
              className="glass-dark min-w-[210px] rounded-2xl border border-white/10 px-4 py-3 shadow-2xl"
            >
              <div className="flex items-center justify-between gap-4 text-[10.5px] font-semibold tracking-[0.14em] text-[var(--night-soft)] uppercase">
                Evidence chain
                <ShieldCheck size={14} className={chain?.ok === false ? "text-red-400" : "text-emerald-400"} />
              </div>
              <div
                className={`mt-1 text-[26px] leading-none font-semibold tracking-tight ${
                  chain?.ok === false ? "text-red-300" : "text-emerald-300"
                }`}
              >
                {chain ? (chain.ok ? "Intact" : "BROKEN") : "—"}
              </div>
              <div className="mt-1.5 text-[11.5px] text-[var(--night-soft)]">
                {chain ? `${chain.checked} records verified · ${critical} critical alert${critical === 1 ? "" : "s"}` : "checking…"}
              </div>
            </div>
          </div>
        </div>
      </section>

      <motion.div
        className="grid grid-cols-2 gap-3 lg:grid-cols-5"
        variants={stagger}
        initial="hidden"
        animate="show"
      >
        <motion.div variants={item}>
          <Stat label="Tracked duties" value={obligations?.total ?? "—"} icon={ListChecks} />
        </motion.div>
        <motion.div variants={item}>
          <Stat
            label="Overdue"
            value={overdue}
            tone={overdue ? "bad" : "good"}
            hint="past the statutory deadline"
            icon={AlertTriangle}
          />
        </motion.div>
        <motion.div variants={item}>
          <Stat label="Due today" value={dueToday} tone={dueToday ? "warn" : "default"} icon={CalendarClock} />
        </motion.div>
        <motion.div variants={item}>
          <Stat label="Open critical alerts" value={critical} tone={critical ? "bad" : "good"} icon={CircleAlert} />
        </motion.div>
        <motion.div variants={item}>
          <Stat
            label="Evidence chain"
            value={chain ? (chain.ok ? "Intact" : "BROKEN") : "—"}
            tone={chain ? (chain.ok ? "good" : "bad") : "default"}
            hint={chain ? `${chain.checked} records verified` : undefined}
            icon={ShieldCheck}
          />
        </motion.div>
      </motion.div>

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
        {/* Seven stages side by side are wider than a small screen; scroll them
            inside the panel rather than widening the whole page. */}
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <Lifecycle />
        </div>
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
                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                      <span className="mr-auto text-[11px] text-[var(--ink-soft)]">
                        {a.location ? `at ${a.location.replace(/_/g, " ")}` : ""}
                      </span>
                      <AckAlert alert={a} />
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
