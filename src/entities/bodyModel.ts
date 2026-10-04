// Blender-modelled body parts (tools/blender/characters.py) skinned onto the procedural rig.
// The torso and limbs are smooth lofted meshes; the game fits them to each character's build,
// splits them into skin / top / bottom material regions and binds them to the rig's joints.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

type PartName = 'torso' | 'arm' | 'leg' | 'hand';
let parts: Record<PartName, THREE.BufferGeometry> | null = null;
const heads = new Map<string, THREE.BufferGeometry>();

/** Must match ARM_ANGLE in the Blender script: the arms are modelled (and bound) in this A-pose. */
export const ARM_ANGLE = 0.3;
const SH = new THREE.Vector3(0.25, 1.4, 0);
const HIP = new THREE.Vector3(0.1, 0.93, 0);

export async function loadBodyParts(url: string) {
  try {
    const gltf = await new GLTFLoader().loadAsync(url);
    const found: Partial<Record<PartName, THREE.BufferGeometry>> = {};
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const name = m.name.replace(/[._]\d+$/, '');
      const g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      const isHead = name.startsWith('head_');
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && !(isHead && k === 'uv')) g.deleteAttribute(k);
      if (isHead) heads.set(name.slice(5), g);
      else found[name as PartName] = g;
    });
    if (found.torso && found.arm && found.leg && found.hand) parts = found as Record<PartName, THREE.BufferGeometry>;
  } catch (e) {
    console.warn('Body models unavailable, using procedural bodies', e);
  }
}

export const bodyPartsReady = () => parts !== null;

export interface BodyFit { build: number; belly: number; fem: boolean }
export type Region = 0 | 1 | 2; // skin, top (shirt), bottom (pants)
export interface Coverage { top: boolean; sleeve: number; shorts: boolean }

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const gauss = (x: number, s: number) => Math.exp(-(x * x) / (s * s));

/**
 * Builds the skinnable geometry for one part: fitted to the build, mirrored for the right side,
 * with skin indices into `JOINT_ORDER`, cylindrical UVs and material groups per region.
 */
