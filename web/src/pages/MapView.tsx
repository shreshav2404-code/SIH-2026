import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CircleMarker, GeoJSON, MapContainer, Popup, TileLayer } from "react-leaflet";

import { COALFIELDS, TYPE_COLOUR } from "../lib/coalfields";

import { api } from "../api/client";
import type { GeoBreach } from "../api/types";
import { Clause, Empty, Panel } from "../lib/ui";

interface EvidenceRow {
  id: number;
  lat: number;
  lon: number;
  inside_lease: boolean | null;
  observation: string | null;
  captured_at: string;
}

/**
 * India's coalfields on real tiles.
 *
 * Replaces the instinct to paste a picture of a map. Coordinates are facts, so
 * this ships nobody's copyrighted graphic, zooms, and can carry our own data -
 * the field holding the demo mine is marked rather than being just another dot.
 */
function IndiaView() {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <Panel title="Major coalfields of India" className="overflow-hidden">
        <div className="-m-4 h-[520px]">
          <MapContainer center={[22.5, 81.5]} zoom={5} className="h-full w-full">
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />
            {COALFIELDS.map((f) => (
              <CircleMarker
                key={f.name}
                center={[f.lat, f.lon]}
                radius={f.demo ? 10 : 7}
                pathOptions={{
                  color: f.demo ? "#0f2942" : TYPE_COLOUR[f.type],
                  fillColor: TYPE_COLOUR[f.type],
                  fillOpacity: 0.75,
                  weight: f.demo ? 3 : 1.5,
                }}
              >
                <Popup>
                  <div className="text-[12px]">
                    <div className="font-semibold">{f.name}</div>
                    <div className="text-[var(--ink-soft)]">
                      {f.state} · {f.operator}
                    </div>
                    <div className="mt-1 capitalize">{f.type}</div>
                    {f.demo && (
                      <div className="mt-1 font-semibold text-[#14539a]">
                        This deployment — Gevra OC
                      </div>
                    )}
                  </div>
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>
      </Panel>

      <div className="grid content-start gap-4">
        <Panel title="Legend">
          <ul className="grid gap-2 text-xs">
            {(["coking", "non-coking", "lignite"] as const).map((t) => (
              <li key={t} className="flex items-center gap-2 capitalize">
                <span
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: TYPE_COLOUR[t] }}
                />
                {t}
              </li>
            ))}
            <li className="flex items-center gap-2 border-t border-[var(--line)] pt-2">
              <span className="size-3.5 shrink-0 rounded-full border-2 border-[#0f2942] bg-[#14539a]" />
              This deployment
            </li>
          </ul>
          <p className="mt-2 border-t border-[var(--line)] pt-2 text-[11px] text-[var(--ink-soft)]">
            Each point is the approximate CENTRE of a coalfield, not a mine head.
            A field spans tens of kilometres. The only surveyed geometry here is
            the lease polygon in PostGIS, which is what every compliance check
            actually uses.
          </p>
        </Panel>

        <Panel title={`${COALFIELDS.length} fields`}>
          <ul className="grid gap-1.5 text-[12px]">
            {COALFIELDS.map((f) => (
              <li key={f.name} className="flex items-baseline justify-between gap-2">
                <span className={f.demo ? "font-semibold" : ""}>{f.name}</span>
                <span className="text-[11px] text-[var(--ink-soft)]">
                  {f.operator}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

export default function MapView() {
  const [view, setView] = useState<"lease" | "india">("lease");

  // Captures, plotted where they were actually taken. The Evidence page proves
  // a photograph exists; this proves it was taken inside the lease - which is
  // the half of "evidence-backed" that a table cannot show.
  const { data: captures } = useQuery({
    queryKey: ["evidence", "map"],
    // NOTE: /evidence returns a bare array, not the {items,total} envelope the
    // obligations endpoints use. Reading .items here silently yielded
    // undefined and drew no pins at all.
    queryFn: async () =>
      (await api.get<EvidenceRow[]>("/evidence", { params: { limit: 200 } })).data,
    refetchInterval: 10000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["geo", "breach"],
    queryFn: async () => (await api.get<GeoBreach>("/geo/breach")).data,
  });

  if (isLoading) return <Panel title="Lease boundary"><Empty>Loading map…</Empty></Panel>;
  if (!data) return <Panel title="Lease boundary"><Empty>No lease geometry.</Empty></Panel>;

  // Centre on the lease. Coordinates are GeoJSON [lon, lat].
  const ring = (data.lease.coordinates?.[0] ?? []) as number[][];
  const lats = ring.map((p) => p[1]);
  const lons = ring.map((p) => p[0]);
  const centre: [number, number] = [
    (Math.min(...lats) + Math.max(...lats)) / 2,
    (Math.min(...lons) + Math.max(...lons)) / 2,
  ];

  return (
    <div className="grid gap-4">
      {/* Two scales of the same question. The national view answers "where is
          Indian coal?", the lease view answers "did work stay inside the
          boundary?" - and only the second one is a compliance check. */}
      <div className="flex items-center gap-2">
        {(
          [
            ["lease", "This mine"],
            ["india", "All India"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setView(k)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
              view === k
                ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                : "border-[var(--line)] hover:bg-slate-50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "india" ? (
        <IndiaView />
      ) : (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Panel title="Lease boundary and excavation" className="overflow-hidden">
        <div className="-m-4 h-[520px]">
          <MapContainer center={centre} zoom={12} className="h-full w-full">
            {/* OpenStreetMap, not Google — free, no API key, no billing. */}
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />
            <GeoJSON
              key="lease"
              data={data.lease as never}
              style={{ color: "#14539a", weight: 2, fillOpacity: 0.06 }}
            />
            {data.excavation && (
              <GeoJSON
                key="excavation"
                data={data.excavation as never}
                style={{
                  color: "#9a5c00",
                  weight: 2,
                  dashArray: "5 4",
                  fillOpacity: 0.08,
                }}
              />
            )}
            {data.outside && (
              <GeoJSON
                key="outside"
                data={data.outside as never}
                style={{ color: "#b3261e", weight: 2, fillOpacity: 0.45 }}
              />
            )}
            {(captures ?? []).map((e) => (
              <CircleMarker
                key={e.id}
                center={[e.lat, e.lon]}
                radius={6}
                pathOptions={{
                  // Colour carries the boundary verdict, so a capture taken
                  // outside the lease is visible before anything is clicked.
                  color: e.inside_lease === false ? "#b3261e" : "#17734a",
                  fillColor: e.inside_lease === false ? "#b3261e" : "#17734a",
                  fillOpacity: 0.85,
                  weight: 2,
                }}
              >
                <Popup>
                  <div className="text-[12px]">
                    <div className="font-semibold">Capture #{e.id}</div>
                    <div className="mt-0.5 text-[var(--ink-soft)]">
                      {new Date(e.captured_at).toLocaleString()}
                    </div>
                    {e.observation && <p className="mt-1">{e.observation}</p>}
                    <div className="mt-1">
                      {e.inside_lease === false ? (
                        <span className="font-semibold text-red-700">
                          OUTSIDE LEASE
                        </span>
                      ) : (
                        <span className="font-semibold text-emerald-700">
                          inside lease
                        </span>
                      )}
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-[var(--ink-soft)]">
                      {e.lat.toFixed(5)}, {e.lon.toFixed(5)}
                    </div>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>
      </Panel>

      <div className="grid content-start gap-4">
        <Panel title="Boundary check">
          {data.breach ? (
            <>
              <p className="text-sm font-semibold text-red-700">
                Excavation crosses the lease boundary
              </p>
              <dl className="mt-3 grid gap-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-[var(--ink-soft)]">Area outside</dt>
                  <dd className="font-semibold tabular-nums">
                    {(data.area_outside_m2 / 10000).toLocaleString(undefined, {
                      maximumFractionDigits: 1,
                    })}{" "}
                    ha
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[var(--ink-soft)]">Clause</dt>
                  <dd>
                    <Clause>{data.clause_ref}</Clause>
                  </dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="text-sm font-semibold text-emerald-700">
              Excavation contained within the lease
            </p>
          )}

          <p className="mt-3 border-t border-[var(--line)] pt-3 text-xs text-[var(--ink-soft)]">
            Computed by PostGIS <code>ST_Difference</code> and{" "}
            <code>ST_Contains</code>. Geometry is a fact, not an opinion — no
            model is involved in this check.
          </p>
        </Panel>

        <Panel title="Legend">
          <ul className="grid gap-2 text-xs">
            <li className="flex items-center gap-2">
              <span className="h-3 w-6 rounded-sm border-2 border-[#14539a] bg-[#14539a]/10" />
              Sanctioned lease
            </li>
            <li className="flex items-center gap-2">
              <span className="h-3 w-6 rounded-sm border-2 border-dashed border-[#9a5c00] bg-[#9a5c00]/10" />
              Excavation extent
            </li>
            <li className="flex items-center gap-2">
              <span className="h-3 w-6 rounded-sm border-2 border-[#b3261e] bg-[#b3261e]/45" />
              Outside the lease
            </li>
            <li className="flex items-center gap-2 border-t border-[var(--line)] pt-2">
              <span className="size-3 shrink-0 rounded-full bg-[#17734a]" />
              Capture inside the lease
            </li>
            <li className="flex items-center gap-2">
              <span className="size-3 shrink-0 rounded-full bg-[#b3261e]" />
              Capture outside the lease
            </li>
          </ul>
          <p className="mt-2 border-t border-[var(--line)] pt-2 text-[11px] text-[var(--ink-soft)]">
            Each dot is a geo-tagged photograph taken on the handset. Position
            comes from the capture, and the colour from PostGIS
            <code className="ml-1">ST_Contains</code> — not from what the
            officer typed.
          </p>
        </Panel>
      </div>
    </div>
      )}
    </div>
  );
}
