import type { ReactNode } from "react";

import { useHeroReveal } from "./motion";
import { TerrainBackdrop } from "./three";

/**
 * The dark strip at the top of a page.
 *
 * One component rather than hand-rolled banners, so every page gets the same
 * height, scrim, type scale and motion. Inconsistent hero treatments are what
 * make a dashboard look assembled rather than designed.
 *
 * Three layers, back to front: the photograph, a navy scrim, and a faint 3D
 * contour landscape drifting toward the viewer. The scrim is not optional -
 * these are dark photographs with bright patches, and white type over an
 * unscrimmed photo is legible only where the photo happens to cooperate. The
 * 3D sits over the scrim at low opacity, so it adds depth without costing
 * the words any contrast, and if WebGL is missing the strip is still whole.
 */
export default function PageHero({
  image,
  eyebrow,
  title,
  children,
  aside,
}: {
  image: string;
  eyebrow: string;
  title: string;
  children?: ReactNode;
  /** Optional right-hand block: a status, a count, an action. */
  aside?: ReactNode;
}) {
  const scope = useHeroReveal<HTMLElement>([title]);

  return (
    <section
      ref={scope}
      className="relative isolate overflow-hidden rounded-2xl bg-[var(--night-900)] bg-cover bg-center shadow-[var(--shadow-lift)] ring-1 ring-black/5"
      style={{ backgroundImage: `url(${image})` }}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-[#081528]/95 via-[#081528]/80 to-[#081528]/45" />
      <div className="hero-grid absolute inset-0 opacity-60 [mask-image:linear-gradient(to_right,transparent,black_40%)]" />
      <div className="absolute inset-0 opacity-80 [mask-image:linear-gradient(to_right,transparent_10%,black_55%)]">
        <TerrainBackdrop variant="banner" />
      </div>
      <div className="relative flex flex-wrap items-end justify-between gap-4 px-6 py-6">
        <div className="max-w-3xl">
          <p
            data-hero="eyebrow"
            className="flex items-center gap-2 text-[10.5px] font-semibold tracking-[0.2em] text-sky-300/90 uppercase"
          >
            <span className="h-px w-5 bg-sky-300/70" />
            {eyebrow}
          </p>
          <h1 data-hero="title" className="mt-1.5 text-[22px] leading-tight font-semibold tracking-tight text-white sm:text-[26px]">
            {title}
          </h1>
          {children && (
            <p data-hero="body" className="mt-2 max-w-2xl text-[13px] leading-relaxed text-sky-100/75">
              {children}
            </p>
          )}
        </div>
        {aside && <div data-hero="aside">{aside}</div>}
      </div>
    </section>
  );
}
