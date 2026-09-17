import { lazy, Suspense } from "react";

import type { ChainData } from "./ChainScene";
import type { PitMarkers } from "./PitScene";

/**
 * three.js is about 600 KB, and nobody should download it to read a table.
 * Each scene is its own chunk, fetched only when a page that shows it mounts;
 * until it arrives the page shows what it always showed - a photograph under
 * a scrim - so the 3D fades in over a finished design rather than filling a
 * hole.
 */

const Pit = lazy(() => import("./PitScene"));
const Terrain = lazy(() => import("./TerrainScene"));
const Chain = lazy(() => import("./ChainScene"));

export function PitBackdrop({ markers }: { markers: PitMarkers }) {
  return (
    <Suspense fallback={null}>
      <Pit markers={markers} />
    </Suspense>
  );
}

export function TerrainBackdrop({ variant }: { variant: "login" | "banner" }) {
  return (
    <Suspense fallback={null}>
      <Terrain variant={variant} />
    </Suspense>
  );
}

export function ChainView({ data }: { data: ChainData }) {
  return (
    <Suspense fallback={null}>
      <Chain data={data} />
    </Suspense>
  );
}

export type { ChainData, PitMarkers };
