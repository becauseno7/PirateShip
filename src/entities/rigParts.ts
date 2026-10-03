// Geometry and texture builders for the anime character rig: head shape, painted faces,
// hair clumps, cloth shells and hands.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ---- Head ---------------------------------------------------------------------------------

/** Anime head shape applied to one point centred on the skull: slim jaw, pointed chin, round cranium. */
export function deformPoint(v: THREE.Vector3, r: number, jaw = 1) {
  let { x, y, z } = v;
  const yn = y / r;
  if (yn < 0.15) {
    const k = Math.min(1, (0.15 - yn) / 1.15);
    x *= 1 - 0.36 * jaw * k * k;
    if (z < 0) z *= 1 - 0.32 * k * k;
    else z *= 1 + 0.05 * k;
    y -= 0.08 * r * k * k * jaw;
  }
  if (z < 0 && yn > -0.25) z *= 1.07;
  x *= 0.95;
  return v.set(x, y, z);
}

export function deformHead(geo: THREE.BufferGeometry, r: number, jaw = 1) {
  const p = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    deformPoint(v.fromBufferAttribute(p, i), r, jaw);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  p.needsUpdate = true;
  return geo;
}

/** A point on the (deformed) skull from polar angle `th` (0 = crown) and azimuth `ph` (0 = face). */
export function headPoint(th: number, ph: number, r: number, jaw: number) {
  return deformPoint(new THREE.Vector3(r * Math.sin(th) * Math.sin(ph), r * Math.cos(th), r * Math.sin(th) * Math.cos(ph)), r, jaw);
}

