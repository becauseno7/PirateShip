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
  prism: unitPrism(),
};

/** Triangular prism: base spans z in [-0.5, 0.5] at y=0, apex at y=1, length along x in [-0.5, 0.5]. */
function unitPrism() {
  const A = [-0.5, 0, -0.5], B = [-0.5, 0, 0.5], C = [-0.5, 1, 0];
  const D = [0.5, 0, -0.5], E = [0.5, 0, 0.5], F = [0.5, 1, 0];
  const tris = [A, C, B, D, E, F, A, B, E, A, E, D, B, C, F, B, F, E, A, D, F, A, F, C];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  g.computeVertexNormals();
  return g;
}
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

  /** Add a geometry that already carries its own vertex colors. */
  addRaw(geo: THREE.BufferGeometry, local = new THREE.Matrix4()) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (g.attributes.uv) g.deleteAttribute('uv');
    g.applyMatrix4(_m.copy(this.top).multiply(local));
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
/**
 * A soft canopy: overlapping blobs whose normals bend away from the canopy centre (so the
 * whole crown shades as one puffy mass) and whose colour brightens toward the sun-lit top.
 */
const ICO2 = new THREE.IcosahedronGeometry(1, 2);

export function canopy(blobs: [number, number, number, number][], color: number, center: THREE.Vector3, opts: { warm?: number; detail?: 1 | 2; squash?: number } = {}) {
  const b = new GeoBatch();
  b.jitter = 0.16;
  const geo = opts.detail === 1 ? UNIT.ico1 : ICO2;
  for (const [x, y, z, r] of blobs) b.addGeo(lumpy(geo, 0.14, x * 3.1 + z), color, mat(x, y, z, 0, x + z, 0, r, r * (opts.squash ?? 0.86), r));
  const g = b.merge();
  const p = g.attributes.position as THREE.BufferAttribute, n = g.attributes.normal as THREE.BufferAttribute, c = g.attributes.color as THREE.BufferAttribute;
  g.computeBoundingBox();
  const y0 = g.boundingBox!.min.y, y1 = g.boundingBox!.max.y;
  const v = new THREE.Vector3(), nn = new THREE.Vector3();
  const warm = opts.warm ?? 0.08;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).sub(center).normalize();
    nn.fromBufferAttribute(n, i).lerp(v, 0.9).normalize();
    n.setXYZ(i, nn.x, nn.y, nn.z);
    const t = (p.getY(i) - y0) / Math.max(0.001, y1 - y0);
    const k = 0.56 + t * 0.66;
    c.setXYZ(i, c.getX(i) * k * (1 + t * warm), c.getY(i) * k * (1 + t * warm * 0.6), c.getZ(i) * k * (1 - t * warm));
  }
  return g;
}

