// Procedural prop construction: a geometry batcher with a transform stack
// that bakes vertex colors, plus builders for vegetation and buildings.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const UNIT = {
  box: new THREE.BoxGeometry(1, 1, 1).toNonIndexed(),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6).toNonIndexed(),
  cyl8: new THREE.CylinderGeometry(1, 1, 1, 8).toNonIndexed(),
  cyl12: new THREE.CylinderGeometry(1, 1, 1, 12).toNonIndexed(),
  cyl16: new THREE.CylinderGeometry(1, 1, 1, 16).toNonIndexed(),
  cone4: new THREE.ConeGeometry(1, 1, 4).toNonIndexed(),
  cone6: new THREE.ConeGeometry(1, 1, 6).toNonIndexed(),
  cone8: new THREE.ConeGeometry(1, 1, 8).toNonIndexed(),
  cone12: new THREE.ConeGeometry(1, 1, 12).toNonIndexed(),
  sphere: new THREE.SphereGeometry(1, 12, 8).toNonIndexed(),
  hemi: new THREE.SphereGeometry(1, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed(),
  ico0: new THREE.IcosahedronGeometry(1, 0),
  ico1: new THREE.IcosahedronGeometry(1, 1),
  dodec: new THREE.DodecahedronGeometry(1, 0),
  octa: new THREE.OctahedronGeometry(1, 0),
  torus: new THREE.TorusGeometry(1, 0.12, 6, 24).toNonIndexed(),
};
for (const g of Object.values(UNIT)) if (g.attributes.uv) g.deleteAttribute('uv');

export type UnitShape = keyof typeof UNIT;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

export function mat(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _s.set(sx, sy, sz));
}

export class GeoBatch {
  parts: THREE.BufferGeometry[] = [];
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];
  jitter = 0.06; // per-part color variation

  get top() { return this.stack[this.stack.length - 1]; }
  push(m: THREE.Matrix4) { this.stack.push(this.top.clone().multiply(m)); return this; }
  pushT(x: number, y: number, z: number, ry = 0, s = 1) { return this.push(mat(x, y, z, 0, ry, 0, s, s, s)); }
  pop() { if (this.stack.length > 1) this.stack.pop(); return this; }

  addGeo(geo: THREE.BufferGeometry, color: number, local: THREE.Matrix4, vertexJitter = 0) {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone());
    if (g.attributes.uv) g.deleteAttribute('uv');
    if (g.attributes.uv1) g.deleteAttribute('uv1');
    g.applyMatrix4(_m.copy(this.top).multiply(local));
    const n = g.attributes.position.count;
    const cols = new Float32Array(n * 3);
    _c.setHex(color);
    const j = (Math.random() - 0.5) * this.jitter;
    for (let i = 0; i < n; i++) {
      const vj = vertexJitter ? (Math.random() - 0.5) * vertexJitter : 0;
      cols[i * 3] = Math.max(0, _c.r * (1 + j + vj));
      cols[i * 3 + 1] = Math.max(0, _c.g * (1 + j + vj));
      cols[i * 3 + 2] = Math.max(0, _c.b * (1 + j + vj));
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    this.parts.push(g);
    return g;
  }

  shape(s: UnitShape, color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0) {
    return this.addGeo(UNIT[s], color, mat(x, y, z, rx, ry, rz, sx, sy, sz));
  }
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: number, ry = 0, rx = 0, rz = 0) {
    return this.shape('box', color, x, y, z, w, h, d, rx, ry, rz);
  }
  /** Cylinder whose base sits at y. */
  cyl(r: number, h: number, x: number, y: number, z: number, color: number, seg: 6 | 8 | 12 | 16 = 8, rx = 0, ry = 0, rz = 0) {
    const key = ('cyl' + seg) as UnitShape;
    const m = mat(x, y, z, rx, ry, rz).multiply(mat(0, h / 2, 0, 0, 0, 0, r, h, r));
    return this.addGeo(UNIT[key], color, m);
  }
  /** Tapered cylinder (custom geometry, base at y). */
  taper(rb: number, rt: number, h: number, x: number, y: number, z: number, color: number, seg = 8, rx = 0, ry = 0, rz = 0) {
    const geo = new THREE.CylinderGeometry(rt, rb, h, seg).toNonIndexed();
    const m = mat(x, y, z, rx, ry, rz).multiply(mat(0, h / 2, 0));
    return this.addGeo(geo, color, m);
  }
  cone(r: number, h: number, x: number, y: number, z: number, color: number, seg: 4 | 6 | 8 | 12 = 8, rx = 0, ry = 0, rz = 0) {
    const key = ('cone' + seg) as UnitShape;
    const m = mat(x, y, z, rx, ry, rz).multiply(mat(0, h / 2, 0, 0, 0, 0, r, h, r));
    return this.addGeo(UNIT[key], color, m);
  }
  sphere(r: number, x: number, y: number, z: number, color: number, sx = 1, sy = 1, sz = 1) {
    return this.shape('sphere', color, x, y, z, r * sx, r * sy, r * sz);
  }
  ico(r: number, x: number, y: number, z: number, color: number, detail: 0 | 1 = 1, sx = 1, sy = 1, sz = 1, ry = 0) {
    return this.shape(detail ? 'ico1' : 'ico0', color, x, y, z, r * sx, r * sy, r * sz, 0, ry, 0);
  }

  merge(): THREE.BufferGeometry {
    if (!this.parts.length) return new THREE.BufferGeometry();
    const g = mergeGeometries(this.parts, false)!;
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
    g.computeBoundingSphere();
    return g;
  }
}

