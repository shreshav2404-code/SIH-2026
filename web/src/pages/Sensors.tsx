import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { api } from "../api/client";
import type { SensorWindow } from "../api/types";
import railsBg from "../assets/photos/rails-wide.jpg";
import { EmptyChart } from "../lib/brand";
import PageHero from "../lib/PageHero";
import { Clause, Empty, Panel } from "../lib/ui";

/**
 * Every stream the plant reports, on one page.
 *
 * The Overview shows methane alone because that is the demo moment. This is
 * the page an officer would actually keep open: all five streams, each with
 * the threshold that governs it and the clause the threshold comes from.
 *
 * Ordered by how fast each one can hurt somebody rather than alphabetically -
 * methane first because it is the one that explodes.
 */
const STREAMS: { type: string; label: string; unit: string }[] = [
  { type: "methane", label: "Methane", unit: "%" },
  { type: "strata_convergence", label: "Strata convergence", unit: "mm/24h" },
  { type: "vibration", label: "Ground vibration", unit: "mm/s" },
  { type: "pm10", label: "Respirable dust (PM10)", unit: "µg/m³" },
  { type: "water_level", label: "Water level", unit: "m" },
];

const WINDOWS = [15, 60, 180, 720];

function Stream({
  type,
  label,
  unit,
  minutes,
}: {
  type: string;
  label: string;
  unit: string;
  minutes: number;
}) {
  const { data } = useQuery({
    queryKey: ["window", type, minutes],
    queryFn: async () =>
      (
        await api.get<SensorWindow>("/sensors/window", {
          params: { sensor_type: type, window_minutes: minutes },
        })
      ).data,
    refetchInterval: 4000,
  });

  const breaching = data?.stats.breaching ?? false;
  const latest = data?.readings.at(-1)?.value;

  return (
    <Panel
      title={label}
      className={breaching ? "ring-2 ring-red-300" : undefined}
      right={
        <div className="flex items-baseline gap-2">
          <span
            className={`text-base font-semibold tabular-nums ${
              breaching ? "text-red-700" : "text-[var(--ink)]"
            }`}
          >
            {latest != null ? latest.toFixed(2) : "—"}
          </span>
          <span className="text-[11px] text-[var(--ink-soft)]">{unit}</span>
        </div>
      }
    >
      {!data || data.readings.length === 0 ? (
        <Empty art={<EmptyChart />}>
          No readings in this window — start <code>tools/sensor_sim.py</code>.
        </Empty>
      ) : (
        <>
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={data.readings.map((r) => ({
                  t: new Date(r.recorded_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                  v: r.value,
                }))}
                margin={{ top: 4, right: 8, bottom: 0, left: -20 }}
              >
                <defs>
                  <linearGradient id={`g-${type}`} x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor={breaching ? "#b3261e" : "#14539a"}
                      stopOpacity={0.28}
                    />
                    <stop
                      offset="100%"
                      stopColor={breaching ? "#b3261e" : "#14539a"}
                      stopOpacity={0.02}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#eef2f6" vertical={false} />
                <XAxis dataKey="t" tick={{ fontSize: 10 }} minTickGap={44} />
                {/* Keep the trigger in frame. An auto-fitted axis hides the
                    threshold exactly when readings are healthy, which is when
                    you most want to see the headroom. */}
                <YAxis
                  tick={{ fontSize: 10 }}
                  width={40}
                  domain={[
                    0,
                    (max: number) => Math.max(max, data.stats.threshold) * 1.15,
                  ]}
                />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 6 }}
                  formatter={(v) => [`${Number(v ?? 0)} ${unit}`, label]}
                />
                <ReferenceLine
                  y={data.stats.threshold}
                  stroke="#b3261e"
                  strokeDasharray="4 3"
                  label={{
                    value: `trigger ${data.stats.threshold}`,
                    fontSize: 10,
                    fill: "#b3261e",
                    position: "insideTopRight",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke={breaching ? "#b3261e" : "#14539a"}
                  strokeWidth={1.8}
                  fill={`url(#g-${type})`}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--line)] pt-2 text-[11px] text-[var(--ink-soft)]">
            <span>
              mean <b className="tabular-nums">{data.stats.mean}</b>
            </span>
            <span>
              max <b className="tabular-nums">{data.stats.max}</b>
            </span>
            <span>
              z-max <b className="tabular-nums">{data.stats.z_max}</b>
            </span>
            <span>
              trigger <b className="tabular-nums">{data.stats.threshold}</b>
            </span>
            {data.clause && <Clause>{data.clause.clause_ref}</Clause>}
          </div>
        </>
      )}
    </Panel>
  );
}

export default function Sensors() {
  const [minutes, setMinutes] = useState(60);

  return (
    <div className="grid gap-4">
      <PageHero
        image={railsBg}
        eyebrow="Plant telemetry"
        title="Every stream, against the threshold that governs it"
      >
        A breach is a rolling mean and a z-score compared with a static
        threshold table — arithmetic, checked the same way every time. No model
        is asked whether something is a hazard.
      </PageHero>

      <div className="flex items-center justify-end gap-2">
        <span className="text-[11px] tracking-wide text-[var(--ink-soft)] uppercase">
          Window
        </span>
        {WINDOWS.map((m) => (
          <button
            key={m}
            onClick={() => setMinutes(m)}
            className={`rounded-md border px-2.5 py-1 text-xs ${
              m === minutes
                ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                : "border-[var(--line)] hover:bg-slate-50"
            }`}
          >
            {m < 60 ? `${m}m` : `${m / 60}h`}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {STREAMS.map((s) => (
          <Stream key={s.type} {...s} minutes={minutes} />
        ))}
      </div>
    </div>
  );
}