/** Anime face shading: bend normals toward a sphere so the jaw doesn't throw a hard shadow band across the face. */
function softNormals(geo: THREE.BufferGeometry, r: number, k = 0.72) {
  const p = geo.attributes.position as THREE.BufferAttribute, n = geo.attributes.normal as THREE.BufferAttribute;
  const v = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Vector3(0, r * 0.12, -r * 0.08);
  for (let i = 0; i < p.count; i++) {
    s.fromBufferAttribute(p, i).sub(c).normalize();
    v.fromBufferAttribute(n, i).lerp(s, k).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  n.needsUpdate = true;
  return geo;
}

const headCache = new Map<string, THREE.BufferGeometry>();
export function headGeometry(r: number, jaw: number) {
  const k = r.toFixed(3) + jaw.toFixed(2);
  let g = headCache.get(k);
  if (!g) {
    const s = new THREE.SphereGeometry(r, 32, 24);
    s.deleteAttribute('uv');
    g = mergeVertices(deformHead(s, r, jaw));
    g.computeVertexNormals();
    softNormals(g, r);
    headCache.set(k, g);
  }
  return g;
}

// The painted face covers this patch of the head sphere (front-facing).
const FACE_PHI = 1.9, FACE_T0 = 0.6, FACE_TL = 1.62;
const faceGeoCache = new Map<string, THREE.BufferGeometry>();
export function faceGeometry(r: number, jaw: number) {
  const k = r.toFixed(3) + jaw.toFixed(2);
  let g = faceGeoCache.get(k);
  if (!g) {
    const rr = r * 1.006;
    g = deformHead(new THREE.SphereGeometry(rr, 30, 22, Math.PI / 2 - FACE_PHI / 2, FACE_PHI, FACE_T0, FACE_TL), rr, jaw);
    g.computeVertexNormals();
    softNormals(g, rr);
    faceGeoCache.set(k, g);
  }
  return g;
}

// ---- Faces ----------------------------------------------------------------------------------

export type FaceStyle = 'hero' | 'grunt' | 'brute' | 'fem' | 'elder';
export interface FaceOpts { style: FaceStyle; iris: string; brow: string; skin: string; scar: boolean; glow: string | null }
/** Atlas cells: 4 columns x 2 rows. */
export const EXPR = { neutral: 0, blink: 1, angry: 2, shout: 3, pain: 4, grin: 5, focus: 6, ko: 7 } as const;
export type Expr = keyof typeof EXPR;

type EyeState = 'open' | 'narrow' | 'wide' | 'closed' | 'happy' | 'squeeze' | 'x';
type BrowState = 'neutral' | 'angry' | 'worried' | 'raised';
type MouthState = 'smile' | 'shout' | 'teeth' | 'grin' | 'pain' | 'flat' | 'wavy';
const CELL = 256;
const INK = '#1c120e';

function shade(hex: string, k: number) {
  const c = new THREE.Color(hex);
  if (k < 1) c.multiplyScalar(k); else c.lerp(new THREE.Color(1, 1, 1), k - 1);
  return '#' + c.getHexString();
}

interface FaceMetrics { eyeX: number; eyeY: number; eyeW: number; eyeH: number; lid: number; browY: number; browW: number; browT: number; mouthY: number; noseY: number }
function metrics(style: FaceStyle): FaceMetrics {
  switch (style) {
    case 'hero': return { eyeX: 53, eyeY: 156, eyeW: 60, eyeH: 60, lid: 8, browY: 110, browW: 44, browT: 7, mouthY: 214, noseY: 188 };
    case 'fem': return { eyeX: 53, eyeY: 157, eyeW: 60, eyeH: 62, lid: 8, browY: 111, browW: 40, browT: 4, mouthY: 214, noseY: 189 };
    case 'brute': return { eyeX: 50, eyeY: 154, eyeW: 44, eyeH: 30, lid: 7, browY: 128, browW: 48, browT: 12, mouthY: 216, noseY: 188 };
    case 'elder': return { eyeX: 50, eyeY: 154, eyeW: 42, eyeH: 30, lid: 6, browY: 126, browW: 44, browT: 9, mouthY: 214, noseY: 188 };
    default: return { eyeX: 51, eyeY: 155, eyeW: 50, eyeH: 44, lid: 7, browY: 118, browW: 42, browT: 7, mouthY: 214, noseY: 188 };
  }
}

function drawEye(g: CanvasRenderingContext2D, ox: number, s: -1 | 1, m: FaceMetrics, o: FaceOpts, st: EyeState, emis: CanvasRenderingContext2D | null) {
  const cx = ox + CELL / 2 + s * m.eyeX, cy = m.eyeY;
  let w = m.eyeW, h = m.eyeH;
  const inner = cx - s * w / 2, outer = cx + s * w / 2;
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = INK; g.fillStyle = INK;
  if (st === 'closed' || st === 'happy' || st === 'squeeze' || st === 'x') {
    g.lineWidth = m.lid * 0.85;
    g.beginPath();
    if (st === 'closed') { g.moveTo(outer, cy + h * 0.12); g.quadraticCurveTo(cx, cy + h * 0.42, inner, cy + h * 0.12); }
    else if (st === 'happy') { g.moveTo(outer, cy + h * 0.25); g.quadraticCurveTo(cx, cy - h * 0.35, inner, cy + h * 0.25); }
    else if (st === 'squeeze') { g.moveTo(outer, cy - h * 0.3); g.lineTo(inner + s * w * 0.15, cy + h * 0.05); g.lineTo(outer, cy + h * 0.35); }
    else { const r = h * 0.38; g.moveTo(cx - r, cy - r); g.lineTo(cx + r, cy + r); g.moveTo(cx + r, cy - r); g.lineTo(cx - r, cy + r); }
    g.stroke();
    if (st === 'closed') { g.lineWidth = m.lid * 0.6; g.beginPath(); g.moveTo(outer, cy + h * 0.12); g.lineTo(outer + s * w * 0.14, cy + h * 0.02); g.stroke(); }
    return;
  }
  // Lid shapes: upper lid control points depend on the mood.
  let upOuterY = cy - h * 0.18, upTopY = cy - h * 0.62, upInnerY = cy - h * 0.02, lowY = cy + h * 0.5;
  if (st === 'narrow') { h *= 0.82; upOuterY = cy - h * 0.42; upTopY = cy - h * 0.5; upInnerY = cy + h * 0.06; lowY = cy + h * 0.45; }
  if (st === 'wide') { w *= 1.04; upTopY = cy - h * 0.72; lowY = cy + h * 0.58; }
  const shape = () => {
    g.beginPath();
    g.moveTo(outer, upOuterY);
    g.bezierCurveTo(outer - s * w * 0.12, upTopY, inner + s * w * 0.25, upTopY, inner, upInnerY);
    g.bezierCurveTo(inner + s * w * 0.1, lowY, outer - s * w * 0.18, lowY + h * 0.02, outer, upOuterY);
    g.closePath();
  };
  // Sclera.
  shape();
  g.fillStyle = o.glow ? '#140c12' : '#fbf7f2';
  g.fill();
  g.save();
  shape();
  g.clip();
  // Iris + pupil + highlights.
  const ix = cx - s * w * 0.04, iy = cy + h * 0.06;
  const irx = w * (st === 'wide' ? 0.24 : 0.3), iry = h * (st === 'narrow' ? 0.62 : 0.5);
  const irisCol = o.glow ?? o.iris;
  const grd = g.createLinearGradient(0, iy - iry, 0, iy + iry);
  grd.addColorStop(0, shade(irisCol, 0.35));
  grd.addColorStop(0.55, irisCol);
  grd.addColorStop(1, shade(irisCol, 1.45));
  g.fillStyle = grd;
  g.beginPath(); g.ellipse(ix, iy, irx, iry, 0, 0, Math.PI * 2); g.fill();
  g.lineWidth = 1.5; g.strokeStyle = shade(irisCol, 0.3); g.stroke();
  g.fillStyle = o.glow ? '#fff8e8' : '#0d0807';
  g.beginPath(); g.ellipse(ix, iy + iry * 0.08, o.glow ? irx * 0.18 : irx * 0.46, iry * 0.52, 0, 0, Math.PI * 2); g.fill();
  // Shadow cast by the upper lid.
  g.fillStyle = 'rgba(30,20,30,0.28)';
  g.beginPath(); g.ellipse(cx, upTopY + h * 0.05, w * 0.7, h * 0.3, 0, 0, Math.PI * 2); g.fill();
  if (!o.glow) {
    g.fillStyle = '#ffffff';
    g.beginPath(); g.ellipse(ix - irx * 0.35, iy - iry * 0.35, irx * 0.36, iry * 0.26, -0.4, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(ix + irx * 0.4, iy + iry * 0.42, irx * 0.16, 0, Math.PI * 2); g.fill();
  }
  g.restore();
  if (emis && o.glow) {
    emis.fillStyle = '#ffffff';
    emis.beginPath(); emis.ellipse(ix, iy, irx, iry * 0.9, 0, 0, Math.PI * 2); emis.fill();
  }
  // Lash line (thick upper lid, flick at the outer corner) and a thin lower lid.
  g.strokeStyle = INK; g.fillStyle = INK;
  g.lineWidth = m.lid;
  g.beginPath();
  g.moveTo(outer + s * w * 0.06, upOuterY + h * 0.04);
  g.bezierCurveTo(outer - s * w * 0.12, upTopY, inner + s * w * 0.25, upTopY, inner, upInnerY);
  g.stroke();
  g.lineWidth = m.lid * 0.7;
  g.beginPath(); g.moveTo(outer, upOuterY); g.lineTo(outer + s * w * 0.2, upOuterY - h * 0.12); g.stroke();
  if (o.style === 'fem') {
    g.lineWidth = 2.4;
    for (let i = 0; i < 3; i++) {
      const t = 0.12 + i * 0.13;
      const bx = outer - s * w * t, by = upTopY + (upOuterY - upTopY) * (1 - t * 2.2) * 0.6;
      g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + s * w * 0.12, by - h * 0.2); g.stroke();
    }
  }
  g.lineWidth = Math.max(1.5, m.lid * 0.35);
  g.beginPath();
  g.moveTo(outer - s * w * 0.05, upOuterY + h * 0.2);
  g.quadraticCurveTo(cx, lowY + h * 0.06, inner + s * w * 0.25, lowY - h * 0.06);
  g.stroke();
}

function drawBrow(g: CanvasRenderingContext2D, ox: number, s: -1 | 1, m: FaceMetrics, o: FaceOpts, st: BrowState) {
  const cx = ox + CELL / 2 + s * m.eyeX;
  const w = m.browW, t = m.browT;
  const inner = cx - s * w * 0.5, outer = cx + s * w * 0.55;
  let yi = m.browY + 2, yo = m.browY + 1, arch = -5;
  if (st === 'angry') { yi = m.browY + 14; yo = m.browY - 5; arch = 2; }
  if (st === 'worried') { yi = m.browY - 8; yo = m.browY + 6; arch = -2; }
  if (st === 'raised') { yi = m.browY - 6; yo = m.browY - 4; arch = -8; }
  g.fillStyle = o.brow;
  g.beginPath();
  g.moveTo(inner, yi - t * 0.5);
  g.quadraticCurveTo(cx, (yi + yo) / 2 + arch - t * 0.6, outer, yo - t * 0.15);
  g.quadraticCurveTo(cx, (yi + yo) / 2 + arch + t * 0.5, inner, yi + t * 0.5);
  g.closePath();
  g.fill();
  g.strokeStyle = shade(o.brow, 0.6); g.lineWidth = 1; g.stroke();
}

function drawMouth(g: CanvasRenderingContext2D, ox: number, m: FaceMetrics, o: FaceOpts, st: MouthState) {
  const cx = ox + CELL / 2, cy = m.mouthY;
  const lip = o.style === 'fem' ? '#8a2a3a' : INK;
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = lip;
  const cavity = (path: () => void, teethTop: boolean, tongue: boolean, w: number, h: number) => {
    path(); g.fillStyle = '#5c1a1c'; g.fill();
    g.save(); path(); g.clip();
    if (tongue) { g.fillStyle = '#d0606a'; g.beginPath(); g.ellipse(cx, cy + h * 0.85, w * 0.32, h * 0.38, 0, 0, Math.PI * 2); g.fill(); }
    if (teethTop) { g.fillStyle = '#fbf6ee'; g.fillRect(cx - w, cy - h, w * 2, h * 0.55); }
    g.restore();
    path(); g.lineWidth = 3; g.strokeStyle = lip; g.stroke();
  };
  switch (st) {
    case 'smile':
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(cx - 15, cy - 3); g.quadraticCurveTo(cx, cy + 7, cx + 15, cy - 3); g.stroke();
      break;
    case 'flat':
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(cx - 10, cy + 1); g.quadraticCurveTo(cx, cy - 2, cx + 10, cy + 2); g.stroke();
      break;
    case 'wavy':
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(cx - 12, cy); for (let i = 1; i <= 6; i++) g.lineTo(cx - 12 + i * 4, cy + (i % 2 ? -3 : 3)); g.stroke();
      break;
    case 'shout': {
      const w = 17, h = 17;
      cavity(() => { g.beginPath(); g.moveTo(cx - w, cy - h * 0.55); g.quadraticCurveTo(cx, cy - h * 0.9, cx + w, cy - h * 0.55); g.quadraticCurveTo(cx + w * 0.8, cy + h * 1.2, cx, cy + h * 1.25); g.quadraticCurveTo(cx - w * 0.8, cy + h * 1.2, cx - w, cy - h * 0.55); g.closePath(); }, true, true, w, h);
      break;
    }
    case 'grin': {
      const w = 22, h = 13;
      cavity(() => { g.beginPath(); g.moveTo(cx - w, cy - h * 0.6); g.quadraticCurveTo(cx, cy - h * 0.2, cx + w, cy - h * 0.6); g.quadraticCurveTo(cx + w * 0.7, cy + h * 1.3, cx, cy + h * 1.3); g.quadraticCurveTo(cx - w * 0.7, cy + h * 1.3, cx - w, cy - h * 0.6); g.closePath(); }, true, true, w, h);
      break;
    }
    case 'teeth': {
      const w = 18, h = 8;
      g.fillStyle = '#fbf6ee';
      g.beginPath(); g.roundRect(cx - w, cy - h, w * 2, h * 2, 4); g.fill();
      g.lineWidth = 2.5; g.strokeStyle = INK; g.stroke();
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(cx - w, cy); g.lineTo(cx + w, cy);
      for (let i = -2; i <= 2; i++) { g.moveTo(cx + i * 7, cy - h); g.lineTo(cx + i * 7, cy + h); }
      g.stroke();
      break;
    }
    case 'pain': {
      const w = 12, h = 9;
      cavity(() => { g.beginPath(); g.moveTo(cx - w, cy + 2); g.quadraticCurveTo(cx - w * 0.5, cy - h, cx, cy - h * 0.3); g.quadraticCurveTo(cx + w * 0.5, cy - h, cx + w, cy + 2); g.quadraticCurveTo(cx, cy + h * 1.1, cx - w, cy + 2); g.closePath(); }, true, false, w, h);
      break;
    }
  }
}

function drawCell(g: CanvasRenderingContext2D, emis: CanvasRenderingContext2D, col: number, row: number, o: FaceOpts, eye: EyeState, brow: BrowState, mouth: MouthState) {
  const ox = col * CELL, oy = row * CELL;
  g.save(); g.translate(0, oy);
  emis.save(); emis.translate(0, oy);
  const m = metrics(o.style);
  // Soft cheek blush for the young faces.
  if (o.style === 'hero' || o.style === 'fem') {
    g.fillStyle = 'rgba(230,110,100,0.16)';
    for (const s of [-1, 1]) { g.beginPath(); g.ellipse(ox + CELL / 2 + s * 56, m.eyeY + 38, 18, 8, 0, 0, Math.PI * 2); g.fill(); }
  }
  // Nose: a small shading stroke.
  g.strokeStyle = shade(o.skin, 0.62); g.lineWidth = 2.5; g.lineCap = 'round';
  g.beginPath(); g.moveTo(ox + CELL / 2 + 1, m.noseY - 10); g.quadraticCurveTo(ox + CELL / 2 + 5, m.noseY - 1, ox + CELL / 2 - 1, m.noseY + 1); g.stroke();
  if (o.style === 'brute' || o.style === 'elder') {
    g.strokeStyle = shade(o.skin, 0.7); g.lineWidth = 2;
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(ox + CELL / 2 + s * 18, m.noseY + 2); g.quadraticCurveTo(ox + CELL / 2 + s * 26, m.mouthY - 4, ox + CELL / 2 + s * 22, m.mouthY + 6); g.stroke(); }
  }
  for (const s of [-1, 1] as const) {
    drawEye(g, ox, s, m, o, eye, emis);
    drawBrow(g, ox, s, m, o, brow);
  }
  drawMouth(g, ox, m, o, mouth);
  if (o.scar) {
    // Stitched scar under the captain's left eye (viewer's right).
    const sx = ox + CELL / 2 + m.eyeX + 2, sy = m.eyeY + m.eyeH * 0.75 + 4;
    g.strokeStyle = '#8a3a30'; g.lineWidth = 2.5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(sx - 11, sy + 1); g.quadraticCurveTo(sx, sy - 2, sx + 11, sy + 2); g.stroke();
    g.lineWidth = 2;
    for (const dx of [-5, 4]) { g.beginPath(); g.moveTo(sx + dx - 2, sy - 5); g.lineTo(sx + dx + 2, sy + 5); g.stroke(); }
  }
  g.restore(); emis.restore();
}