/** One palm frond: an arched, V-folded leaf strip with a darker base. */
function palmFrond(len: number, width: number, droop: number, color: number) {
  const segs = 9;
  const pos: number[] = [], col: number[] = [];
  const base = new THREE.Color(color), tip = base.clone().multiplyScalar(1.18), dark = base.clone().multiplyScalar(0.62);
  const pt = (t: number, side: number): [number, number, number] => {
    const along = t * len;
    const y = Math.sin(t * Math.PI * 0.55) * len * 0.28 - t * t * droop * len;
    const w = width * Math.sin(Math.min(1, t * 1.15) * Math.PI) * (t < 0.08 ? 0.3 : 1);
    return [side * w, y - Math.abs(side) * w * 0.35, along];
  };
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const c0 = dark.clone().lerp(base, Math.min(1, t0 * 2.5)).lerp(tip, Math.max(0, t0 - 0.5) * 2);
    const c1 = dark.clone().lerp(base, Math.min(1, t1 * 2.5)).lerp(tip, Math.max(0, t1 - 0.5) * 2);
    for (const side of [-1, 1]) {
      const a = pt(t0, 0), b2 = pt(t1, 0), c2 = pt(t1, side), d = pt(t0, side);
      const quad = side > 0 ? [a, b2, c2, a, c2, d] : [a, c2, b2, a, d, c2];
      const cols = side > 0 ? [c0, c1, c1, c0, c1, c0] : [c0, c1, c1, c0, c0, c1];
      quad.forEach((q) => pos.push(...q));
      cols.forEach((cc) => col.push(cc.r, cc.g, cc.b));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export function palmTree(): THREE.BufferGeometry {
  const b = new GeoBatch();
  const segs = 9;
  let x = 0, y = 0, ang = 0;
  for (let i = 0; i < segs; i++) {
    const len = 1.05;
    const r = 0.36 - i * 0.02;
    b.addGeo(new THREE.CylinderGeometry(r * 0.86, r, len, 8), i % 2 ? 0x9a7a52 : 0x7d5d3a,
      mat(x + Math.sin(ang) * len / 2, y + Math.cos(ang) * len / 2, 0, 0, 0, -ang));
    b.addGeo(UNIT.torus, 0x6e5232, mat(x, y + 0.02, 0, Math.PI / 2, 0, -ang, r * 0.98, r * 0.98, r * 1.4));
    x += Math.sin(ang) * len;
    y += Math.cos(ang) * len;
    ang += 0.034 + (i > 5 ? 0.02 : 0);
  }
  b.sphere(0.5, x, y, 0, 0x6a5a2a, 1, 0.8, 1);
  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * Math.PI * 2 + (i % 2) * 0.15;
    const tilt = i % 3 === 0 ? -0.15 : 0.2;
    const f = palmFrond(4.6 + (i % 3) * 0.6, 0.78, 0.7 + (i % 4) * 0.14, i % 2 ? 0x3f9e3a : 0x55b444);
    b.addRaw(f, mat(x, y + 0.1, 0, tilt, a, 0));
  }
  for (let i = 0; i < 4; i++) b.sphere(0.24, x + Math.cos(i * 1.7) * 0.34, y - 0.38, Math.sin(i * 1.7) * 0.34, 0x5a3a1c);
  return b.merge();
}

/** Broadleaf tree with a forked trunk and a puffy, sun-warmed crown. */
export function jungleTree(): THREE.BufferGeometry {
  const b = new GeoBatch();
  const bark = 0x6b4b30;
  b.taper(0.6, 0.34, 5.6, 0, 0, 0, bark, 8);
  for (let i = 0; i < 3; i++) b.addGeo(new THREE.CylinderGeometry(0.06, 0.32, 1.4, 5), 0x5a3e28, mat(Math.cos(i * 2.1) * 0.5, 0.35, Math.sin(i * 2.1) * 0.5, Math.sin(i * 2.1) * 0.9, 0, -Math.cos(i * 2.1) * 0.9));
  b.addGeo(new THREE.CylinderGeometry(0.16, 0.3, 3.0, 6), bark, mat(0.9, 6.1, 0.1, 0, 0, -0.55));
  b.addGeo(new THREE.CylinderGeometry(0.14, 0.26, 2.6, 6), bark, mat(-0.8, 6.0, -0.3, 0.25, 0, 0.6));
  const c = new THREE.Vector3(0, 8.0, 0);
  b.addRaw(canopy([[0, 8.4, 0, 2.9], [2.0, 7.6, 0.6, 2.2], [-1.9, 7.7, -0.6, 2.2], [0.6, 7.4, -1.9, 2.0], [-0.5, 7.5, 1.9, 2.0], [0.4, 9.9, 0.2, 2.0], [1.5, 9.2, -0.9, 1.6], [-1.3, 9.3, 0.9, 1.6]], 0x3a9a3e, c, { warm: 0.12 }));
  return b.merge();
}

export function pineTree(snowy: boolean): THREE.BufferGeometry {
  const b = new GeoBatch();
  b.taper(0.38, 0.2, 3.0, 0, 0, 0, 0x5a3e2a, 7);
  const green = snowy ? 0x2c5a48 : 0x2f6b3a;
  const tiers: [number, number, number][] = [[3.0, 3.2, 1.6], [2.5, 3.0, 3.1], [2.0, 2.7, 4.6], [1.45, 2.4, 6.0], [0.9, 2.0, 7.3]];
  tiers.forEach(([r, h, y], i) => {
    const k = 0.78 + i * 0.07;
    b.addGeo(lumpy(new THREE.ConeGeometry(r, h, 10, 2, true).translate(0, h / 2, 0), 0.08, i + 1), shade(green, k), mat(0, y, 0, 0, i * 0.7, 0));
    b.addGeo(new THREE.CircleGeometry(r * 0.98, 10).rotateX(Math.PI / 2), shade(green, 0.55), mat(0, y + 0.02, 0, 0, i * 0.7, 0));
    if (snowy) b.addGeo(lumpy(new THREE.ConeGeometry(r * 0.78, h * 0.5, 10, 1).translate(0, h * 0.25, 0), 0.1, i + 7), 0xf4f8ff, mat(0, y + h * 0.52, 0, 0, i * 0.7 + 0.3, 0));
  });
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
  b.taper(0.5, 0.3, 6, 0, 0, 0, 0xeae4d8, 8);
  b.addGeo(new THREE.CylinderGeometry(0.1, 0.18, 2.4, 6), 0xeae4d8, mat(-0.8, 4.8, 0, 0, 0, 0.8));
  b.addRaw(canopy([[0, 7.4, 0, 2.8], [1.8, 6.7, 0.5, 2.1], [-1.7, 6.9, -0.5, 2.0], [0.3, 8.9, 0.2, 1.7], [0.4, 6.6, -1.6, 1.7]], 0xffcf3f, new THREE.Vector3(0, 7.2, 0), { warm: 0.15 }));
  return b.merge();
}

export function bush(color = 0x3f9a3c): THREE.BufferGeometry {
  const b = new GeoBatch();
  b.addRaw(canopy([[0, 0.65, 0, 1.1], [0.85, 0.45, 0.3, 0.8], [-0.75, 0.45, -0.2, 0.78], [0.1, 0.5, -0.8, 0.7], [-0.2, 1.1, 0.2, 0.7]], color, new THREE.Vector3(0, 0.3, 0), { warm: 0.1 }));
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
  // Stilt hut: bamboo deck, woven walls, layered thatch with a fringe, ladder and porch.
  const bamboo = 0x9a8448, dark = 0x5a4428;
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; b.cyl(0.16, 1.4, Math.cos(a) * 2.7, -0.4, Math.sin(a) * 2.7, dark, 6); }
  b.cyl(3.4, 0.25, 0, 1.0, 0, 0x8a6a3a, 12);
  b.cyl(2.8, 2.3, 0, 1.25, 0, wall, 12);
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2 + 0.13; b.cyl(0.08, 2.3, Math.cos(a) * 2.82, 1.25, Math.sin(a) * 2.82, bamboo, 6); }
  for (const y of [1.6, 2.6]) b.addGeo(UNIT.torus, dark, mat(0, y, 0, Math.PI / 2, 0, 0, 2.85, 2.85, 0.4));
  b.cone(4.3, 1.6, 0, 3.3, 0, roof, 12);
  b.cone(3.4, 1.7, 0, 4.2, 0, shade(roof, 1.08), 12);
  b.cone(2.2, 1.5, 0, 5.2, 0, shade(roof, 1.16), 12);
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; b.box(0.36, 0.5, 0.06, Math.cos(a) * 4.15, 3.12, Math.sin(a) * 4.15, shade(roof, 0.85), -a + Math.PI / 2, 0.3); }
  b.cyl(0.1, 0.8, 0, 6.5, 0, dark, 6);
  b.box(1.1, 1.75, 0.2, 0, 2.1, 2.78, 0x3a2414);
  b.box(1.3, 0.15, 0.3, 0, 3.05, 2.85, dark);
  b.box(0.9, 0.7, 0.15, 2.0, 2.3, 1.95, 0x2a2018, Math.PI / 4 + 0.05);
  // Porch and ladder.
  b.box(2.4, 0.14, 1.4, 0, 1.08, 3.7, 0x8a6a3a);
  for (const sx of [-1, 1]) b.cyl(0.07, 1.6, sx * 1.1, 1.1, 4.3, bamboo, 6);
  b.box(2.3, 0.07, 0.07, 0, 1.95, 4.3, bamboo);
  for (const sx of [-0.4, 0.4]) b.box(0.08, 1.6, 0.08, sx, 0.4, 4.75, bamboo, 0, -0.35);
  for (let i = 0; i < 4; i++) b.box(0.9, 0.06, 0.08, 0, 0.0 + i * 0.32, 4.95 - i * 0.12, bamboo);
}