/** Displaces a non-indexed geometry consistently for shared positions. */
export function lumpy(geo: THREE.BufferGeometry, amount: number, seed = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const h = Math.sin(x * 12.9898 * seed + y * 78.233 + z * 37.719) * 43758.5453;
    const f = 1 + (h - Math.floor(h) - 0.5) * amount;
    p.setXYZ(i, x * f, y * f, z * f);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- vegetation
export function palmTree(): THREE.BufferGeometry {
  const b = new GeoBatch();
  const segs = 8;
  let x = 0, y = 0, ang = 0;
  for (let i = 0; i < segs; i++) {
    const len = 1.15;
    const r = 0.34 - i * 0.018;
    b.addGeo(new THREE.CylinderGeometry(r * 0.92, r, len, 7), i % 2 ? 0x8a6a45 : 0x7a5a38,
      mat(x + Math.sin(ang) * len / 2, y + Math.cos(ang) * len / 2, 0, 0, 0, -ang));
    x += Math.sin(ang) * len;
    y += Math.cos(ang) * len;
    ang += 0.055;
  }
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.2;
    const droop = 0.55 + (i % 3) * 0.18;
    const m = mat(x, y, 0, 0, a, 0)
      .multiply(mat(0, 0, 0, Math.PI / 2 + droop, 0, 0))
      .multiply(mat(0, 1.9, 0, 0, 0, 0, 0.55, 3.8, 0.12));
    b.addGeo(UNIT.cone4, i % 2 ? 0x3f9e3a : 0x58b842, m.multiply(mat(0, 0, 0, 0, 0, Math.PI)));
  }
  for (let i = 0; i < 3; i++) b.sphere(0.22, x + Math.cos(i * 2.1) * 0.3, y - 0.3, Math.sin(i * 2.1) * 0.3, 0x5a3a1c);
  return b.merge();
}

export function jungleTree(): THREE.BufferGeometry {
  const b = new GeoBatch();
  b.taper(0.55, 0.35, 7, 0, 0, 0, 0x6b4b30, 7);
  b.addGeo(new THREE.CylinderGeometry(0.12, 0.2, 2.5, 5), 0x6b4b30, mat(0.8, 5.5, 0, 0, 0, -0.8));
  b.ico(3.2, 0, 8.2, 0, 0x2f8a3a, 1, 1.2, 0.8, 1.1);
  b.ico(2.4, 1.9, 7.2, 0.6, 0x3c9c3e, 1, 1, 0.8, 1);
  b.ico(2.2, -1.6, 7.4, -0.8, 0x267a33, 1, 1, 0.85, 1);
  b.ico(2.0, 0.2, 9.6, -0.6, 0x48ab45, 1, 1, 0.8, 1);
  return b.merge();
}