const faceCache = new Map<string, { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture | null }>();
/** Paints an expression atlas for a face. Shared between characters with the same look. */
export function faceAtlas(o: FaceOpts) {
  const key = JSON.stringify(o);
  let f = faceCache.get(key);
  if (f) return f;
  const cv = document.createElement('canvas');
  cv.width = CELL * 4; cv.height = CELL * 2;
  const g = cv.getContext('2d')!;
  const ecv = document.createElement('canvas');
  ecv.width = cv.width; ecv.height = cv.height;
  const e = ecv.getContext('2d')!;
  e.fillStyle = '#000'; e.fillRect(0, 0, ecv.width, ecv.height);
  const fierce = o.style === 'brute' || !!o.glow;
  const cells: [number, number, EyeState, BrowState, MouthState][] = [
    [0, 0, fierce ? 'narrow' : 'open', fierce ? 'angry' : 'neutral', fierce ? 'flat' : 'smile'],
    [1, 0, 'closed', fierce ? 'angry' : 'neutral', fierce ? 'flat' : 'smile'],
    [2, 0, 'narrow', 'angry', 'teeth'],
    [3, 0, 'wide', 'angry', 'shout'],
    [0, 1, 'squeeze', 'worried', 'pain'],
    [1, 1, o.style === 'hero' ? 'happy' : 'open', 'raised', 'grin'],
    [2, 1, 'narrow', 'angry', 'flat'],
    [3, 1, 'x', 'worried', 'wavy'],
  ];
  for (const [c, r, eye, brow, mouth] of cells) drawCell(g, e, c, r, o, eye, brow, mouth);
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const emissive = o.glow ? new THREE.CanvasTexture(ecv) : null;
  f = { map, emissive };
  faceCache.set(key, f);
  return f;
}

