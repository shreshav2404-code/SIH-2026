import { useQuery } from "@tanstack/react-query";
import { GeoJSON, MapContainer, TileLayer } from "react-leaflet";

import { api } from "../api/client";
import type { GeoBreach } from "../api/types";
import { Clause, Empty, Panel } from "../lib/ui";

export default function MapView() {
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
          </ul>
        </Panel>
      </div>
    </div>
  );
}