export function pineTree(snowy: boolean): THREE.BufferGeometry {
  const b = new GeoBatch();
  b.taper(0.35, 0.22, 2.6, 0, 0, 0, 0x5a3e2a, 6);
  const green = snowy ? 0x2c5a48 : 0x2f6b3a;
  const tiers: [number, number, number][] = [[2.8, 3.4, 1.8], [2.2, 3.0, 3.6], [1.6, 2.6, 5.3], [1.0, 2.0, 6.8]];
  for (const [r, h, y] of tiers) {
    b.cone(r, h, 0, y, 0, green, 8);
    if (snowy) b.cone(r * 0.75, h * 0.45, 0, y + h * 0.58, 0, 0xf4f8ff, 8);
  }
  return b.merge();
}

export function deadTree(): THREE.BufferGeometry {
  const b = new GeoBatch();
  const c = 0x2b2420;
  b.taper(0.45, 0.18, 6, 0, 0, 0, c, 6);
  b.addGeo(new THREE.CylinderGeometry(0.06, 0.16, 2.6, 5), c, mat(0.7, 4.2, 0, 0, 0, -0.9));
  b.addGeo(new THREE.CylinderGeometry(0.05, 0.14, 2.2, 5), c, mat(-0.6, 3.4, 0.2, 0.2, 0, 0.8));
  b.addGeo(new THREE.CylinderGeometry(0.05, 0.12, 1.8, 5), c, mat(0.1, 5.2, -0.6, -0.7, 0, 0.1));
  b.addGeo(new THREE.CylinderGeometry(0.04, 0.1, 1.5, 5), c, mat(-0.3, 5.9, 0.4, 0.6, 0, 0.5));
  return b.merge();
}

export function cactus(): THREE.BufferGeometry {
  const b = new GeoBatch();
  const g = 0x4f8a3c;
  b.cyl(0.45, 4.2, 0, 0, 0, g, 8);
  b.sphere(0.45, 0, 4.2, 0, g);
  b.cyl(0.3, 1.0, 0.45, 1.6, 0, g, 8, 0, 0, -Math.PI / 2);
  b.cyl(0.3, 1.6, 1.25, 1.6, 0, g, 8);
  b.sphere(0.3, 1.25, 3.2, 0, g);
  b.cyl(0.28, 0.8, -0.45, 2.4, 0, g, 8, 0, 0, Math.PI / 2);
  b.cyl(0.28, 1.2, -1.05, 2.4, 0, g, 8);
  b.sphere(0.28, -1.05, 3.6, 0, g);
  b.sphere(0.12, 0, 4.6, 0, 0xff6fae);
  return b.merge();
}

export function goldenTree(): THREE.BufferGeometry {
  const b = new GeoBatch();
  b.taper(0.5, 0.3, 6, 0, 0, 0, 0xeae4d8, 7);
  b.addGeo(new THREE.CylinderGeometry(0.1, 0.18, 2.4, 5), 0xeae4d8, mat(-0.8, 4.8, 0, 0, 0, 0.8));
  b.ico(3.0, 0, 7.4, 0, 0xffcf3f, 1, 1.2, 0.85, 1.2);
  b.ico(2.2, 1.8, 6.6, 0.5, 0xffe27a, 1);
  b.ico(2.0, -1.7, 6.8, -0.5, 0xf5b82e, 1);
  b.ico(1.6, 0.3, 9.0, 0.2, 0xfff0a8, 1);
  return b.merge();
}

export function bush(color = 0x3f9a3c): THREE.BufferGeometry {
  const b = new GeoBatch();
  b.ico(1.1, 0, 0.6, 0, color, 1, 1.2, 0.8, 1.1);
  b.ico(0.8, 0.8, 0.45, 0.3, color, 1);
  b.ico(0.75, -0.7, 0.45, -0.2, color, 1);
  return b.merge();
}

export function rock(color: number, seed: number): THREE.BufferGeometry {
  const g = lumpy(UNIT.dodec, 0.55, seed);
  const b = new GeoBatch();
  b.jitter = 0.12;
  b.addGeo(g, color, mat(0, 0.3, 0, 0, seed, 0, 1.4, 0.9, 1.1), 0.1);
  return b.merge();
}