const HOUSE_SHUTTERS = [0x3f7f5a, 0x3d63a8, 0xb8443a, 0xd8a03a, 0x6a4a8a];
const FLOWER_COLS = [0xff5f8f, 0xffe14a, 0xffffff, 0xff7a3d, 0xc77dff];

function shade(c: number, k: number) { return new THREE.Color(c).multiplyScalar(k).getHex(); }

/** A window with a frame, mullions, open shutters and a flower box. Faces +z at the origin. */
function houseWindow(b: GeoBatch, x: number, y: number, z: number, ry: number, shutter: number, flowers: boolean, seed: number) {
  b.push(mat(x, y, z, 0, ry, 0));
  b.box(1.3, 1.3, 0.14, 0, 0, 0, 0xeee2c8);
  b.box(1.02, 1.02, 0.1, 0, 0, 0.04, 0x2c4a66);
  b.box(0.08, 1.02, 0.06, 0, 0, 0.1, 0xeee2c8);
  b.box(1.02, 0.08, 0.06, 0, 0, 0.1, 0xeee2c8);
  b.box(0.98, 0.3, 0.04, -0.02, 0.2, 0.08, 0x7fa8c8);
  for (const s of [-1, 1]) b.box(0.52, 1.24, 0.07, s * 0.98, 0, 0.2, shutter, -s * 0.5);
  if (flowers) {
    b.box(1.4, 0.3, 0.42, 0, -0.78, 0.24, 0x7a5232);
    for (let i = 0; i < 5; i++) {
      b.sphere(0.16, -0.5 + i * 0.25, -0.55, 0.28 + ((i + seed) % 2) * 0.08, 0x3f8a3a, 1, 0.7, 1);
      b.sphere(0.1, -0.5 + i * 0.25, -0.45, 0.3 + ((i + seed) % 2) * 0.08, FLOWER_COLS[(i + seed) % FLOWER_COLS.length]);
    }
  }
  b.pop();
}

