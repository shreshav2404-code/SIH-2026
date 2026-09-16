import { useQuery } from "@tanstack/react-query";
import {
  Cpu,
  FileText,
  Image as ImageIcon,
  ImageOff,
  MapPin,
  Maximize2,
  Ruler,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { api, openReport } from "../api/client";
import { useAuth } from "../lib/auth";
import { Badge, Clause, Empty, Panel } from "../lib/ui";
import undergroundBg from "../assets/photos/underground-wide.jpg";
import PageHero from "../lib/PageHero";

/**
 * The evidence a regulator would actually want to look at - and why.
 *
 * Captures were being stored, hash-chained and screened, and then shown to
 * nobody. Once they were shown, each card still could not answer the three
 * questions anyone reviewing a photograph asks first: what is this evidence
 * OF, where exactly was it taken, and is anything wrong with it. The API now
 * returns the duty and clause, the address and GPS accuracy, and a review
 * block with every reason and where that reason came from.
 *
 * Two display bugs went with the rewrite. The card read `confidence` when the
 * API sends `conf`, so every detection showed 0%; and it read a `verdict`
 * field the API has never sent, so the badge said "pass" on every photo,
 * including two black frames and a flat grey placeholder.
 */

interface Detection {
  label: string;
  conf: number;
  /** [x1, y1, x2, y2] as fractions of the image. Absent on old captures. */
  box?: [number, number, number, number];
}

interface Problem {
  code: string;
  text: string;
  because?: string | null;
}

interface VisionResult {
  pass?: boolean | null;
  problems?: Problem[];
  detections?: Detection[];
  scope?: string;
  error?: string;
}

type ReasonSource = "measured" | "geometry" | "model";

interface EvidenceRow {
  id: number;
  mine_id: number;
  mine_name: string;
  obligation_id: number;
  duty_title: string;
  clause_ref: string;
  act: string;
  evidence_type: string;
  observation: string | null;
  lat: number;
  lon: number;
  gps_accuracy_m: number | null;
  place: { source?: "device" | "osm"; pincode?: string } | null;
  place_line: string | null;
  captured_at: string;
  inside_lease: boolean | null;
  vision_result: VisionResult | null;
  summary: string;
  ai_description: string | null;
  ai_problems: string[] | null;
  ai_model: string | null;
  review: { needed: boolean; reasons: { text: string; source: ReasonSource }[] };
  photo_sha256: string | null;
  prev_hash: string | null;
  chain_hash: string;
  has_photo: boolean;
}

/**
 * Where a reason came from, said plainly. The first two are arithmetic a
 * reviewer can re-check; the third is a small vision model's reading of the
 * photograph, and presenting it with the same weight would be dishonest.
 */
const SOURCE: Record<ReasonSource, { label: string; cls: string }> = {
  measured: { label: "measured", cls: "bg-slate-100 text-slate-700" },
  geometry: { label: "boundary check", cls: "bg-slate-100 text-slate-700" },
  model: { label: "on-device model", cls: "bg-violet-50 text-violet-800" },
};

/**
 * The photo endpoint requires a bearer token, so a plain `<img src>` cannot
 * load it - the browser would send no Authorization header and get a 401.
 * Fetch it through the same axios client as everything else and hand the
 * `<img>` an object URL instead.
 */
function usePhotoUrl(id: number, has: boolean) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!has) return;
    let url: string | null = null;
    let cancelled = false;

    api
      .get(`/evidence/${id}/photo`, { responseType: "blob" })
      .then((r) => {
        if (cancelled) return;
        url = URL.createObjectURL(r.data as Blob);
        setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      // An object URL pins its blob in memory until revoked, and this list can
      // hold dozens of photographs.
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, has]);

  return { src, failed };
}

/**
 * The photograph with every detection drawn where it was found.
 *
 * The image is shown WHOLE (object-contain), never cropped. The boxes are
 * fractions of the full frame, so on a cropped image they would point at the
 * wrong thing - and a box around the wrong object is worse than no box.
 * The wrapper shrinks to the rendered image, so percentages land exactly.
 */