export function grassTuft(color: number): THREE.BufferGeometry {
  const b = new GeoBatch();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    b.addGeo(UNIT.cone4, color, mat(Math.cos(a) * 0.15, 0.35, Math.sin(a) * 0.15, Math.sin(a) * 0.35, 0, Math.cos(a) * 0.35, 0.07, 0.7, 0.07));
  }
  return b.merge();
}

export function flowers(): THREE.BufferGeometry {
  const b = new GeoBatch();
  const cols = [0xff5f8f, 0xffe14a, 0xffffff, 0xb57cff, 0xff8a3d];
  for (let i = 0; i < 5; i++) {
    const x = (Math.random() - 0.5) * 1.2, z = (Math.random() - 0.5) * 1.2;
    b.cyl(0.02, 0.4, x, 0, z, 0x3c8a30, 6);
    b.sphere(0.09, x, 0.42, z, cols[i % cols.length]);
  }
  return b.merge();
}

export function crystal(color: number): THREE.BufferGeometry {
  const b = new GeoBatch();
  b.addGeo(UNIT.octa, color, mat(0, 1.6, 0, 0, 0, 0, 0.5, 1.8, 0.5));
  b.addGeo(UNIT.octa, color, mat(0.6, 0.9, 0.2, 0, 0, -0.5, 0.3, 1.1, 0.3));
  b.addGeo(UNIT.octa, color, mat(-0.5, 0.8, -0.2, 0.3, 0, 0.6, 0.28, 0.9, 0.28));
  return b.merge();
}

export function iceFloe(): THREE.BufferGeometry {
  const b = new GeoBatch();
  b.addGeo(lumpy(UNIT.cyl6, 0.25, 3), 0xe8f4fb, mat(0, 0, 0, 0, 0, 0, 1, 0.6, 1));
  return b.merge();
}

// ------------------------------------------------------------------ buildings
export function hut(b: GeoBatch, wall = 0xc9a86a, roof = 0xd8b45a) {
  b.cyl(3, 2.6, 0, 0, 0, wall, 12);
  b.cone(3.9, 2.9, 0, 2.5, 0, roof, 12);
  b.box(1.1, 1.8, 0.3, 0, 0.9, 3.0, 0x4a3420);
  b.cyl(0.12, 2.6, 2.9, 0, 0.8, 0x7a5a38, 6);
}

export function house(b: GeoBatch, wall = 0xf2ece0, roof = 0xc24a3a) {
  b.box(6, 4, 5, 0, 2, 0, wall);
  b.addGeo(UNIT.cyl6, roof, mat(0, 4.9, 0, 0, 0, Math.PI / 2).multiply(mat(0, 0, 0, Math.PI / 6, 0, 0, 2.2, 6.6, 3.4)));
  b.box(0.9, 2.3, 1, 1.8, 6.2, -1, 0x8c7a6a);
  b.box(1.2, 2.2, 0.2, 0, 1.1, 2.55, 0x5a3a22);
  for (const x of [-1.9, 1.9]) b.box(1, 1, 0.15, x, 2.4, 2.55, 0x2a3a4a);
  b.box(6.4, 0.3, 5.4, 0, 0.15, 0, 0x8a8278);
}

export function windmillBase(b: GeoBatch) {
  b.taper(2.6, 1.6, 9, 0, 0, 0, 0xf0e8d8, 10);
  b.cone(2.2, 2.4, 0, 9, 0, 0x9a4a32, 12);
  b.box(1, 1.8, 0.3, 0, 0.9, 2.5, 0x5a3a22);
}
export function windmillBlades(): THREE.BufferGeometry {
  const b = new GeoBatch();
  b.cyl(0.35, 0.8, 0, 0, 0, 0x6a4a30, 8, Math.PI / 2);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    b.addGeo(UNIT.box, 0x7a5a38, mat(0, 0, 0.6, 0, 0, a).multiply(mat(0, 3.6, 0, 0, 0, 0, 0.18, 7.2, 0.12)));
    b.addGeo(UNIT.box, 0xf6f0e2, mat(0, 0, 0.62, 0, 0, a).multiply(mat(0.6, 4.2, 0, 0, 0, 0, 1.1, 5.2, 0.04)));
  }
  return b.merge();
}