/** Half-timbered village house with a tiled gable roof, chimney, shutters and flower boxes. Door faces +z. */
export function house(b: GeoBatch, wall = 0xf2ece0, roof = 0xc24a3a, seed = 0) {
  const two = seed % 3 === 1;
  const w = two ? 7 : 6.6, d = two ? 5.6 : 5.4, h = two ? 6.2 : 3.8;
  const wood = 0x5a3822, stone = 0x8c8478;
  const shutter = HOUSE_SHUTTERS[seed % HOUSE_SHUTTERS.length];
  const y0 = 0.6, top = y0 + h;
  // Stone plinth with a few proud blocks.
  b.box(w + 0.5, 0.7, d + 0.5, 0, 0.3, 0, stone);
  for (let i = 0; i < 7; i++) {
    const t = i / 6 - 0.5;
    b.box(0.9, 0.36, 0.2, t * (w - 0.2), 0.26 + (i % 2) * 0.24, d / 2 + 0.28, i % 2 ? 0x9a9286 : 0x7e776c);
  }
  // Plastered walls and timber frame.
  b.box(w, h, d, 0, y0 + h / 2, 0, wall);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.32, h + 0.1, 0.32, sx * w / 2, y0 + h / 2, sz * d / 2, wood);
  for (const sz of [-1, 1]) { b.box(w + 0.1, 0.26, 0.24, 0, y0 + 0.13, sz * (d / 2 + 0.04), wood); b.box(w + 0.1, 0.3, 0.26, 0, top - 0.15, sz * (d / 2 + 0.04), wood); }
  for (const sx of [-1, 1]) { b.box(0.24, 0.26, d + 0.1, sx * (w / 2 + 0.04), y0 + 0.13, 0, wood); b.box(0.26, 0.3, d + 0.1, sx * (w / 2 + 0.04), top - 0.15, 0, wood); }
  if (two) for (const sz of [-1, 1]) b.box(w + 0.1, 0.24, 0.22, 0, y0 + h * 0.5, sz * (d / 2 + 0.05), wood);
  // Diagonal braces on the gable sides.
  const braceH = two ? h * 0.5 : h;
  for (const sx of [-1, 1]) for (const k of [-1, 1]) {
    const len = Math.hypot(braceH * 0.9, d * 0.32);
    b.box(0.18, len, 0.18, sx * (w / 2 + 0.06), y0 + braceH * 0.5, k * d * 0.28, wood, 0, k * Math.atan2(d * 0.32, braceH * 0.9) * sx, 0);
  }
  // Gable roof (ridge along x) with stepped tile rows, ridge cap and gable ends.
  const rise = d * 0.45, half = d / 2 + 0.6;
  const pitch = Math.atan2(rise, d / 2);
  const slope = Math.hypot(half, rise * (half / (d / 2)));
  for (const sz of [-1, 1]) {
    b.push(mat(0, top + rise - rise * half / d + 0.08, sz * half / 2, sz * pitch, 0, 0));
    b.box(w + 1.1, 0.22, slope, 0, 0, 0, shade(roof, 0.7));
    const rows = 7;
    for (let r = 0; r < rows; r++) {
      const t = (r + 0.5) / rows - 0.5;
      b.box(w + 1.0, 0.13, slope / rows + 0.08, 0, 0.16, -sz * t * slope, r % 2 ? roof : shade(roof, 0.88));
    }
    b.pop();
  }
  b.addGeo(UNIT.cyl8, shade(roof, 0.65), mat(0, top + rise + 0.05, 0, 0, 0, Math.PI / 2).multiply(mat(0, 0, 0, 0, 0, 0, 0.2, w + 1.2, 0.2)));
  for (const sx of [-1, 1]) {
    b.addGeo(UNIT.prism, wall, mat(sx * (w / 2 - 0.05), top, 0, 0, 0, 0, 0.1, rise, d));
    b.addGeo(UNIT.prism, wood, mat(sx * (w / 2 + 0.02), top - 0.02, 0, 0, 0, 0, 0.06, rise * 0.25, d * 0.25).premultiply(mat(0, rise * 0.55, 0)));
    b.cyl(0.38, 0.12, sx * (w / 2 + 0.02), top + rise * 0.38, 0, 0x2c4a66, 12, 0, 0, Math.PI / 2);
  }
  // Chimney.
  b.box(0.9, rise + 1.8, 0.9, w * 0.28, top + (rise + 1.8) / 2 - 0.2, -d * 0.18, 0x9a8f80);
  b.box(1.1, 0.22, 1.1, w * 0.28, top + rise + 1.6, -d * 0.18, 0x6e665c);
  // Door with frame, awning, step and a lantern.
  const dz = d / 2 + 0.06;
  b.box(1.5, 2.45, 0.16, 0, y0 + 1.2, dz, wood);
  b.box(1.16, 2.15, 0.14, 0, y0 + 1.08, dz + 0.05, 0x8a5430);
  for (let i = 0; i < 3; i++) b.box(0.04, 2.0, 0.04, -0.36 + i * 0.36, y0 + 1.08, dz + 0.13, 0x6a3e22);
  b.sphere(0.06, 0.4, y0 + 1.05, dz + 0.16, 0xe8c45a);
  b.box(1.9, 0.12, 0.9, 0, y0 + 2.62, dz + 0.42, roof, 0, 0.32);
  b.box(1.9, 0.22, 1.0, 0, 0.36, dz + 0.55, stone);
  b.box(0.18, 0.3, 0.18, 1.0, y0 + 2.0, dz + 0.18, 0x2a2a2a);
  b.box(0.12, 0.18, 0.12, 1.0, y0 + 1.82, dz + 0.18, 0xffd27a);
  // Windows.
  const wy = y0 + 1.75;
  for (const sx of [-1, 1]) houseWindow(b, sx * w * 0.3, wy, dz, 0, shutter, true, seed + (sx > 0 ? 1 : 0));
  if (two) for (let i = -1; i <= 1; i++) houseWindow(b, i * w * 0.3, y0 + h * 0.5 + 1.5, dz, 0, shutter, i === 0, seed + i + 3);
  for (const sx of [-1, 1]) houseWindow(b, sx * (w / 2 + 0.06), wy, 0, sx * Math.PI / 2, shutter, false, seed);
  houseWindow(b, -w * 0.25, wy, -dz, Math.PI, shutter, false, seed);
  // Yard clutter.
  if (seed % 2 === 0) { b.cyl(0.42, 0.9, w / 2 + 0.7, 0, d / 2 - 0.2, 0x8a5a32, 12); b.cyl(0.44, 0.08, w / 2 + 0.7, 0.3, d / 2 - 0.2, 0x4a4a4a, 12); b.cyl(0.44, 0.08, w / 2 + 0.7, 0.62, d / 2 - 0.2, 0x4a4a4a, 12); }
  else { b.box(0.8, 0.8, 0.8, -w / 2 - 0.6, 0.4, d / 2 - 0.4, 0xa8783e, 0.4); b.box(0.6, 0.6, 0.6, -w / 2 - 0.5, 1.1, d / 2 - 0.4, 0xb8884e, 0.9); }
  b.box(1.8, 0.12, 0.45, -w * 0.3, 0.75, dz + 0.9, 0x8a6038);
  for (const sx of [-1, 1]) b.box(0.12, 0.45, 0.4, -w * 0.3 + sx * 0.75, 0.5, dz + 0.9, 0x6a4628);
}

