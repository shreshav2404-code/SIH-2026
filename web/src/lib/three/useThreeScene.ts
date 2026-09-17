import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * One way to put a three.js scene on a page.
 *
 * Every scene in the dashboard is decoration, so this hook's job is mostly to
 * make sure decoration never costs anything it should not:
 *
 *  - it draws only while the canvas is on screen and the tab is visible, so a
 *    hero scrolled out of view stops using the GPU;
 *  - with the system's reduce-motion setting it draws one still frame;
 *  - pixel ratio is capped, because a 3x laptop panel would otherwise render
 *    nine times the pixels for no visible gain behind a scrim;
 *  - if WebGL is unavailable it does nothing at all, and the page underneath
 *    (a photograph and a gradient) is already a finished design;
 *  - everything it created is disposed on unmount, so moving between pages
 *    does not leak GPU memory or WebGL contexts.
 *
 * Plain three.js rather than react-three-fiber: fiber pins React below 19.3,
 * and these scenes are small enough that the wrapper would be most of the
 * code.
 */

export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  /** Pointer position over the page, -1..1 on each axis, smoothed. */
  pointer: { x: number; y: number };
  reducedMotion: boolean;
}

export interface SceneHandle {
  /** Called every frame: `t` seconds since start, `dt` since last frame. */
  update?: (t: number, dt: number) => void;
  resize?: (width: number, height: number) => void;
  dispose?: () => void;
}

interface Options {
  fov?: number;
  maxDpr?: number;
}

export function useThreeScene<T extends HTMLElement = HTMLDivElement>(
  setup: (ctx: SceneContext) => SceneHandle,
  options: Options = {},
) {
  const ref = useRef<T>(null);
  // The latest setup is read once at mount; data that changes while mounted
  // is passed to scenes through refs, never by rebuilding the scene.
  const setupRef = useRef(setup);
  useEffect(() => {
    setupRef.current = setup;
  });
  const { fov = 40, maxDpr = 1.75 } = options;

  useEffect(() => {
    const host = ref.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      return; // No WebGL: the page behind is already complete.
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    renderer.setClearColor(0x000000, 0);
    const canvas = renderer.domElement;
    Object.assign(canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      display: "block",
      opacity: "0",
      transition: "opacity 900ms cubic-bezier(0.22, 1, 0.36, 1)",
    });
    host.appendChild(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 400);
    const target = { x: 0, y: 0 };
    const pointer = { x: 0, y: 0 };
    const handle = setupRef.current({ scene, camera, renderer, pointer, reducedMotion });

    const size = () => {
      const w = Math.max(1, host.clientWidth);
      const h = Math.max(1, host.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      handle.resize?.(w, h);
    };
    size();

    const clock = new THREE.Clock();
    let elapsed = 0;
    let raf = 0;
    let onScreen = true;
    let shown = false;

    const frame = () => {
      raf = 0;
      const dt = Math.min(clock.getDelta(), 0.05);
      elapsed += dt;
      pointer.x += (target.x - pointer.x) * 0.06;
      pointer.y += (target.y - pointer.y) * 0.06;
      handle.update?.(elapsed, dt);
      renderer.render(scene, camera);
      if (!shown) {
        shown = true;
        canvas.style.opacity = "1";
      }
      if (!reducedMotion) schedule();
    };

    const schedule = () => {
      if (raf || !onScreen || document.hidden) return;
      raf = requestAnimationFrame(frame);
    };

    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const ro = new ResizeObserver(() => {
      size();
      if (reducedMotion) frame();
    });
    ro.observe(host);

    const io = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        if (onScreen) {
          clock.getDelta(); // do not jump by the time spent off screen
          schedule();
        } else stop();
      },
      { threshold: 0 },
    );
    io.observe(host);

    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        clock.getDelta();
        schedule();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    const onPointer = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      target.x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      target.y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
    };
    if (!reducedMotion) window.addEventListener("pointermove", onPointer, { passive: true });

    // Still frames still have to show data that arrives after mount, so with
    // reduced motion the scene is redrawn once a second instead of animated.
    let still = 0;
    if (reducedMotion) {
      frame();
      still = window.setInterval(() => {
        if (onScreen && !document.hidden) frame();
      }, 1000);
    } else schedule();

    return () => {
      stop();
      window.clearInterval(still);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onPointer);
      handle.dispose?.();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
          for (const value of Object.values(m)) {
            if (value instanceof THREE.Texture) value.dispose();
          }
          m.dispose();
        }
      });
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    };
  }, [fov, maxDpr]);

  return ref;
}

/** A soft round glow, drawn once, for sprites and points. */
export function glowTexture(inner = "rgba(255,255,255,1)", outer = "rgba(255,255,255,0)"): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.35, inner.replace(/[\d.]+\)$/, "0.45)"));
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Smooth 2D value noise. Deterministic, so a terrain looks the same on every
 * load and a screenshot in the report matches the live page.
 */
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const h = (i: number, j: number) => {
    const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi);
  const b = h(xi + 1, yi);
  const c = h(xi, yi + 1);
  const d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** A few octaves of noise2, roughly -1..1. */
export function fbm(x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * (noise2(x * freq, y * freq) * 2 - 1);
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum;
}