function fitPart(name: 'torso' | 'arm' | 'leg', side: 1 | -1, fit: BodyFit, cov: Coverage, jointIndex: (j: string) => number) {
  const src = parts![name];
  const g = src.clone();
  const pos = g.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  const b = fit.build, sb = Math.sqrt(b), a = ARM_ANGLE;
  const d = new THREE.Vector3(Math.sin(a), -Math.cos(a), 0);
  const v = new THREE.Vector3(), rel = new THREE.Vector3(), along = new THREE.Vector3();
  const skinIndex = new Uint16Array(n * 4), skinWeight = new Float32Array(n * 4);
  const uv = new Float32Array(n * 2);
  const param = new Float32Array(n); // height (torso) or distance along the limb
  const set = (i: number, ja: string, jb: string, t: number) => {
    skinIndex[i * 4] = jointIndex(ja); skinIndex[i * 4 + 1] = jointIndex(jb);
    skinWeight[i * 4] = 1 - t; skinWeight[i * 4 + 1] = t;
  };
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i);
    if (name === 'torso') {
      const y = v.y;
      // Build widens the torso; belly pushes the front and sides out around the waist.
      const k = gauss(y - 1.1, 0.17);
      let sx = b * (1 + fit.belly * 0.4 * k), sz = b * (1 + fit.belly * (v.z > 0 ? 0.85 : 0.35) * k);
      if (fit.fem) { sx *= 1 - 0.1 * gauss(y - 1.12, 0.1) + 0.06 * gauss(y - 0.9, 0.08); }
      v.x *= sx; v.z *= sz;
      if (fit.fem && v.z > 0) for (const s of [-1, 1]) v.z += 0.032 * gauss(v.x - s * 0.085, 0.06) * gauss(y - 1.33, 0.06);
      param[i] = y;
      if (y < 0.99) set(i, 'hips', 'spine', 0);
      else if (y < 1.07) set(i, 'hips', 'spine', smooth(0.99, 1.07, y));
      else if (y < 1.24) set(i, 'spine', 'chest', 0);
      else if (y < 1.36) set(i, 'spine', 'chest', smooth(1.24, 1.36, y));
      else if (y < 1.47) set(i, 'chest', 'neck', 0);
      else if (y < 1.55) set(i, 'chest', 'neck', smooth(1.47, 1.55, y));
      else set(i, 'neck', 'head', smooth(1.6, 1.66, y));
      uv[i * 2] = (Math.atan2(v.x, v.z) / (Math.PI * 2)) * 4; uv[i * 2 + 1] = y * 4;
    } else {
      const origin = name === 'arm' ? SH : HIP;
      const axis = name === 'arm' ? d : new THREE.Vector3(0, -1, 0);
      rel.copy(v).sub(origin);
      const s = rel.dot(axis);
      along.copy(axis).multiplyScalar(s);
      rel.sub(along).multiplyScalar(sb); // thicken around the limb axis only, keeping its length
      v.copy(origin).setX(origin.x * b).add(along).add(rel);
      param[i] = s;
      if (name === 'arm') {
        if (s < 0.2) set(i, 'shL', 'elL', 0);
        else if (s < 0.36) set(i, 'shL', 'elL', smooth(0.2, 0.36, s));
        else set(i, 'elL', 'haL', smooth(0.54, 0.6, s));
      } else {
        if (s < 0.34) set(i, 'hiL', 'knL', 0);
        else if (s < 0.52) set(i, 'hiL', 'knL', smooth(0.34, 0.52, s));
        else set(i, 'knL', 'ftL', smooth(0.8, 0.9, s));
      }
      uv[i * 2] = (Math.atan2(rel.x, rel.z) / (Math.PI * 2)) * 2; uv[i * 2 + 1] = s * 4;
      if (side === -1) for (let k = 0; k < 2; k++) {
        const j = skinIndex[i * 4 + k];
        skinIndex[i * 4 + k] = jointIndex(mirrorJoint(j, jointIndex));
      }
    }
    // Cloth folds: drape where the shirt tucks into the waistband, creases behind the knee and
    // bunching at the ankle. Pushed along the limb/torso radius so toon shading picks them up.
    const ang = name === 'torso' ? Math.atan2(v.x, v.z) : Math.atan2(rel.x, rel.z);
    let fold = 0;
    if (name === 'torso' && cov.top) {
      const y = v.y;
      fold = 0.012 * b * smooth(1.22, 1.04, y) * smooth(0.99, 1.03, y) * (0.6 + 0.4 * Math.sin(ang * 9 + 1.3) * Math.sin(ang * 4 - 0.5))
        + 0.005 * gauss(y - 1.38, 0.05) * Math.max(0, Math.cos(ang)) * Math.sin(ang * 14);
    } else if (name === 'leg' && !(cov.shorts && param[i] > 0.43)) {
      const s = param[i];
      fold = 0.007 * gauss(s - 0.45, 0.06) * Math.sin(s * 70 + ang * 1.5) * (0.5 + 0.5 * Math.cos(ang - Math.PI))
        + 0.003 * gauss(s - 0.15, 0.08) * Math.sin(ang * 6 + s * 30);
    } else if (name === 'arm' && param[i] < cov.sleeve) {
      fold = 0.005 * Math.sin(ang * 5 + param[i] * 50) * smooth(0.02, 0.1, param[i]);
    }
    if (fold) {
      if (name === 'torso') { const r = Math.hypot(v.x, v.z) || 1; v.x += (v.x / r) * fold; v.z += (v.z / r) * fold; }
      else { const r = rel.length() || 1; v.addScaledVector(rel, fold / r); }
    }
    if (side === -1) v.x = -v.x;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  // Regions per triangle, then regroup the index buffer by material.
  const region = (p: number): Region => {
    if (name === 'torso') return p > 1.5 ? 0 : p > 1.0 ? (cov.top ? 1 : 0) : 2;
    if (name === 'arm') return p < cov.sleeve ? 1 : 0;
    return cov.shorts && p > 0.43 ? 0 : 2;
  };
  const idx = g.index ? Array.from(g.index.array as ArrayLike<number>) : Array.from({ length: n }, (_, i) => i);
  if (side === -1) for (let t = 0; t < idx.length; t += 3) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
  const groups: number[][] = [[], [], []];
  for (let t = 0; t < idx.length; t += 3) {
    const r = region((param[idx[t]] + param[idx[t + 1]] + param[idx[t + 2]]) / 3);
    groups[r].push(idx[t], idx[t + 1], idx[t + 2]);
  }
  g.setIndex(groups.flat());
  g.clearGroups();
  let start = 0;
  groups.forEach((gr, mi) => { if (gr.length) g.addGroup(start, gr.length, mi); start += gr.length; });
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function mirrorJoint(j: number, jointIndex: (j: string) => number) {
  const map: Record<string, string> = { shL: 'shR', elL: 'elR', haL: 'haR', hiL: 'hiR', knL: 'knR', ftL: 'ftR' };
  for (const [l, r] of Object.entries(map)) if (jointIndex(l) === j) return r;
  return ['hips', 'spine', 'chest', 'neck', 'head'].find((k) => jointIndex(k) === j) ?? 'chest';
}