function BoxedPhoto({
  src,
  detections,
  alt,
  large = false,
}: {
  src: string;
  detections: Detection[];
  alt: string;
  large?: boolean;
}) {
  return (
    <div className="relative inline-block">
      <img
        src={src}
        alt={alt}
        className={
          large
            ? "block max-h-[80vh] max-w-[90vw]"
            : "block max-h-48 max-w-full"
        }
      />
      {detections
        .filter((d) => d.box)
        .map((d, i) => {
          const [x1, y1, x2, y2] = d.box!;
          return (
            <div
              key={i}
              className="pointer-events-none absolute rounded-sm border-2 border-amber-400"
              style={{
                left: `${x1 * 100}%`,
                top: `${y1 * 100}%`,
                width: `${(x2 - x1) * 100}%`,
                height: `${(y2 - y1) * 100}%`,
              }}
            >
              <span
                className={`absolute left-0 top-0 -translate-y-full whitespace-nowrap rounded-t-sm bg-amber-400 px-1 font-semibold text-black ${
                  large ? "text-[12px]" : "text-[9px]"
                }`}
              >
                {d.label} {Math.round(d.conf * 100)}%
              </span>
            </div>
          );
        })}
    </div>
  );
}

function PhotoPanel({ row }: { row: EvidenceRow }) {
  const { src, failed } = usePhotoUrl(row.id, row.has_photo);
  const [open, setOpen] = useState(false);
  const detections = row.vision_result?.detections ?? [];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // A flat grey rectangle reads as a broken image. These states are drawn
  // instead, so "this capture is a written observation" looks deliberate -
  // which it is; not every duty is evidenced by a photograph.
  const shell =
    "flex h-48 w-full flex-col items-center justify-center gap-1.5 " +
    "bg-gradient-to-b from-slate-50 to-slate-100 text-[11px] text-[var(--ink-soft)]";

  if (!row.has_photo)
    return (
      <div className={shell}>
        <FileText size={22} className="opacity-45" />
        <span>observation only — no photograph</span>
      </div>
    );
  if (failed)
    return (
      <div className={shell}>
        <ImageOff size={22} className="opacity-45" />
        <span>photo unavailable</span>
      </div>
    );
  if (!src)
    return (
      <div className={`${shell} animate-pulse`}>
        <ImageIcon size={22} className="opacity-45" />
        <span>loading…</span>
      </div>
    );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative flex h-48 w-full items-center justify-center bg-slate-900"
        title="Open full size"
      >
        <BoxedPhoto src={src} detections={detections} alt={`Evidence ${row.id}`} />
        <span className="absolute right-2 top-2 rounded bg-black/55 p-1 text-white opacity-0 transition group-hover:opacity-100">
          <Maximize2 size={14} />
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Evidence ${row.id}, full size`}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/85 p-4"
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded bg-white/10 p-1.5 text-white hover:bg-white/20"
            onClick={() => setOpen(false)}
            aria-label="Close"
          >
            <X size={18} />
          </button>
          <div onClick={(e) => e.stopPropagation()}>
            <BoxedPhoto
              src={src}
              detections={detections}
              alt={`Evidence ${row.id}`}
              large
            />
          </div>
          <p className="max-w-3xl text-center text-[13px] text-white/85">
            <strong>{row.duty_title}</strong> · {row.summary}
          </p>
        </div>
      )}
    </>
  );
}

/** The part that answers "is anything wrong with this photo, and says why". */
function Explanation({ row }: { row: EvidenceRow }) {
  const { needed, reasons } = row.review;
  // A cloud reading means the photo left the phone. That is recorded on the
  // capture by the model name, and it is said here rather than letting a
  // cloud model's answer sit under the on-device label.
  const cloud = row.ai_model?.includes("(cloud)") ?? false;
  const modelSource = cloud ? "cloud model" : "on-device model";

  return (
    <div className="space-y-2 px-3 py-2">
      <p className="text-[12px] font-medium leading-snug">{row.summary}</p>

      {needed ? (
        <div className="rounded-md border border-amber-200 bg-amber-50/70 p-2">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-900">
            <TriangleAlert size={13} />
            Needs a human look
          </div>
          <ul className="space-y-1">
            {reasons.map((r, i) => (
              <li key={i} className="text-[12px] leading-snug text-amber-950">
                {r.text}{" "}
                <span
                  className={`ml-0.5 whitespace-nowrap rounded px-1 py-px text-[10px] font-medium ${SOURCE[r.source].cls}`}
                >
                  {r.source === "model" ? modelSource : SOURCE[r.source].label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="text-[11px] text-green-800">
          No problems found by the checks that ran.
        </div>
      )}

      {row.ai_description && (
        <div className="rounded-md border border-violet-200 bg-violet-50/60 p-2">
          <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-violet-900">
            <Cpu size={12} />
            {cloud ? "What the cloud model saw" : "What the phone's model saw"}
          </div>
          <p className="text-[12px] leading-snug text-violet-950">
            {row.ai_description}
          </p>
          <p className="mt-1 text-[10px] text-violet-800/80">
            {row.ai_model ?? "on-device vision model"} ·{" "}
            {cloud
              ? "photo sent from the phone because the on-device model could not decide"
              : "read offline at capture"}{" "}
            · a description, not a compliance verdict
          </p>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 border-t border-[var(--line)] px-3 py-1.5 text-[12px]">
      <span className="w-20 shrink-0 text-[var(--ink-soft)]">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

export default function Evidence() {
  const { user } = useAuth();
  const mineId = user?.mine_id ?? 1;

  const { data: rows, isLoading } = useQuery({
    queryKey: ["evidence", mineId],
    queryFn: async () =>
      (await api.get<EvidenceRow[]>("/evidence", { params: { mine_id: mineId } }))
        .data,
    refetchInterval: 10_000,
  });

  const { data: chain } = useQuery({
    queryKey: ["evidence-verify", mineId],
    queryFn: async () =>
      (
        await api.get<{
          ok: boolean;
          broken_at?: number | null;
          checked: number;
        }>("/evidence/verify", { params: { mine_id: mineId } })
      ).data,
    refetchInterval: 15_000,
  });

  const flagged = (rows ?? []).filter((r) => r.review.needed).length;

  return (
    <div className="space-y-4">
      <PageHero
        image={undergroundBg}
        eyebrow="Field capture"
        title="Evidence, hashed at the moment it was taken"
      >
        Every capture stores the previous record's hash for this mine. Alter one
        row and every hash after it stops matching — which is what makes
        back-dating detectable rather than merely discouraged.
      </PageHero>

      <Panel
        title="Evidence chain"
        right={
          <div className="flex items-center gap-2">
            {chain && (
              <Badge kind={chain.ok ? "verified" : "critical"}>
                {chain.ok ? "chain intact" : "chain broken"}
              </Badge>
            )}
            <button
              type="button"
              onClick={() => void openReport(`/reports/compliance/${mineId}`)}
              className="rounded border border-[var(--line)] px-2 py-1 text-[11px] font-medium hover:bg-slate-50"
            >
              Compliance report
            </button>
          </div>
        }
      >
        <p className="text-[13px] text-[var(--ink-soft)]">
          Each capture is hashed onto the one before it, per mine. Editing a row
          in the database breaks every hash after it, which is what makes
          back-dating detectable rather than merely discouraged. The address,
          the detections and the model's description are worked out FROM the
          hashed photo and coordinates, so they sit outside the chain and can
          be re-derived and checked against it.
        </p>
        {chain && (
          <p className="mt-2 text-[12px]">
            {chain.checked} record{chain.checked === 1 ? "" : "s"} verified
            {chain.ok
              ? "."
              : ` — first break at evidence #${chain.broken_at ?? "?"}.`}
          </p>
        )}
      </Panel>

      <Panel
        title="Captures"
        right={
          rows && rows.length > 0 ? (
            <Badge kind={flagged ? "warning" : "verified"}>
              {flagged
                ? `${flagged} of ${rows.length} need a look`
                : `all ${rows.length} clear`}
            </Badge>
          ) : undefined
        }
      >
        {isLoading && (
          <span className="text-[13px] text-[var(--ink-soft)]">loading…</span>
        )}

        {!isLoading && (!rows || rows.length === 0) && (
          <Empty>
            No evidence captured yet. Capture a duty in the field app and it
            appears here within ten seconds.
          </Empty>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(rows ?? []).map((e) => (
            <article
              key={e.id}
              className={`overflow-hidden rounded-lg border bg-[var(--panel)] ${
                e.review.needed ? "border-amber-300" : "border-[var(--line)]"
              }`}
            >
              <PhotoPanel row={e} />

              {/* What this is evidence OF. The first question, answered first. */}
              <div className="border-b border-[var(--line)] px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <strong className="text-[13px] leading-snug">{e.duty_title}</strong>
                  <span className="shrink-0 text-[11px] text-[var(--ink-soft)]">
                    #{e.id}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px]">
                  {/* Some clause references already open with their act
                      ("Mines Rules 1955 · R. 29-T") and some do not ("EC
                      condition · ..."). Prefixing blindly printed the act
                      twice on half the cards. */}
                  <Clause>
                    {e.clause_ref.startsWith(e.act)
                      ? e.clause_ref
                      : `${e.act} · ${e.clause_ref}`}
                  </Clause>
                </div>
                <div className="mt-0.5 text-[11px] text-[var(--ink-soft)]">
                  {new Date(e.captured_at).toLocaleString()}
                </div>
              </div>

              <Explanation row={e} />

              {e.observation && (
                <Field label="Officer">
                  <span className="leading-relaxed">{e.observation}</span>
                </Field>
              )}

              <Field label="Place">
                <span className="flex items-start gap-1">
                  <MapPin size={12} className="mt-0.5 shrink-0 opacity-60" />
                  <span>
                    {e.place_line ?? (
                      <span className="text-[var(--ink-soft)]">
                        address not looked up
                      </span>
                    )}
                    <span className="block text-[11px] text-[var(--ink-soft)]">
                      {e.mine_name}
                      {/* ODbL requires the credit wherever OSM data is shown.
                          An address from the phone's own geocoder is not
                          OSM data and is not labelled as if it were. */}
                      {e.place?.source === "osm" && (
                        <> · address © OpenStreetMap contributors</>
                      )}
                      {e.place?.source === "device" && <> · address from the phone</>}
                    </span>
                  </span>
                </span>
              </Field>

              <Field label="GPS">
                <span className="font-mono text-[11px]">
                  {e.lat.toFixed(5)}, {e.lon.toFixed(5)}
                </span>{" "}
                {e.gps_accuracy_m != null && (
                  <span className="inline-flex items-center gap-0.5 text-[11px] text-[var(--ink-soft)]">
                    <Ruler size={11} />±{Math.round(e.gps_accuracy_m)} m
                  </span>
                )}{" "}
                {e.inside_lease === null ? (
                  <span className="text-[11px] text-[var(--ink-soft)]">
                    lease unchecked
                  </span>
                ) : (
                  <Badge kind={e.inside_lease ? "verified" : "critical"}>
                    {e.inside_lease ? "inside lease" : "outside lease"}
                  </Badge>
                )}
              </Field>

              <Field label="Chain">
                <Clause>{e.chain_hash.slice(0, 20)}…</Clause>
              </Field>

              <Field label="Previous">
                <Clause>
                  {e.prev_hash ? `${e.prev_hash.slice(0, 20)}…` : "genesis"}
                </Clause>
              </Field>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}
