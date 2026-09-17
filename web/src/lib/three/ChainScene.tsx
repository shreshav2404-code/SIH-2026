import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import { glowTexture, useThreeScene } from "./useThreeScene";

/**
 * The evidence hash chain, as a chain.
 *
 * One block per capture at this mine, in insertion order, each linked to the
 * one before it - exactly the structure the server verifies. A pulse of
 * light walks the chain the way /evidence/verify does. If a record has been
 * altered, its block and every block after it turn red and the link into it
 * hangs open, because that is what tampering does to a hash chain: it breaks
 * everything downstream, not just the edited row.
 *
 * The record ids are the evidence ids, so "#13" here is "#13" in the list
 * below and in the database.
 */

export interface ChainData {
  ids: number[];
  /** Evidence id of the first record whose hash does not match, if any. */
  brokenId: number | null;
}

const MAX_BLOCKS = 36;

function labelTexture(text: string): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 48;
  const g = c.getContext("2d")!;
  g.font = "600 28px 'JetBrains Mono Variable', ui-monospace, monospace";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#cfe3f7";
  g.fillText(text, 64, 26);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export default function ChainScene({ data }: { data: ChainData }) {
  const live = useRef(data);
  useEffect(() => {
    live.current = data;
  });

  const ref = useThreeScene(({ scene, camera, pointer, reducedMotion }) => {
    scene.add(new THREE.HemisphereLight(0xbfdcff, 0x0a1428, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(4, 8, 10);
    scene.add(key);

    const blockGeo = new RoundedBoxGeometry(1.15, 0.78, 0.78, 3, 0.14);
    const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.17, 0.8, 0.8));
    const linkGeo = new THREE.TorusGeometry(0.2, 0.05, 10, 24);
    const glow = glowTexture("rgba(255,255,255,1)");

    const ok = new THREE.Color(0x38bdf8);
    const bad = new THREE.Color(0xff4d4f);
    const bodyOk = new THREE.Color(0x0f2a4d);
    const bodyBad = new THREE.Color(0x4a1016);

    type Block = {
      id: number;
      group: THREE.Group;
      body: THREE.MeshStandardMaterial;
      edge: THREE.LineBasicMaterial;
      link: THREE.Mesh;
      linkMat: THREE.MeshStandardMaterial;
      label: THREE.Sprite;
    };
    let blocks: Block[] = [];
    let builtFor = "";
    const root = new THREE.Group();
    scene.add(root);

    const pulse = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glow, color: 0x9be7ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    pulse.scale.setScalar(1.4);
    root.add(pulse);

    const SPACING = 1.65;

    const build = (ids: number[]) => {
      for (const b of blocks) {
        root.remove(b.group);
        b.body.dispose();
        b.edge.dispose();
        b.linkMat.dispose();
        (b.label.material as THREE.SpriteMaterial).map?.dispose();
        b.label.material.dispose();
      }
      blocks = ids.map((id, i) => {
        const group = new THREE.Group();
        const body = new THREE.MeshStandardMaterial({ color: bodyOk, metalness: 0.35, roughness: 0.35, emissive: 0x061a33 });
        const mesh = new THREE.Mesh(blockGeo, body);
        const edge = new THREE.LineBasicMaterial({ color: ok, transparent: true, opacity: 0.9 });
        const edges = new THREE.LineSegments(edgeGeo, edge);
        const linkMat = new THREE.MeshStandardMaterial({ color: 0x8fb8e0, metalness: 0.8, roughness: 0.25 });
        const link = new THREE.Mesh(linkGeo, linkMat);
        link.position.x = -SPACING / 2;
        link.rotation.y = i % 2 ? Math.PI / 2 : 0;
        link.visible = i > 0;
        const labelMat = new THREE.SpriteMaterial({ map: labelTexture(`#${id}`), transparent: true, depthWrite: false });
        const label = new THREE.Sprite(labelMat);
        label.scale.set(1.1, 0.41, 1);
        label.position.y = -0.85;
        group.add(mesh, edges, link, label);
        group.position.x = (i - (ids.length - 1) / 2) * SPACING;
        root.add(group);
        return { id, group, body, edge, link, linkMat, label };
      });
    };

    return {
      update(t) {
        const { ids: allIds, brokenId } = live.current;
        const ids = allIds.slice(-MAX_BLOCKS);
        const signature = ids.join(",");
        if (signature !== builtFor) {
          build(ids);
          builtFor = signature;
        }
        const n = Math.max(1, blocks.length);
        const brokenIndex = brokenId == null ? -1 : blocks.findIndex((b) => b.id === brokenId);

        // Fit the whole chain in view, whatever its length.
        const span = n * SPACING;
        const dist = Math.max(6.5, span / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect) + 2.5);
        camera.position.set(pointer.x * 1.2, 1.6 - pointer.y * 0.8, dist);
        camera.lookAt(0, 0, 0);

        // The verification pulse walks left to right and stops at a break.
        const end = brokenIndex >= 0 ? brokenIndex : n - 1;
        const cycle = reducedMotion ? 1 : ((t * 0.35) % 1.25) / 1.0;
        const at = Math.min(cycle, 1) * end;
        pulse.visible = !reducedMotion && cycle <= 1;
        pulse.position.set((at - (n - 1) / 2) * SPACING, 0, 0.5);
        (pulse.material as THREE.SpriteMaterial).color.copy(brokenIndex >= 0 && at > end - 0.5 ? bad : ok);

        blocks.forEach((b, i) => {
          const broken = brokenIndex >= 0 && i >= brokenIndex;
          const lit = Math.max(0, 1 - Math.abs(at - i) * 1.4);
          b.edge.color.copy(broken ? bad : ok);
          b.edge.opacity = 0.55 + 0.45 * lit;
          b.body.color.copy(broken ? bodyBad : bodyOk);
          b.body.emissiveIntensity = 0.6 + lit * 2.2;
          b.linkMat.color.set(broken ? 0xff7a7a : 0x8fb8e0);
          b.group.position.y = reducedMotion ? 0 : Math.sin(t * 1.4 + i * 0.5) * 0.06;
          // The link into a tampered record hangs open.
          b.link.position.y = i === brokenIndex ? -0.35 : 0;
          b.link.rotation.z = i === brokenIndex ? 0.9 : 0;
          b.group.rotation.y = reducedMotion ? 0 : Math.sin(t * 0.7 + i * 0.3) * 0.08;
        });

        root.rotation.x = -0.12;
      },
      dispose() {
        blockGeo.dispose();
        edgeGeo.dispose();
        linkGeo.dispose();
        glow.dispose();
      },
    };
  });

  return <div ref={ref} className="absolute inset-0" aria-hidden="true" />;
}