export function lighthouse(b: GeoBatch) {
  for (let i = 0; i < 6; i++) {
    const r0 = 3 - i * 0.28, r1 = 3 - (i + 1) * 0.28;
    b.taper(r0, r1, 3, 0, i * 3, 0, i % 2 ? 0xc8302c : 0xf6f2ea, 12);
  }
  b.cyl(1.6, 0.4, 0, 18, 0, 0x333333, 12);
  b.cyl(1.2, 2, 0, 18.4, 0, 0xfff2a0, 12);
  b.cone(1.7, 1.8, 0, 20.4, 0, 0xc8302c, 12);
}

export function tent(b: GeoBatch, color: number) {
  b.cone(2.6, 3, 0, 0, 0, color, 4, 0, Math.PI / 4);
  b.box(1, 1.4, 0.1, 0, 0.7, 1.8, 0x2a1d14);
  b.cyl(0.08, 3.6, 0, 0, 0, 0x5a4030, 6);
}

export function campfireBase(b: GeoBatch) {
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.ico(0.35, Math.cos(a) * 1.1, 0.15, Math.sin(a) * 1.1, 0x6a6560, 0);
  }
  b.cyl(0.14, 1.8, -0.8, 0.2, 0, 0x4a3020, 6, 0, 0, Math.PI / 2 - 0.2);
  b.cyl(0.14, 1.8, 0, 0.2, -0.8, 0x4a3020, 6, Math.PI / 2 - 0.2, 0, 0);
}

export function crate(b: GeoBatch, x: number, y: number, z: number, s = 1, ry = 0) {
  b.box(1.2 * s, 1.2 * s, 1.2 * s, x, y + 0.6 * s, z, 0x9a7044, ry);
  b.box(1.25 * s, 0.15 * s, 1.25 * s, x, y + 0.6 * s, z, 0x6a4a2a, ry);
}
export function barrel(b: GeoBatch, x: number, y: number, z: number, s = 1) {
  b.cyl(0.5 * s, 1.3 * s, x, y, z, 0x8a5a32, 12);
  b.cyl(0.53 * s, 0.1 * s, x, y + 0.25 * s, z, 0x3a3a3a, 12);
  b.cyl(0.53 * s, 0.1 * s, x, y + 0.95 * s, z, 0x3a3a3a, 12);
}

export function watchtower(b: GeoBatch, wood = 0x7a5a38) {
  for (const [x, z] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) b.cyl(0.2, 7, x, 0, z, wood, 6);
  b.box(4.2, 0.3, 4.2, 0, 7, 0, wood);
  for (const [x, z, w, d] of [[0, -2, 4.2, 0.15], [0, 2, 4.2, 0.15], [-2, 0, 0.15, 4.2], [2, 0, 0.15, 4.2]]) b.box(w, 1, d, x, 7.6, z, wood);
  b.cone(3.4, 2, 0, 9.2, 0, 0x8a3a2a, 4, 0, Math.PI / 4);
  for (const [x, z] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) b.cyl(0.1, 1.8, x, 7.3, z, wood, 6);
}

export function wallSegment(b: GeoBatch, len: number, h: number, color: number, thick = 2.4) {
  b.box(len, h, thick, 0, h / 2, 0, color);
  const n = Math.max(2, Math.floor(len / 2.2));
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (i + 0.5) * (len / n);
    if (i % 2 === 0) b.box(len / n * 0.9, 1.2, thick + 0.2, x, h + 0.6, 0, color);
  }
}

export function tower(b: GeoBatch, r: number, h: number, color: number, roof?: number) {
  b.cyl(r, h, 0, 0, 0, color, 12);
  b.cyl(r * 1.15, 1, 0, h, 0, color, 12);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.box(r * 0.5, 1.1, 0.6, Math.cos(a) * r * 1.05, h + 1.5, Math.sin(a) * r * 1.05, color, -a + Math.PI / 2);
  }
  if (roof !== undefined) b.cone(r * 1.35, r * 2.2, 0, h + 1, 0, roof, 12);
  for (let i = 0; i < 3; i++) b.box(0.5, 1.2, 0.2, 0, h * (0.35 + i * 0.2), r, 0x1a1a22);
}