export function windmillBase(b: GeoBatch) {
  const stone = 0x8c8478, plaster = 0xf3ece0, wood = 0x6a4428;
  b.cyl(3.1, 0.9, 0, 0, 0, stone, 16);
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; b.box(1.1, 0.45, 0.3, Math.cos(a) * 3.12, 0.3 + (i % 2) * 0.35, Math.sin(a) * 3.12, i % 2 ? 0x9a9286 : 0x7a736a, -a + Math.PI / 2); }
  b.taper(2.7, 1.75, 8.4, 0, 0.8, 0, plaster, 16);
  for (const y of [0.9, 4.8, 9.0]) b.taper(y < 2 ? 2.78 : y < 6 ? 2.32 : 1.8, y < 2 ? 2.72 : y < 6 ? 2.26 : 1.76, 0.3, 0, y, 0, wood, 16);
  // Balcony ring with posts.
  b.cyl(2.75, 0.18, 0, 5.2, 0, wood, 16);
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; b.box(0.1, 0.9, 0.1, Math.cos(a) * 2.68, 5.75, Math.sin(a) * 2.68, wood); }
  b.addGeo(UNIT.torus, wood, mat(0, 6.2, 0, Math.PI / 2, 0, 0, 2.68, 2.68, 0.5));
  // Rounded wooden cap with a ridge and finial.
  b.addGeo(UNIT.hemi, 0x9a4a32, mat(0, 9.2, 0, 0, 0, 0, 2.15, 1.9, 2.4));
  b.box(0.3, 0.3, 4.6, 0, 10.9, 0, 0x6e321f);
  b.sphere(0.25, 0, 11.2, 0, 0xd8b04a);
  // Door and windows facing +z.
  b.box(1.3, 2.1, 0.3, 0, 1.95, 2.55, wood);
  b.box(1.0, 1.85, 0.25, 0, 1.85, 2.66, 0x8a5430);
  b.box(1.5, 0.15, 0.6, 0, 3.05, 2.7, 0x9a4a32, 0, 0.3);
  for (const [y, r] of [[3.9, 2.38], [7.2, 2.02]] as const) { b.box(0.8, 0.95, 0.2, 0, y, r, 0xeee2c8); b.box(0.6, 0.75, 0.2, 0, y, r + 0.05, 0x2c4a66); }
  b.box(0.7, 0.8, 0.2, 2.1, 3.0, 0.7, 0x2c4a66, Math.PI / 2 - 0.3);
  // Sacks by the door.
  b.sphere(0.45, 1.6, 1.25, 2.6, 0xd8c8a0, 1, 0.8, 1); b.sphere(0.4, 2.2, 1.15, 2.3, 0xcbb890, 1, 0.75, 1);
}
export function windmillBlades(): THREE.BufferGeometry {
  const b = new GeoBatch();
  b.cyl(0.38, 0.9, 0, 0, 0, 0x6a4a30, 8, Math.PI / 2);
  b.sphere(0.32, 0, 0, 0.95, 0x5a3a22);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const arm = (m: THREE.Matrix4) => mat(0, 0, 0.62, 0, 0, a).multiply(m);
    b.addGeo(UNIT.box, 0x7a5a38, arm(mat(0, 3.6, 0, 0, 0, 0, 0.2, 7.2, 0.14)));
    b.addGeo(UNIT.box, 0xf6f0e2, arm(mat(0.68, 4.3, 0.02, 0, 0, 0, 1.2, 5.4, 0.04)));
    b.addGeo(UNIT.box, 0x7a5a38, arm(mat(1.28, 4.3, 0, 0, 0, 0, 0.08, 5.4, 0.08)));
    for (let k = 0; k < 6; k++) b.addGeo(UNIT.box, 0x7a5a38, arm(mat(0.66, 1.75 + k * 1.02, 0.05, 0, 0, 0, 1.3, 0.07, 0.06)));
  }
  return b.merge();
}

