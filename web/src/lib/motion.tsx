import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { SplitText } from "gsap/SplitText";
import { motion, type Variants } from "motion/react";
import { useRef, type ReactNode } from "react";

gsap.registerPlugin(useGSAP, SplitText);

/**
 * Motion vocabulary for the dashboard.
 *
 * Two libraries, one job each, never on the same element:
 *   Framer Motion  anything React renders and re-renders - page transitions,
 *                  panels arriving, the nav pill, hover and press states.
 *   GSAP           sequences that run once over text and numbers - a hero
 *                  title arriving word by word, a statistic counting up.
 *
 * Durations are short on purpose. This is a tool people use for hours; an
 * animation that is charming the first time is a delay the fiftieth.
 */

export const EASE = [0.22, 1, 0.36, 1] as const;

export const page: Variants = {
  initial: { opacity: 0, y: 10 },
  enter: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE, when: "beforeChildren" } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.18, ease: "easeIn" } },
};

/** Fades a block up into place the first time it scrolls into view. */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -40px 0px" }}
      transition={{ duration: 0.45, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

/** Children with `variants={item}` arrive one after another. */
export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};

export const item: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } },
};

/**
 * A statistic that counts up to its value.
 *
 * Only numbers count; "Intact", "—" and anything else render as they are. A
 * later change counts from the old value to the new one, so a duty going
 * overdue is visible as the number moving, not just as a different number.
 */
export function CountUp({ value, className }: { value: ReactNode; className?: string }) {
  const el = useRef<HTMLSpanElement>(null);
  const from = useRef(0);

  useGSAP(
    () => {
      if (typeof value !== "number" || !el.current) return;
      const obj = { v: from.current };
      const mm = gsap.matchMedia();
      mm.add(
        {
          reduce: "(prefers-reduced-motion: reduce)",
          full: "(prefers-reduced-motion: no-preference)",
        },
        (ctx) => {
          const node = el.current!;
          const show = (n: number) => {
            node.textContent = Math.round(n).toLocaleString("en-IN");
          };
          if (ctx.conditions?.reduce) {
            show(value);
            from.current = value;
            return;
          }
          show(obj.v); // no empty frame before the tween's first tick
          gsap.to(obj, {
            v: value,
            duration: 1.1,
            ease: "power3.out",
            onUpdate: () => show(obj.v),
            onComplete: () => {
              from.current = value;
            },
          });
        },
      );
      return () => mm.revert();
    },
    { dependencies: [value] },
  );

  if (typeof value !== "number") return <span className={className}>{value}</span>;
  // No React child: GSAP owns this text node, and React writing to it on a
  // re-render would fight the tween.
  return <span ref={el} className={className} />;
}

/**
 * Hero text arriving: the eyebrow slides in, the title rises word by word,
 * the paragraph fades after it. Returns the ref for the container; mark the
 * parts with data-hero="eyebrow" | "title" | "body".
 */
export function useHeroReveal<T extends HTMLElement>(deps: unknown[] = []) {
  const scope = useRef<T>(null);

  useGSAP(
    () => {
      const root = scope.current;
      if (!root) return;
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const title = root.querySelector<HTMLElement>("[data-hero='title']");
        const split = title ? SplitText.create(title, { type: "words", mask: "words" }) : null;
        const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
        tl.from(root.querySelectorAll("[data-hero='eyebrow']"), { x: -14, opacity: 0, duration: 0.5 });
        if (split) tl.from(split.words, { yPercent: 110, opacity: 0, duration: 0.7, stagger: 0.045 }, "-=0.3");
        tl.from(root.querySelectorAll("[data-hero='body']"), { y: 8, opacity: 0, duration: 0.5 }, "-=0.45");
        tl.from(root.querySelectorAll("[data-hero='aside']"), { x: 16, opacity: 0, duration: 0.6 }, "-=0.5");
        return () => split?.revert();
      });
      return () => mm.revert();
    },
    { scope, dependencies: deps },
  );

  return scope;
}