export function pillar(b: GeoBatch, h: number, color: number, broken = false) {
  b.box(2, 0.6, 2, 0, 0.3, 0, color);
  b.cyl(0.7, broken ? h * 0.6 : h, 0, 0.6, 0, color, 12);
  if (!broken) b.box(2, 0.6, 2, 0, h + 0.6, 0, color);
  else b.ico(0.7, 1.4, 0.4, 0.5, color, 0);
}

export function steppedTemple(b: GeoBatch, base: number, tiers: number, color: number) {
  let s = base, y = 0;
  for (let i = 0; i < tiers; i++) {
    b.box(s, 3, s, 0, y + 1.5, 0, color);
    y += 3;
    s *= 0.74;
  }
  b.box(s * 1.1, 3.5, s * 1.1, 0, y + 1.75, 0, color);
  b.box(base * 0.18, y, base * 0.6, 0, y / 2, base / 2 - base * 0.1, 0x8a8478, 0, 0.0);
}

export function pyramid(b: GeoBatch, size: number, color: number) {
  b.cone(size * 0.72, size * 0.62, 0, 0, 0, color, 4, 0, Math.PI / 4);
  b.box(size * 0.12, size * 0.1, size * 0.04, 0, size * 0.05, size * 0.5, 0x2a1d14);
}

export function obelisk(b: GeoBatch, h: number, color: number) {
  b.box(2.4, 1, 2.4, 0, 0.5, 0, color);
  b.taper(0.9, 0.6, h, 0, 1, 0, color, 4, 0, Math.PI / 4);
  b.cone(0.6, 1.4, 0, h + 1, 0, 0xffcf3f, 4, 0, Math.PI / 4);
}

export function domeHouse(b: GeoBatch, r: number, wall: number, dome: number) {
  b.cyl(r, r * 1.2, 0, 0, 0, wall, 16);
  b.shape('hemi', dome, 0, r * 1.2, 0, r, r, r);
  b.cone(0.2, 1.2, 0, r * 2.2, 0, 0xffcf3f, 6);
  b.box(1.2, 2, 0.3, 0, 1, r, 0x4a3020);
}

export function sandHouse(b: GeoBatch, w: number, h: number, d: number, color: number) {
  b.box(w, h, d, 0, h / 2, 0, color);
  b.box(w + 0.3, 0.4, d + 0.3, 0, h + 0.2, 0, color);
  b.box(1, 1.8, 0.2, 0, 0.9, d / 2 + 0.05, 0x3a2a1a);
  b.box(0.8, 0.8, 0.2, w / 3, h * 0.7, d / 2 + 0.05, 0x2a2018);
}

export function logCabin(b: GeoBatch) {
  b.box(6, 3.3, 4.8, 0, 1.65, 0, 0x6a4a30);
  for (let i = 0; i < 6; i++) {
    for (const z of [-2.45, 2.45]) b.addGeo(UNIT.cyl8, i % 2 ? 0x5e4028 : 0x74523a, mat(0, 0.3 + i * 0.55, z, 0, 0, Math.PI / 2, 0.3, 6.4, 0.3));
  }
  b.addGeo(UNIT.cyl6, 0xf4f8ff, mat(0, 4.0, 0, 0, 0, Math.PI / 2).multiply(mat(0, 0, 0, Math.PI / 6, 0, 0, 2.0, 6.6, 3.0)));
  b.box(1.1, 2, 0.2, 0, 1, 2.45, 0x3a2414);
  b.box(0.8, 3, 0.8, 2, 4, -1, 0x6a6a6a);
}

export function igloo(b: GeoBatch) {
  b.shape('hemi', 0xf0f6fb, 0, 0, 0, 3, 2.6, 3);
  b.addGeo(UNIT.cyl12, 0xe4eef6, mat(0, 0.9, 2.8, Math.PI / 2, 0, 0, 1, 1.6, 1));
}