/** Per-character view onto a shared atlas, so each face can change expression independently. */
export function atlasView(t: THREE.Texture) {
  const v = t.clone();
  v.repeat.set(0.25, 0.5);
  v.needsUpdate = true;
  return v;
}
export function setAtlasCell(t: THREE.Texture, cell: number) {
  t.offset.set((cell % 4) * 0.25, cell < 4 ? 0.5 : 0);
}

// ---- Hair -----------------------------------------------------------------------------------

/**
 * Scalp cap whose hairline follows the face: high at the forehead, low at the nape.
 * `front`, `side` and `back` are the polar angles (radians from the crown) where the hair ends.
 */
export function hairCap(r: number, jaw: number, front: number, side: number, back: number, fringeJag = 0) {
  const seg = 40, rows = 14;
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2; // a=0 faces +z (front)
    const c = Math.cos(a);
    const lim0 = c > 0 ? front + (side - front) * (1 - c) : side + (back - side) * (-c);
    const jag = fringeJag * (c > 0.3 ? Math.max(0, Math.sin(i * 2.4)) * c : 0);
    const lim = lim0 + jag;
    for (let j = 0; j <= rows; j++) {
      const th = (j / rows) * lim;
      pos.push(r * Math.sin(th) * Math.sin(a), r * Math.cos(th), r * Math.sin(th) * Math.cos(a));
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < rows; j++) {
    const p0 = i * (rows + 1) + j, p1 = (i + 1) * (rows + 1) + j;
    idx.push(p0, p0 + 1, p1, p1, p0 + 1, p1 + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  deformHead(g, r, jaw);
  const m = mergeVertices(g);
  m.computeVertexNormals();
  return m;
}

/** A tapered, curved hair clump pointing along +Y, base at the origin. */
const spikeCache = new Map<string, THREE.BufferGeometry>();
export function hairSpike(len: number, rad: number, bend: number) {
  const k = `${len.toFixed(3)}:${rad.toFixed(3)}:${bend.toFixed(2)}`;
  let g = spikeCache.get(k);
  if (g) return g;
  g = new THREE.ConeGeometry(rad, len, 5, 6);
  g.translate(0, len / 2, 0);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), t = y / len;
    p.setZ(i, p.getZ(i) * 0.55 + bend * len * t * t);
  }
  g.computeVertexNormals();
  spikeCache.set(k, g);
  return g;
}

