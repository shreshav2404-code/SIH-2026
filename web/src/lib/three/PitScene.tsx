import { useEffect, useRef } from "react";
import * as THREE from "three";

import { fbm, glowTexture, useThreeScene } from "./useThreeScene";

/**
 * An open-cast coal pit, drawn from arithmetic.
 *
 * Terraced benches stepping down to a coal floor, a haul road spiralling out
 * of it with dumpers climbing, an excavator working the bottom, and an
 * overburden dump beside the rim - the shape of Gevra or any large Indian
 * open-cast mine, recognisable without a single licensed asset.
 *
 * The glowing pins are the ledger: one red pin per overdue duty, one amber
 * per duty due today. They read the live counts from a ref, so a duty going
 * overdue adds a pin without rebuilding the scene.
 */

export interface PitMarkers {
  overdue: number;
  due: number;
}

const PIT_DEPTH = 6.5;
const FLOOR_R = 3.2;
const RIM_R = 15;
const BENCHES = 7;

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Terrain height at (x, z). The same function places the road and the pins. */
function heightAt(x: number, z: number): number {
  // A slightly oval pit whose edge wanders, as real pit shells do.
  const wobble = 1 + 0.08 * fbm(x * 0.08 + 3, z * 0.08 - 2, 3);
  const r = Math.hypot(x * 0.92, z * 1.08) / wobble;

  let h: number;
  if (r <= FLOOR_R) {
    h = -PIT_DEPTH;
  } else if (r < RIM_R) {
    // Benches: a steep face then a flat berm, repeated.
    const t = (r - FLOOR_R) / (RIM_R - FLOOR_R);
    const k = t * BENCHES;
    const step = Math.floor(k);
    const face = smoothstep(0.0, 0.3, k - step);
    h = -PIT_DEPTH + (PIT_DEPTH * (step + face)) / BENCHES;
  } else {
    h = 0.35 * fbm(x * 0.07, z * 0.07, 4) + 0.25 * smoothstep(RIM_R, RIM_R + 8, r);
  }

  // The overburden dump: a flat-topped mound east of the pit.
  const dump = Math.hypot(x - 21, z + 7);
  h += 2.6 * smoothstep(9, 4, dump);

  return h;
}