const geoCache = new Map<string, THREE.BufferGeometry>();
export function bodyGeometry(name: 'torso' | 'arm' | 'leg', side: 1 | -1, fit: BodyFit, cov: Coverage, joints: string[]) {
  const key = [name, side, fit.build.toFixed(3), fit.belly.toFixed(2), fit.fem, cov.top, cov.sleeve, cov.shorts].join('|');
  let g = geoCache.get(key);
  if (!g) { g = fitPart(name, side, fit, cov, (j) => joints.indexOf(j)); geoCache.set(key, g); }
  return g;
}

const handCache = new Map<string, THREE.BufferGeometry>();
/** Blender hand at the wrist joint, scaled for the build and mirrored for the right side. */
export function handGeometry(scale: number, side: 1 | -1) {
  const key = scale.toFixed(3) + side;
  let g = handCache.get(key);
  if (!g) {
    g = parts!.hand.clone();
    g.scale(side * scale, scale, scale);
    if (side === -1) {
      const idx = g.index!;
      for (let t = 0; t < idx.count; t += 3) { const a = idx.getX(t + 1); idx.setX(t + 1, idx.getX(t + 2)); idx.setX(t + 2, a); }
    }
    g.computeVertexNormals();
    handCache.set(key, g);
  }
  return g;
}

/** Sculpted head for a face style (elder faces share the grunt head). */
export function modelHead(style: string) {
  return heads.get(style === 'elder' ? 'grunt' : style) ?? heads.get('hero') ?? null;
}

const faceCache = new Map<string, THREE.BufferGeometry>();
/** The front of a sculpted head that carries the painted face, lifted a hair off the skin. */
export function modelFace(style: string) {
  let g = faceCache.get(style);
  if (g) return g;
  const src = modelHead(style)!;
  const pos = src.attributes.position, nrm = src.attributes.normal, uv = src.attributes.uv;
  const idx = src.index!;
  // glTF stores V flipped relative to Blender.
  const inside = (i: number) => { const u = uv.getX(i), v = 1 - uv.getY(i); return u > -0.02 && u < 1.02 && v > -0.02 && v < 1.02 && pos.getZ(i) > 0.02; };
  const P: number[] = [], N: number[] = [], U: number[] = [];
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    if (!inside(a) || !inside(b) || !inside(c)) continue;
    for (const i of [a, b, c]) {
      const nx = nrm.getX(i), ny = nrm.getY(i), nz = nrm.getZ(i);
      P.push(pos.getX(i) + nx * 0.0012, pos.getY(i) + ny * 0.0012, pos.getZ(i) + nz * 0.0012);
      N.push(nx, ny, nz);
      U.push(uv.getX(i), 1 - uv.getY(i));
    }
  }
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  faceCache.set(style, g);
  return g;
}