export type HairStyle = 'spiky' | 'messy' | 'long' | 'topknot' | 'bald' | 'wild';

/** Seeded random so every character with the same hairstyle shares one geometry. */
function seeded(seed: number) {
  let t = seed >>> 0;
  return () => { t += 0x6d2b79f5; let x = Math.imul(t ^ (t >>> 15), 1 | t); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}

const DOWN = new THREE.Vector3(0, -1, 0);
const clumpCache = new Map<string, { cap: THREE.BufferGeometry; clumps: THREE.BufferGeometry | null }>();
/** Hair for a style: a scalp cap plus merged clumps (fringe, sides, back, crown). */
export function hairGeometry(style: HairStyle, r: number, jaw: number, hatted = false) {
  const key = style + r.toFixed(3) + jaw.toFixed(2) + hatted;
  const hit = clumpCache.get(key);
  if (hit) return hit;
  const rnd = seeded(style.length * 977 + 13);
  const R = r * 1.04;
  const parts: THREE.BufferGeometry[] = [];
  const clump = (th: number, ph: number, len: number, rad: number, out: number, droop: number, fwd = 0, bend = 0, roll = 0) => {
    if (hatted && th < 0.95 && droop < 0.5) return;
    const base = headPoint(th, ph, R, jaw);
    const n = base.clone().normalize();
    const dir = n.clone().multiplyScalar(out).addScaledVector(DOWN, droop);
    dir.z += fwd;
    const g = hairSpike(len, rad, bend).clone();
    const o = new THREE.Object3D();
    aim(o, dir, roll || Math.atan2(n.x, n.z));
    o.position.copy(base).multiplyScalar(0.94);
    o.updateMatrix();
    g.applyMatrix4(o.matrix);
    parts.push(g);
  };
  let cap: [number, number, number, number];
  const j = () => (rnd() - 0.5);
  switch (style) {
    case 'messy':
      cap = [0.98, 1.5, 1.95, 0.12];
      for (let i = 0; i < 8; i++) clump(0.6 + j() * 0.08, -0.9 + i * 0.257, 0.11 + rnd() * 0.035, 0.045, 0.8, 0.85, 0.5, 0.3);
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) clump(1.0 + i * 0.12, s * (1.6 + i * 0.22), 0.14 + rnd() * 0.04, 0.045, 0.75, 1.0, -0.05, 0.15);
      for (let i = 0; i < 9; i++) clump(1.45 + j() * 0.15, 2.2 + i * 0.23, 0.15 + rnd() * 0.05, 0.05, 0.8, 1.1, -0.2, 0.2);
      for (let i = 0; i < 7; i++) clump(0.35 + rnd() * 0.45, rnd() * Math.PI * 2, 0.09 + rnd() * 0.04, 0.045, 1, 0.1, 0, 0.1);
      break;
    case 'spiky':
      cap = [1.0, 1.45, 1.75, 0.05];
      for (let i = 0; i < 18; i++) { const th = 0.2 + rnd() * 0.85, ph = rnd() * Math.PI * 2; clump(th, ph, 0.11 + rnd() * 0.06, 0.045, 1, -0.35, 0, -0.1); }
      for (let i = 0; i < 5; i++) clump(0.8, -0.7 + i * 0.35, 0.1, 0.04, 0.9, 0.3, 0.3, 0.2);
      break;
    case 'wild':
      cap = [0.95, 1.5, 1.9, 0.1];
      for (let i = 0; i < 22; i++) { const th = 0.25 + rnd() * 1.1, ph = rnd() * Math.PI * 2; clump(th, ph, 0.2 + rnd() * 0.12, 0.06, 1, -0.1, -0.35, -0.2); }
      for (let i = 0; i < 6; i++) clump(0.75, -0.8 + i * 0.32, 0.14, 0.045, 0.7, 0.8, 0.3, 0.25);
      break;
    case 'long':
      cap = [0.92, 1.55, 2.0, 0.08];
      for (let i = 0; i < 6; i++) clump(0.78, (i < 3 ? -1 : 1) * (0.25 + (i % 3) * 0.28), 0.15, 0.045, 0.45, 1.0, 0.25, 0.3);
      for (const s of [-1, 1]) { clump(1.15, s * 1.25, 0.38, 0.055, 0.25, 1.0, 0.12, 0.1); clump(1.3, s * 1.55, 0.42, 0.06, 0.25, 1.0, 0, 0.05); }
      for (let i = 0; i < 9; i++) clump(1.55 + j() * 0.1, 2.15 + i * 0.25, 0.45 + rnd() * 0.08, 0.07, 0.35, 1.0, -0.25, -0.12);
      break;
    case 'topknot':
      cap = [1.02, 1.5, 1.8, 0];
      for (let i = 0; i < 5; i++) clump(0.85, -0.6 + i * 0.3, 0.08, 0.035, 0.6, 0.9, 0.3, 0.2);
      break;
    default:
      cap = [0, 0, 0, 0];
  }
  const capGeo = style === 'bald' ? new THREE.BufferGeometry() : hairCap(R, jaw, cap[0], cap[1], cap[2], cap[3]);
  const res = { cap: capGeo, clumps: parts.length ? mergeGeometries(parts.map((g) => { g.deleteAttribute('uv'); return g; })) : null };
  clumpCache.set(key, res);
  return res;
}