export function lighthouse(b: GeoBatch) {
  // Stone plinth with steps and a keeper's door.
  b.cyl(3.9, 1.2, 0, 0, 0, 0x8c8478, 16);
  for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; b.box(1.5, 0.5, 0.35, Math.cos(a) * 3.92, 0.3 + (i % 2) * 0.45, Math.sin(a) * 3.92, i % 2 ? 0x9a9286 : 0x7a736a, -a + Math.PI / 2); }
  for (let i = 0; i < 3; i++) b.box(1.8 - i * 0.2, 0.25, 0.6, 0, 0.12 + i * 0.25, 4.1 - i * 0.3, 0x7a736a);
  // Striped tower.
  for (let i = 0; i < 6; i++) {
    const r0 = 3 - i * 0.28, r1 = 3 - (i + 1) * 0.28;
    b.taper(r0, r1, 3, 0, 1.2 + i * 3, 0, i % 2 ? 0xc8302c : 0xf6f2ea, 16);
  }
  b.box(1.1, 2.0, 0.4, 0, 2.2, 2.85, 0x5a3a22);
  b.box(1.4, 0.2, 0.5, 0, 3.3, 2.9, 0x3a3a40);
  for (const [y, a] of [[6.2, 0.3], [10.4, 2.4], [14.4, 4.4]] as const) {
    const r = 3 - ((y - 1.2) / 3) * 0.28 + 0.02;
    b.box(0.55, 0.85, 0.2, Math.sin(a) * r, y, Math.cos(a) * r, 0x2c4a66, a);
    b.box(0.75, 0.12, 0.3, Math.sin(a) * r, y + 0.5, Math.cos(a) * r, 0xeee2c8, a);
  }
  // Gallery with railing.
  b.cyl(2.25, 0.3, 0, 19.2, 0, 0x3a3a40, 16);
  for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2; b.box(0.07, 0.8, 0.07, Math.cos(a) * 2.15, 19.9, Math.sin(a) * 2.15, 0x2a2a30); }
  b.addGeo(UNIT.torus, 0x2a2a30, mat(0, 20.3, 0, Math.PI / 2, 0, 0, 2.15, 2.15, 0.4));
  // Lantern room: glowing glass between iron mullions, red dome and a brass finial.
  b.cyl(1.35, 0.3, 0, 19.5, 0, 0x2a2a30, 12);
  b.cyl(1.2, 2.0, 0, 19.8, 0, 0xfff2a0, 12);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; b.box(0.09, 2.0, 0.09, Math.cos(a) * 1.22, 20.8, Math.sin(a) * 1.22, 0x2a2a30); }
  b.cyl(1.4, 0.2, 0, 21.8, 0, 0x2a2a30, 12);
  b.addGeo(UNIT.hemi, 0xc8302c, mat(0, 22.0, 0, 0, 0, 0, 1.4, 1.1, 1.4));
  b.cyl(0.1, 0.8, 0, 23.0, 0, 0xd8b04a, 6);
  b.sphere(0.2, 0, 23.9, 0, 0xd8b04a);
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

/** Iron street lamp on a stone foot. */
export function lampPost(b: GeoBatch) {
  b.cyl(0.32, 0.4, 0, 0, 0, 0x8c8478, 8);
  b.cyl(0.09, 3.4, 0, 0.4, 0, 0x2e2a28, 8);
  b.box(0.9, 0.08, 0.08, 0.3, 3.6, 0, 0x2e2a28);
  b.box(0.42, 0.55, 0.42, 0.62, 3.25, 0, 0x2e2a28);
  b.box(0.32, 0.42, 0.32, 0.62, 3.25, 0, 0xffd98a);
  b.cone(0.36, 0.3, 0.62, 3.52, 0, 0x2e2a28, 4, 0, Math.PI / 4);
}

/** Stone well with a little shingled roof, crank and bucket. */
export function well(b: GeoBatch) {
  b.cyl(1.3, 1.0, 0, 0, 0, 0x8c8478, 16);
  b.cyl(1.38, 0.18, 0, 1.0, 0, 0x7a736a, 16);
  b.cyl(1.0, 0.05, 0, 0.85, 0, 0x2a5a7a, 16);
  for (const s of [-1, 1]) b.box(0.18, 2.2, 0.18, s * 1.1, 1.1, 0, 0x6a4428);
  b.addGeo(UNIT.prism, 0xb8503a, mat(0, 3.1, 0, 0, 0, 0, 3.0, 0.9, 2.2));
  b.cyl(0.08, 2.4, -1.2, 2.5, 0, 0x5a3a22, 8, 0, 0, Math.PI / 2);
  b.cyl(0.25, 0.4, 0.2, 1.6, 0, 0x8a5a32, 8);
}

/** Market stall with a striped awning and produce crates. */
export function marketStall(b: GeoBatch, stripe: number, seed: number) {
  const wood = 0x7a5232;
  b.box(3.2, 0.9, 1.4, 0, 0.45, 0, 0x9a6a3c);
  b.box(3.3, 0.1, 1.5, 0, 0.92, 0, wood);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.12, 2.6, 0.12, sx * 1.55, 1.3, sz * 0.65, wood);
  for (let i = 0; i < 6; i++) b.box(0.56, 0.08, 1.9, -1.4 + i * 0.56, 2.75, 0.2, i % 2 ? 0xf6f0e2 : stripe, 0, -0.25);
  const goods = [0xff7a3d, 0xe8c63a, 0x7ac83a, 0xd8343a, 0x9a5ad8];
  for (let i = 0; i < 4; i++) {
    b.box(0.65, 0.25, 0.6, -1.1 + i * 0.73, 1.08, 0.1, 0xa8783e);
    for (let k = 0; k < 4; k++) b.sphere(0.13, -1.25 + i * 0.73 + (k % 2) * 0.28, 1.3, (k < 2 ? -0.05 : 0.22), goods[(i + seed) % goods.length]);
  }
}