export function arch(b: GeoBatch, w: number, h: number, color: number) {
  b.box(1.6, h, 1.6, -w / 2, h / 2, 0, color);
  b.box(1.6, h, 1.6, w / 2, h / 2, 0, color);
  b.box(w + 2.4, 1.6, 2, 0, h + 0.8, 0, color);
}

export function pier(b: GeoBatch, len: number, width = 5) {
  const plank = 0x9a7650, post = 0x5a4028;
  for (let z = 0; z < len; z += 1.1) b.box(width, 0.22, 1.0, 0, 0, z + 0.5, z % 2.2 < 1.1 ? plank : 0x8a6844);
  for (let z = 0; z <= len; z += 4) for (const x of [-width / 2, width / 2]) {
    b.cyl(0.25, 9, x, -8, z, post, 8);
    b.cyl(0.18, 1.1, x, 0, z, post, 8);
  }
  for (const x of [-width / 2, width / 2]) b.box(0.15, 0.15, len, x, 1.05, len / 2, post);
  b.cyl(0.35, 0.7, width / 2 - 0.5, 0.1, len - 1, 0x2a2a2a, 8);
}

/** A colossal stone statue of Aurelio holding up the sun. */
export function sunStatue(b: GeoBatch, s: number, stone: number) {
  b.box(10 * s, 4 * s, 10 * s, 0, 2 * s, 0, stone);
  b.box(2.2 * s, 10 * s, 2.4 * s, -1.6 * s, 9 * s, 0, stone);
  b.box(2.2 * s, 10 * s, 2.4 * s, 1.6 * s, 9 * s, 0, stone);
  b.box(6 * s, 9 * s, 3.4 * s, 0, 18 * s, 0, stone);
  b.box(7 * s, 1.5 * s, 3.8 * s, 0, 15 * s, 0, 0xd8b04a);
  b.sphere(2.2 * s, 0, 24.5 * s, 0, stone);
  b.addGeo(UNIT.cyl12, 0xe8c45a, mat(0, 25.6 * s, 0, 0, 0, 0, 2.6 * s, 0.5 * s, 2.6 * s));
  b.addGeo(UNIT.cyl12, 0xe8c45a, mat(0, 26.4 * s, 0, 0, 0, 0, 1.4 * s, 1.4 * s, 1.4 * s));
  for (const side of [-1, 1]) {
    b.addGeo(UNIT.box, stone, mat(side * 3.8 * s, 25 * s, 0, 0, 0, side * -0.35).multiply(mat(0, 0, 0, 0, 0, 0, 1.8 * s, 9 * s, 1.8 * s)));
  }
  b.addGeo(UNIT.torus, 0xffd54a, mat(0, 33 * s, 0, 0, 0, 0, 4.5 * s, 4.5 * s, 4.5 * s));
  b.sphere(3.4 * s, 0, 33 * s, 0, 0xffe58a);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.addGeo(UNIT.cone4, 0xffd54a, mat(Math.cos(a) * 6 * s, 33 * s + Math.sin(a) * 6 * s, 0, 0, 0, a - Math.PI / 2).multiply(mat(0, 0, 0, 0, 0, 0, 0.8 * s, 2.6 * s, 0.4 * s)));
  }
}

export function marbleTemple(b: GeoBatch, r: number, cols: number, stone: number, roof: number) {
  b.cyl(r + 2, 1.2, 0, 0, 0, stone, 16);
  b.cyl(r + 1, 0.6, 0, 1.2, 0, stone, 16);
  for (let i = 0; i < cols; i++) {
    const a = (i / cols) * Math.PI * 2;
    b.cyl(0.6, 9, Math.cos(a) * r, 1.8, Math.sin(a) * r, stone, 12);
  }
  b.cyl(r + 1, 1.2, 0, 10.8, 0, stone, 16);
  b.shape('hemi', roof, 0, 12, 0, r * 0.95, r * 0.7, r * 0.95);
  b.cone(0.5, 2, 0, 12 + r * 0.7, 0, 0xffd54a, 8);
}