/** Facial hair: chin beard and moustache clumps. */
const beardCache = new Map<string, THREE.BufferGeometry>();
export function beardGeometry(r: number, jaw: number, full: boolean) {
  const key = r.toFixed(3) + jaw.toFixed(2) + full;
  let g = beardCache.get(key);
  if (g) return g;
  const rnd = seeded(full ? 91 : 37);
  const parts: THREE.BufferGeometry[] = [];
  const clump = (th: number, ph: number, len: number, rad: number, dir: THREE.Vector3) => {
    const base = headPoint(th, ph, r * 1.0, jaw);
    const s = hairSpike(len, rad, 0.15).clone();
    const o = new THREE.Object3D();
    aim(o, dir, ph);
    o.position.copy(base);
    o.updateMatrix();
    s.applyMatrix4(o.matrix);
    s.deleteAttribute('uv');
    parts.push(s);
  };
  const n = full ? 11 : 6;
  for (let i = 0; i < n; i++) {
    const ph = -1.2 + (i / (n - 1)) * 2.4;
    const th = 2.0 + (1 - Math.abs(ph) / 1.2) * 0.35;
    clump(th, ph, (full ? 0.2 : 0.12) * (1 - Math.abs(ph) * 0.25) + rnd() * 0.03, full ? 0.06 : 0.045, new THREE.Vector3(Math.sin(ph) * 0.3, -1, 0.45));
  }
  for (const s of [-1, 1]) clump(1.92, s * 0.18, 0.09, 0.03, new THREE.Vector3(s * 1, -0.6, 0.2));
  g = mergeGeometries(parts);
  beardCache.set(key, g);
  return g;
}