/** Small wooden rowboat, bow toward +z. */
export function rowboat(b: GeoBatch, paint: number) {
  b.addGeo(UNIT.hemi, 0x7a5232, mat(0, 0.5, 0, Math.PI, 0, 0, 0.9, 0.55, 2.2));
  b.addGeo(UNIT.torus, paint, mat(0, 0.5, 0, Math.PI / 2, 0, 0, 0.9, 2.2, 1.2));
  for (const z of [-0.8, 0.5]) b.box(1.6, 0.08, 0.3, 0, 0.35, z, 0x9a6a3c);
  b.box(0.08, 0.06, 2.6, 0.5, 0.55, 0.2, 0xb8945a, 0.3);
}

/** Cluster of black volcanic-glass spires with a faint violet sheen. */
export function obsidian(): THREE.BufferGeometry {
  const b = new GeoBatch();
  b.jitter = 0.08;
  const n = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.6, r = i === 0 ? 0 : 0.5 + Math.random() * 0.5;
    const h = (i === 0 ? 3.2 : 1.2 + Math.random() * 1.6);
    const tilt = i === 0 ? 0 : 0.25 + Math.random() * 0.3;
    b.addGeo(new THREE.ConeGeometry(0.42 * (h / 3) + 0.15, h, 5), i % 2 ? 0x2a2236 : 0x1a1620, mat(Math.cos(a) * r, h * 0.45, Math.sin(a) * r, Math.sin(a) * tilt, 0, -Math.cos(a) * tilt));
  }
  b.ico(0.7, 0, 0.2, 0, 0x231e24, 0, 1.4, 0.5, 1.2);
  return b.merge();
}

/** Bubbling magma pool: bright core, cooling orange ring, black crust rim. */
export function magmaPool(): THREE.BufferGeometry {
  const seg = 18;
  const pos: number[] = [], col: number[] = [];
  const ringR = [0, 0.55, 0.85, 1.0, 1.25];
  const ringC = [[1.6, 0.9, 0.3], [1.4, 0.55, 0.12], [1.0, 0.28, 0.05], [0.25, 0.08, 0.04], [0.09, 0.07, 0.07]];
  const ringY = [0.05, 0.05, 0.06, 0.12, 0.2];
  const wob = Array.from({ length: seg }, () => 0.85 + Math.random() * 0.3);
  const P = (ri: number, si: number) => { const a = (si / seg) * Math.PI * 2, r = ringR[ri] * wob[si % seg]; return [Math.cos(a) * r, ringY[ri], Math.sin(a) * r]; };
  for (let ri = 0; ri < ringR.length - 1; ri++) for (let si = 0; si < seg; si++) {
    const a = P(ri, si), bq = P(ri, si + 1), c = P(ri + 1, si), d = P(ri + 1, si + 1);
    const ca = ringC[ri], cb = ringC[ri + 1];
    pos.push(...a, ...c, ...bq, ...bq, ...c, ...d);
    col.push(...ca, ...cb, ...ca, ...ca, ...cb, ...cb);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.scale(1.6, 1, 1.6);
  return g;
}

/** Scorched, wiry shrub for ash fields. */
export function ashShrub(): THREE.BufferGeometry {
  const b = new GeoBatch();
  b.jitter = 0.1;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    b.addGeo(new THREE.CylinderGeometry(0.015, 0.04, 0.9, 4), i % 3 ? 0x3a2e28 : 0x5a3a24, mat(Math.cos(a) * 0.15, 0.4, Math.sin(a) * 0.15, Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6));
  }
  b.ico(0.12, 0.2, 0.75, 0, 0xc8501e, 0);
  return b.merge();
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
  // Battered plinth, string course and alternating ashlar courses for texture.
  b.box(len, 1.2, thick + 0.6, 0, 0.6, 0, shade(color, 0.85));
  for (let y = 1.8; y < h - 0.4; y += 1.6) b.box(len + 0.02, 0.12, thick + 0.04, 0, y, 0, shade(color, 0.78));
  b.box(len, 0.3, thick + 0.35, 0, h - 0.15, 0, shade(color, 1.12));
  const n = Math.max(2, Math.floor(len / 2.2));
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (i + 0.5) * (len / n);
    if (i % 2 === 0) b.box(len / n * 0.9, 1.2, thick + 0.2, x, h + 0.6, 0, color);
    else for (const sz of [-1, 1]) b.box(0.18, 0.9, 0.06, x, h * 0.6, sz * (thick / 2 + 0.02), 0x14141a);
  }
}

