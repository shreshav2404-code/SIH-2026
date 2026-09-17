import * as THREE from "three";

import { fbm, glowTexture, useThreeScene } from "./useThreeScene";

/**
 * A contour-line landscape drifting toward the viewer - a survey drawing of a
 * coalfield rather than a picture of one.
 *
 *   "login"   full screen, with the ANUPALAN headframe standing on a plateau
 *             and its sheave wheel turning; the camera leans with the mouse.
 *   "banner"  the same landscape, fainter and lower, behind a page's title.
 *             It sits over a photograph and a scrim, so it adds depth and
 *             movement without competing with the words.
 */

type Variant = "login" | "banner";

const ROWS = { login: 70, banner: 42 };
const COLS = { login: 150, banner: 110 };

function ridge(x: number, z: number): number {
  // Broad hills, a valley down the middle, and a flat cut where the pit is.
  const valley = 1 - Math.exp(-(x * x) / 180);
  const h = 3.2 * fbm(x * 0.045, z * 0.045, 5) * valley + 1.4 * valley;
  const pit = Math.exp(-((x + 9) ** 2 + (z + 20) ** 2) / 30);
  return h - 2.4 * pit;
}

export default function TerrainScene({ variant = "banner" }: { variant?: Variant }) {
  const ref = useThreeScene(({ scene, camera, pointer, reducedMotion }) => {
    const rows = ROWS[variant];
    const cols = COLS[variant];
    const width = variant === "login" ? 90 : 110;
    const depth = variant === "login" ? 80 : 60;
    const opacity = variant === "login" ? 0.55 : 0.32;

    scene.fog = new THREE.Fog(0x050d1a, variant === "login" ? 25 : 18, variant === "login" ? 85 : 60);

    // One polyline per row, drawn as segments so one draw call carries all.
    const segs = rows * (cols - 1);
    const positions = new Float32Array(segs * 2 * 3);
    const colors = new Float32Array(segs * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const lines = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false }),
    );
    scene.add(lines);

    const near = new THREE.Color(0x38bdf8);
    const far = new THREE.Color(0x1b3a66);
    const hot = new THREE.Color(0xf5a524);
    const col = new THREE.Color();

    // Heights are sampled once per row, not once per frame. The lines slide
    // toward the camera by a fraction of a row; when a whole row has passed,
    // every row moves up one slot and only the new far row is sampled. The
    // naive version sampled ~100k noise values a frame on the login screen.
    const spacing = depth / rows;
    const xs = Float32Array.from({ length: cols }, (_, c) => -width / 2 + (c / (cols - 1)) * width);
    const heights = new Float32Array(rows * cols);
    const sampleRow = (r: number, n: number) => {
      const worldZ = -depth + r * spacing - n * spacing;
      for (let c = 0; c < cols; c++) heights[r * cols + c] = ridge(xs[c], worldZ);
    };
    for (let r = 0; r < rows; r++) sampleRow(r, 0);

    const rebuild = () => {
      let p = 0;
      for (let r = 0; r < rows; r++) {
        const z = -depth + r * spacing;
        const nearness = r / rows;
        for (let c = 0; c < cols - 1; c++) {
          for (const cc of [c, c + 1]) {
            const y = heights[r * cols + cc];
            positions[p] = xs[cc];
            positions[p + 1] = y;
            positions[p + 2] = z;
            // Low ground glows amber (the seams), the rest is survey blue.
            col.copy(far).lerp(near, nearness);
            if (y < -1.2) col.lerp(hot, Math.min(1, (-1.2 - y) * 0.6));
            colors[p] = col.r;
            colors[p + 1] = col.g;
            colors[p + 2] = col.b;
            p += 3;
          }
        }
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    };
    rebuild();

    let rowsPassed = 0;
    const scrollTo = (scroll: number) => {
      const n = Math.floor(scroll / spacing);
      if (n !== rowsPassed) {
        const steps = n - rowsPassed;
        if (steps === 1) {
          heights.copyWithin(cols, 0, (rows - 1) * cols);
          sampleRow(0, n);
        } else {
          for (let r = 0; r < rows; r++) sampleRow(r, n);
        }
        rowsPassed = n;
        rebuild();
      }
      lines.position.z = scroll - n * spacing;
    };

    // ---- the headframe, login only
    let wheel: THREE.Mesh | null = null;
    const glow = glowTexture("rgba(56,189,248,1)");
    if (variant === "login") {
      const frame = new THREE.Group();
      const lineMat = new THREE.LineBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.95 });
      const leg = (from: THREE.Vector3, to: THREE.Vector3) =>
        frame.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, to]), lineMat));
      const top = new THREE.Vector3(0, 9, 0);
      leg(new THREE.Vector3(-3.2, 0, 1.2), top);
      leg(new THREE.Vector3(3.2, 0, 1.2), top);
      leg(new THREE.Vector3(-3.2, 0, -1.2), top);
      leg(new THREE.Vector3(3.2, 0, -1.2), top);
      for (const y of [2.5, 4.8, 6.8]) {
        const s = 1 - y / 9;
        leg(new THREE.Vector3(-3.2 * s, y, 1.2 * s), new THREE.Vector3(3.2 * s, y, 1.2 * s));
        leg(new THREE.Vector3(-3.2 * s, y, -1.2 * s), new THREE.Vector3(3.2 * s, y, -1.2 * s));
      }
      leg(new THREE.Vector3(-5, 0, 0), new THREE.Vector3(5, 0, 0));
      // rope down the shaft
      leg(new THREE.Vector3(1.6, 9.6, 0), new THREE.Vector3(1.6, 0, 0));

      wheel = new THREE.Mesh(
        new THREE.TorusGeometry(1.6, 0.08, 8, 48),
        new THREE.MeshBasicMaterial({ color: 0x7dd3fc }),
      );
      wheel.position.set(0, 9.6, 0);
      const spokes = new THREE.Group();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI;
        spokes.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
              new THREE.Vector3(Math.cos(a) * 1.6, Math.sin(a) * 1.6, 0),
              new THREE.Vector3(-Math.cos(a) * 1.6, -Math.sin(a) * 1.6, 0),
            ]),
            lineMat,
          ),
        );
      }
      wheel.add(spokes);
      frame.add(wheel);

      const beacon = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glow, color: 0xf5a524, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      beacon.position.set(0, 11.6, 0);
      beacon.scale.setScalar(2.2);
      frame.add(beacon);

      // In the gap between the brand column and the sign-in card, far enough
      // back to read as a landmark rather than an object on the page.
      frame.position.set(2, ridge(2, -44) + 0.2, -44);
      frame.rotation.y = -0.4;
      scene.add(frame);
    }

    // ---- sparse drifting motes
    const MOTES = variant === "login" ? 260 : 120;
    const mp = new Float32Array(MOTES * 3);
    for (let i = 0; i < MOTES; i++) {
      mp.set([(Math.random() - 0.5) * width, Math.random() * 14, -Math.random() * depth], i * 3);
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute("position", new THREE.BufferAttribute(mp, 3));
    scene.add(
      new THREE.Points(
        moteGeo,
        new THREE.PointsMaterial({
          map: glow,
          color: 0x9bdcff,
          size: variant === "login" ? 0.35 : 0.3,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      ),
    );

    const look = new THREE.Vector3(0, variant === "login" ? 3 : 1, -30);
    const speed = variant === "login" ? 2.2 : 1.4;

    return {
      update(t, dt) {
        if (!reducedMotion) scrollTo(t * speed);
        if (wheel) wheel.rotation.z -= dt * 0.9;
        const baseY = variant === "login" ? 9 : 7;
        camera.position.set(pointer.x * (variant === "login" ? 3 : 1.5), baseY - pointer.y * 1.2, 8);
        camera.lookAt(look);
        const m = moteGeo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < MOTES; i++) {
          let z = m.getZ(i) + dt * speed;
          if (z > 8) z = -depth;
          m.setZ(i, z);
        }
        m.needsUpdate = true;
      },
      dispose() {
        glow.dispose();
      },
    };
  });

  return <div ref={ref} className="absolute inset-0" aria-hidden="true" />;
}