/** Orient an object so +Y points along `dir`, then roll around it. */
export function aim(o: THREE.Object3D, dir: THREE.Vector3, roll = 0) {
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  if (roll) o.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), roll));
}

// ---- Cloth ----------------------------------------------------------------------------------

/**
 * A lathe-like body shell from a [y, radiusX, radiusZ] profile with an optional front opening
 * whose half-angle can vary with height (open vests, coats).
 */
export function shell(profile: [number, number, number][], gap: (y: number) => number = () => 0, seg = 28) {
  const pos: number[] = [], idx: number[] = [];
  const rows = profile.length;
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    for (let j = 0; j < rows; j++) {
      const [y, rx, rz] = profile[j];
      const ga = gap(y);
      const a = ga + u * (Math.PI * 2 - ga * 2); // 0 = front (+z)
      pos.push(Math.sin(a) * rx, y, Math.cos(a) * rz);
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < rows - 1; j++) {
    const a = i * rows + j, b = (i + 1) * rows + j;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const closed = profile.every(([y]) => gap(y) === 0);
  const m = closed ? mergeVertices(g) : g;
  m.computeVertexNormals();
  return m;
}

/** A clenched fist (palm, rolled fingers, knuckles, thumb) merged into one geometry. */
const fistCache = new Map<string, THREE.BufferGeometry>();
export function fistGeometry(s: number, side: 1 | -1) {
  const key = s.toFixed(3) + side;
  let g = fistCache.get(key);
  if (g) return g;
  const parts: THREE.BufferGeometry[] = [];
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rz = 0, rx = 0) => {
    const o = new THREE.Object3D();
    o.position.set(x * s, y * s, z * s);
    o.scale.set(sx, sy, sz);
    o.rotation.set(rx, 0, rz);
    o.updateMatrix();
    geo.applyMatrix4(o.matrix);
    geo.deleteAttribute('uv');
    parts.push(geo);
  };
  add(new THREE.SphereGeometry(0.05 * s, 12, 10), 0, -0.035, 0.0, 1.1, 1.2, 0.85);
  add(new THREE.CapsuleGeometry(0.029 * s, 0.05 * s, 4, 8), 0, -0.072, 0.026, 1, 1, 1, Math.PI / 2);
  for (let i = 0; i < 4; i++) add(new THREE.SphereGeometry(0.016 * s, 8, 6), -0.033 + i * 0.022, -0.092, 0.03);
  add(new THREE.CapsuleGeometry(0.017 * s, 0.035 * s, 4, 8), side * -0.044, -0.055, 0.036, 1, 1, 1, side * 0.6, 0.5);
  g = mergeVertices(mergeGeometries(parts.map((p) => p.toNonIndexed())));
  g.computeVertexNormals();
  fistCache.set(key, g);
  return g;
}