export default function PitScene({ markers }: { markers: PitMarkers }) {
  const live = useRef(markers);
  useEffect(() => {
    live.current = markers;
  });

  const ref = useThreeScene(({ scene, camera, pointer, reducedMotion }) => {
    scene.fog = new THREE.Fog(0x081528, 34, 90);

    // ---- light: low warm sun raking across the benches, cool sky fill
    scene.add(new THREE.HemisphereLight(0x9cc7ff, 0x1a1208, 1.05));
    const sun = new THREE.DirectionalLight(0xffd6a0, 2.2);
    sun.position.set(-18, 14, 10);
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0x38bdf8, 0.6);
    rim.position.set(15, 6, -18);
    scene.add(rim);

    // ---- terrain
    const SIZE = 64;
    const SEG = 200;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const coal = new THREE.Color("#161c26");
    const benchA = new THREE.Color("#7a6246");
    const benchB = new THREE.Color("#5d4a36");
    const rimCol = new THREE.Color("#4a5646");
    const dumpCol = new THREE.Color("#6f6a5e");
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = heightAt(x, z);
      pos.setY(i, y);
      const r = Math.hypot(x * 0.92, z * 1.08);
      if (y < -PIT_DEPTH + 0.15) c.copy(coal);
      else if (r < RIM_R + 0.5) {
        const band = Math.floor(((y + PIT_DEPTH) / PIT_DEPTH) * BENCHES);
        c.copy(band % 2 ? benchA : benchB).lerp(coal, Math.max(0, -y / PIT_DEPTH) * 0.35);
      } else if (y > 0.9) c.copy(dumpCol);
      else c.copy(rimCol);
      c.offsetHSL(0, 0, (fbm(x * 0.6, z * 0.6, 2)) * 0.03);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 }),
    );
    scene.add(ground);

    // A faint survey grid over the ground: the "digital twin" read.
    const wireGeo = new THREE.PlaneGeometry(SIZE, SIZE, 64, 64);
    wireGeo.rotateX(-Math.PI / 2);
    const wp = wireGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < wp.count; i++) wp.setY(i, heightAt(wp.getX(i), wp.getZ(i)) + 0.04);
    const wire = new THREE.Mesh(
      wireGeo,
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true, transparent: true, opacity: 0.07 }),
    );
    scene.add(wire);

    // ---- haul road: a spiral from the rim to the floor, following the ground
    const roadPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 160; i++) {
      const s = i / 160;
      const a = 0.6 + s * Math.PI * 2.35;
      const r = RIM_R + 1.5 - s * (RIM_R + 1.5 - FLOOR_R - 0.6);
      const x = Math.cos(a) * r / 0.92;
      const z = Math.sin(a) * r / 1.08;
      roadPts.push(new THREE.Vector3(x, heightAt(x, z) + 0.12, z));
    }
    const road = new THREE.CatmullRomCurve3(roadPts);
    scene.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(road, 320, 0.14, 6, false),
        new THREE.MeshBasicMaterial({ color: 0xf5a524, transparent: true, opacity: 0.85 }),
      ),
    );

    // ---- dumpers climbing the road
    const truckGeo = new THREE.BoxGeometry(0.7, 0.36, 0.42);
    const truckMat = new THREE.MeshStandardMaterial({ color: 0xffc233, emissive: 0x6b4a00, roughness: 0.5 });
    const trucks = [0, 0.33, 0.66].map((offset) => {
      const m = new THREE.Mesh(truckGeo, truckMat);
      scene.add(m);
      return { mesh: m, offset };
    });

    // ---- an excavator on the coal floor
    const exc = new THREE.Group();
    const excMat = new THREE.MeshStandardMaterial({ color: 0xe8a317, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 0.9), excMat);
    body.position.y = 0.45;
    const boom = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.14, 0.14), excMat);
    boom.position.set(1.0, 0.95, 0);
    boom.rotation.z = 0.5;
    const tracks = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.25, 1.1),
      new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.9 }),
    );
    tracks.position.y = 0.12;
    const upper = new THREE.Group();
    upper.add(body, boom);
    exc.add(tracks, upper);
    exc.position.set(-0.8, -PIT_DEPTH, 0.6);
    scene.add(exc);

    // ---- ledger pins
    const glow = glowTexture("rgba(255,255,255,1)");
    const PIN_MAX = 10;
    const pins = Array.from({ length: PIN_MAX }, (_, i) => {
      const a = i * 2.399 + 0.8; // golden angle: evenly spread, never stacked
      const r = FLOOR_R + 2 + ((i * 0.37) % 1) * (RIM_R - FLOOR_R - 3);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const base = heightAt(x, z);
      const group = new THREE.Group();
      const stemMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5 });
      const stem = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 2.4, 0)]),
        stemMat,
      );
      const headMat = new THREE.MeshBasicMaterial();
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), headMat);
      head.position.y = 2.4;
      const haloMat = new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const halo = new THREE.Sprite(haloMat);
      halo.position.y = 2.4;
      halo.scale.setScalar(1.6);
      group.add(stem, head, halo);
      group.position.set(x, base, z);
      group.visible = false;
      scene.add(group);
      return { group, stemMat, headMat, haloMat, halo, phase: i * 0.7 };
    });
    const red = new THREE.Color(0xff4d4f);
    const amber = new THREE.Color(0xffb020);

    // ---- dust hanging over the pit
    const DUST = 350;
    const dustPos = new Float32Array(DUST * 3);
    for (let i = 0; i < DUST; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * RIM_R;
      dustPos.set([Math.cos(a) * r, -PIT_DEPTH + Math.random() * 9, Math.sin(a) * r], i * 3);
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    const dust = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({
        color: 0xffd9a0,
        size: 0.09,
        map: glow,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    scene.add(dust);

    const look = new THREE.Vector3(2, -2.5, 0);
    let angle = 0.9;

    return {
      // The title sits on the left half of the hero, so the pit is drawn right
      // of centre: the projection is shifted, not the camera, so the orbit
      // still circles the pit's middle.
      resize(w, h) {
        camera.setViewOffset(w, h, w < 640 ? 0 : -w * 0.2, 0, w, h);
      },
      update(t, dt) {
        if (!reducedMotion) angle += dt * 0.035;
        const radius = 34 - pointer.y * 1.5;
        camera.position.set(
          Math.cos(angle + pointer.x * 0.12) * radius,
          17 + pointer.y * -2,
          Math.sin(angle + pointer.x * 0.12) * radius,
        );
        camera.lookAt(look);

        for (const tr of trucks) {
          const u = (tr.offset + t * 0.018) % 1;
          const p = road.getPointAt(u);
          const tan = road.getTangentAt(u);
          tr.mesh.position.copy(p).y += 0.2;
          tr.mesh.rotation.y = Math.atan2(-tan.z, tan.x);
        }

        upper.rotation.y = Math.sin(t * 0.6) * 0.9;

        const { overdue, due } = live.current;
        pins.forEach((pin, i) => {
          const kind = i < overdue ? red : i < overdue + due ? amber : null;
          pin.group.visible = kind !== null;
          if (!kind) return;
          pin.headMat.color.copy(kind);
          pin.stemMat.color.copy(kind);
          pin.haloMat.color.copy(kind);
          const pulse = 1 + 0.25 * Math.sin(t * 2.4 + pin.phase);
          pin.halo.scale.setScalar(1.6 * pulse);
          pin.group.position.y = heightAt(pin.group.position.x, pin.group.position.z) + Math.sin(t * 1.3 + pin.phase) * 0.12;
        });

        const dp = dustGeo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < DUST; i++) {
          let y = dp.getY(i) + dt * 0.25;
          if (y > 3) y = -PIT_DEPTH;
          dp.setY(i, y);
        }
        dp.needsUpdate = true;
      },
      dispose() {
        glow.dispose();
      },
    };
  });

  return <div ref={ref} className="absolute inset-0" aria-hidden="true" />;
}