export function tower(b: GeoBatch, r: number, h: number, color: number, roof?: number) {
  b.taper(r * 1.12, r, h, 0, 0, 0, color, 16);
  b.cyl(r * 1.25, 1.2, 0, 0, 0, shade(color, 0.85), 16);
  for (let y = 2.2; y < h - 1; y += 2.4) b.cyl(r * 1.005 + (1 - y / h) * r * 0.12, 0.14, 0, y, 0, shade(color, 0.78), 16);
  // Corbelled parapet.
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; b.box(0.35, 0.7, 0.35, Math.cos(a) * r * 1.02, h - 0.2, Math.sin(a) * r * 1.02, shade(color, 0.85)); }
  b.cyl(r * 1.18, 1, 0, h, 0, color, 16);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.box(r * 0.5, 1.1, 0.6, Math.cos(a) * r * 1.1, h + 1.5, Math.sin(a) * r * 1.1, color, -a + Math.PI / 2);
  }
  if (roof !== undefined) {
    b.cone(r * 1.35, r * 2.2, 0, h + 1, 0, roof, 12);
    b.cyl(0.08, 2.2, 0, h + 1 + r * 2.1, 0, 0x2a2a30, 6);
    b.box(1.4, 0.8, 0.04, 0.72, h + 2.6 + r * 2.1, 0, shade(roof, 0.9));
  }
  for (let i = 0; i < 3; i++) {
    const y = h * (0.35 + i * 0.2), rr = r * (1.12 - 0.12 * (y / h));
    b.box(0.25, 1.1, 0.25, 0, y, rr, 0x14141a);
    b.box(0.7, 0.18, 0.35, 0, y + 0.66, rr, shade(color, 1.12));
  }
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
  // Stepped courses capped by a gilded pyramidion, with a dark entrance.
  const tiers = 9;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers, w = size * 1.02 * (1 - t), hh = (size * 0.62) / tiers;
    b.box(w, hh, w, 0, hh * (i + 0.5), 0, i % 2 ? color : shade(color, 0.92));
  }
  b.cone(size * 0.12 * 0.72, size * 0.62 / tiers * 1.5, 0, size * 0.62, 0, 0xffcf3f, 4, 0, Math.PI / 4);
  b.box(size * 0.12, size * 0.1, size * 0.1, 0, size * 0.05, size * 0.48, 0x2a1d14);
  b.box(size * 0.16, size * 0.02, size * 0.12, 0, size * 0.105, size * 0.48, shade(color, 1.1));
}

export function obelisk(b: GeoBatch, h: number, color: number) {
  b.box(2.4, 1, 2.4, 0, 0.5, 0, color);
  b.taper(0.9, 0.6, h, 0, 1, 0, color, 4, 0, Math.PI / 4);
  b.cone(0.6, 1.4, 0, h + 1, 0, 0xffcf3f, 4, 0, Math.PI / 4);
}

export function domeHouse(b: GeoBatch, r: number, wall: number, dome: number) {
  b.cyl(r, r * 1.2, 0, 0, 0, wall, 16);
  b.cyl(r * 1.06, 0.3, 0, r * 1.2 - 0.1, 0, shade(wall, 0.9), 16);
  b.shape('hemi', dome, 0, r * 1.2, 0, r, r, r);
  b.cone(0.2, 1.2, 0, r * 2.2, 0, 0xffcf3f, 6);
  b.sphere(0.3, 0, r * 2.2, 0, 0xffcf3f);
  // Arched door with a carved frame and a striped awning.
  b.box(1.5, 2.3, 0.3, 0, 1.15, r - 0.05, shade(wall, 0.85));
  b.box(1.2, 2.0, 0.3, 0, 1.0, r + 0.02, 0x4a3020);
  b.addGeo(UNIT.cyl12, 0x4a3020, mat(0, 2.0, r + 0.02, Math.PI / 2, 0, 0, 0.6, 0.3, 0.6));
  for (let i = 0; i < 4; i++) b.box(0.5, 0.06, 1.1, -0.75 + i * 0.5, 2.75, r + 0.45, i % 2 ? 0xf4ead4 : 0x2f8a8a, 0, 0.35);
  for (const a of [1.2, -1.2, 2.6]) b.box(0.55, 0.9, 0.15, Math.sin(a) * r, r * 0.75, Math.cos(a) * r, 0x2a2018, a);
}

export function sandHouse(b: GeoBatch, w: number, h: number, d: number, color: number) {
  b.box(w, h, d, 0, h / 2, 0, color);
  b.box(w + 0.3, 0.4, d + 0.3, 0, h + 0.2, 0, shade(color, 1.06));
  for (let i = 0; i < Math.floor(w / 0.9); i++) b.box(0.2, 0.2, 0.2, -w / 2 + 0.45 + i * 0.9, h - 0.3, d / 2 + 0.1, shade(color, 0.7));
  b.box(1.3, 2.1, 0.25, 0, 1.05, d / 2 + 0.02, shade(color, 0.85));
  b.box(1, 1.8, 0.2, 0, 0.9, d / 2 + 0.08, 0x3a2a1a);
  b.box(0.8, 0.8, 0.2, w / 3, h * 0.7, d / 2 + 0.05, 0x2a2018);
  b.box(1.0, 0.1, 0.3, w / 3, h * 0.7 - 0.46, d / 2 + 0.15, shade(color, 0.85));
  // Rooftop clutter: pots, a rug drying and a ladder.
  b.cyl(0.3, 0.6, -w / 4, h + 0.4, -d / 5, 0xb8643a, 8);
  b.cyl(0.25, 0.5, -w / 4 + 0.7, h + 0.4, -d / 5 + 0.3, 0xa85a32, 8);
  b.box(w * 0.4, 0.05, 1.4, w / 5, h + 0.45, 0, 0xb8322a);
  for (const sx of [-0.3, 0.3]) b.box(0.08, h + 0.6, 0.08, -w / 2 - 0.2 + sx, (h + 0.6) / 2, d / 4, 0x6a4a2a, 0, 0, 0.12);
  for (let i = 0; i < 5; i++) b.box(0.6, 0.06, 0.06, -w / 2 - 0.15, 0.4 + i * (h / 5), d / 4, 0x6a4a2a);
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
