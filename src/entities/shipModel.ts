// Procedural sailing ship model: lofted hull, decks, cabins, masts with
// billowing sails, flag, rigging, cannons and a figurehead.
import * as THREE from 'three';
import { toonGradient, outlineMat } from '../world/materials';
import { GeoBatch, mat } from '../world/props';

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_TORUS = new THREE.TorusGeometry(1, 0.18, 6, 16);

export type ShipStyle = 'player' | 'pirate' | 'navy' | 'boss';

export interface ShipDims { L: number; W: number; deckY: number; qd: number; fc: number }

export interface ShipParts {
  root: THREE.Group;
  sails: { mesh: THREE.Mesh; base: Float32Array; w: number; h: number; mast: number }[];
  flag: THREE.Mesh;
  flagBase: Float32Array;
  wheel: THREE.Group;
  cannonsGroup: THREE.Group;
  cannonPorts: { pos: THREE.Vector3; side: 1 | -1 }[];
  windows: THREE.MeshStandardMaterial;
  hullMat: THREE.Material;
  trim: number;
}

export function halfWidth(d: ShipDims, z: number) {
  const u = (z + d.L / 2) / d.L;
  if (u <= 0) return d.W * 0.39;
  if (u >= 1) return 0.05;
  let f: number;
  if (u < 0.18) f = 0.78 + (u / 0.18) * 0.22;
  else if (u < 0.58) f = 1;
  else f = Math.pow(Math.cos(((u - 0.58) / 0.42) * Math.PI / 2), 0.75);
  return Math.max(0.05, (d.W / 2) * f);
}

function hullTop(d: ShipDims, u: number) {
  const sheer = 0.5 * Math.pow(Math.abs(u - 0.45) * 2, 2) + (u > 0.82 ? (u - 0.82) * 4 : 0);
  return d.deckY + 0.75 + sheer;
}
function hullKeel(u: number) {
  return -1.9 * (u < 0.92 ? 1 : 1 - (u - 0.92) / 0.08 * 0.6);
}
/** Outer hull half-width at local z and height y (matches the lofted hull). */
export function hullX(d: ShipDims, z: number, y: number) {
  const u = Math.min(1, Math.max(0, (z + d.L / 2) / d.L));
  const top = hullTop(d, u), keel = hullKeel(u);
  const a = Math.pow(Math.min(1, Math.max(0, (y - keel) / (top - keel))), 1 / 0.75);
  const bulge = Math.sin(a * Math.PI * 0.62) * 1.04;
  return halfWidth(d, z) * Math.min(1, bulge + (a > 0.9 ? 0.02 : 0)) * (a < 0.08 ? a / 0.08 * 0.3 : 1);
}

/** Walkable deck height (local) at local z. */
export function deckHeight(d: ShipDims, z: number) {
  const qz = -d.L / 2 + d.qd, fz = d.L / 2 - d.fc;
  if (z < qz) return d.deckY + 1.3;
  if (z < qz + 1.6) return d.deckY + 1.3 * (1 - (z - qz) / 1.6);
  if (z > fz + 1.4) return d.deckY + 0.8;
  if (z > fz) return d.deckY + 0.8 * ((z - fz) / 1.4);
  return d.deckY;
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function plankTexture(base: string, line: string) {
  const t = canvasTex(256, 256, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 16; i++) {
      g.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.08})`;
      g.fillRect(0, i * 16, 256, 16);
      g.fillStyle = line;
      g.fillRect(0, i * 16, 256, 1.5);
      for (let k = 0; k < 3; k++) { const x = Math.random() * 256; g.fillRect(x, i * 16, 1.5, 16); }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Jolly Roger: skull with crossbones, optionally wearing the captain's hat. */
export function jollyRoger(style: ShipStyle, hat: string = 'straw', hatColor = '#e9c46a') {
  return canvasTex(256, 160, (g) => {
    if (style === 'navy') {
      g.fillStyle = '#f4f6fa'; g.fillRect(0, 0, 256, 160);
      g.fillStyle = '#2a4a8a';
      g.beginPath(); g.moveTo(128, 30); g.lineTo(170, 80); g.lineTo(128, 130); g.lineTo(86, 80); g.closePath(); g.fill();
      g.fillStyle = '#f4f6fa'; g.font = 'bold 34px serif'; g.textAlign = 'center'; g.fillText('M', 128, 93);
      return;
    }
    g.fillStyle = '#111'; g.fillRect(0, 0, 256, 160);
    g.fillStyle = '#f2efe6';
    g.save(); g.translate(128, 92);
    for (const r of [0.6, -0.6]) {
      g.save(); g.rotate(r); g.fillRect(-70, -7, 140, 14);
      g.beginPath(); g.arc(-72, -6, 9, 0, 7); g.arc(-72, 6, 9, 0, 7); g.arc(72, -6, 9, 0, 7); g.arc(72, 6, 9, 0, 7); g.fill(); g.restore();
    }
    g.restore();
    g.beginPath(); g.arc(128, 78, 36, 0, Math.PI * 2); g.fill();
    g.fillRect(108, 96, 40, 26);
    g.fillStyle = '#111';
    g.beginPath(); g.arc(114, 78, 10, 0, 7); g.arc(142, 78, 10, 0, 7); g.fill();
    g.beginPath(); g.moveTo(128, 88); g.lineTo(122, 100); g.lineTo(134, 100); g.fill();
    for (let i = 0; i < 4; i++) g.fillRect(112 + i * 9, 110, 3, 12);
    if (style === 'player') {
      if (hat === 'straw') {
        g.fillStyle = hatColor; g.beginPath(); g.ellipse(128, 50, 62, 12, 0, 0, 7); g.fill();
        g.beginPath(); g.ellipse(128, 40, 34, 18, 0, Math.PI, 0); g.fill();
        g.fillStyle = '#c8282b'; g.fillRect(94, 40, 68, 7);
      } else if (hat === 'bandana') {
        g.fillStyle = hatColor; g.beginPath(); g.arc(128, 66, 38, Math.PI, 0); g.fill();
        g.fillRect(160, 60, 22, 8);
      } else if (hat === 'tricorn') {
        g.fillStyle = hatColor; g.beginPath(); g.moveTo(60, 56); g.lineTo(196, 56); g.lineTo(128, 22); g.closePath(); g.fill();
      }
    } else if (style === 'boss') {
      g.fillStyle = '#c8282b'; g.beginPath(); g.moveTo(96, 50); g.lineTo(104, 20); g.lineTo(116, 46); g.lineTo(128, 14); g.lineTo(140, 46); g.lineTo(152, 20); g.lineTo(160, 50); g.fill();
    } else {
      g.fillStyle = '#7a1414'; g.fillRect(92, 44, 72, 10);
    }
  });
}

export function buildShip(style: ShipStyle, d: ShipDims, look?: { hat: string; hatColor: string; sailColor?: number }): ShipParts {
  const root = new THREE.Group();
  const paint = { player: 0x2f6aa8, pirate: 0x5a1a1a, navy: 0xf2f2f2, boss: 0x2a2a2a }[style];
  const trim = { player: 0xe8c45a, pirate: 0x9a8a5a, navy: 0x2a4a8a, boss: 0xb8322a }[style];
  const hullWood = style === 'navy' ? 0x3a2a20 : style === 'boss' ? 0x1e1814 : 0x6a4428;
  const sailCol = look?.sailColor ?? ({ player: 0xf6f0e0, pirate: 0x2a2626, navy: 0xf8f8f8, boss: 0x3a0e0e }[style]);
  const L = d.L, W = d.W, deckY = d.deckY;

  // ---- Hull (lofted).
  const S = 36, K = 40;
  const pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [];
  const cPaint = new THREE.Color(paint), cWood = new THREE.Color(hullWood), cTrim = new THREE.Color(trim), cCopper = new THREE.Color(0x8a3626), cBoot = new THREE.Color(0xeee6d2);
  for (let s = 0; s <= S; s++) {
    const z = -L / 2 + (s / S) * L;
    const hw = halfWidth(d, z);
    const u = s / S;
    const top = hullTop(d, u);
    const keel = hullKeel(u);
    for (let k = 0; k <= K; k++) {
      // k=0 port gunwale → k=K/2 keel → k=K starboard gunwale
      const t = k / K;
      const side = t < 0.5 ? 1 : -1;
      const a = Math.abs(t - 0.5) * 2; // 1 at gunwale, 0 at keel
      const y = keel + (top - keel) * Math.pow(a, 0.75);
      const bulge = Math.sin(a * Math.PI * 0.62) * 1.04;
      const x = side * hw * Math.min(1, bulge + (a > 0.9 ? 0.02 : 0)) * (a < 0.08 ? a / 0.08 * 0.3 + 0.0 : 1);
      pos.push(x, y, z);
      uv.push(z / 4, y / 1.2);
      let c: THREE.Color;
      if (y < -0.25) c = cCopper;
      else if (y < 0.05) c = cBoot;
      else if (y > top - 0.2) c = cTrim;
      else if (y > deckY - 0.55 && y < deckY + 0.5) c = cPaint;
      else c = cWood;
      col.push(c.r, c.g, c.b);
    }
  }
  for (let s = 0; s < S; s++) for (let k = 0; k < K; k++) {
    const a = s * (K + 1) + k, b = a + K + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  // Transom (flat stern) cap.
  const sternStart = pos.length / 3;
  const zS = -L / 2;
  for (let k = 0; k <= K; k++) { pos.push(pos[k * 3], pos[k * 3 + 1], zS); uv.push(pos[k * 3] / 2, pos[k * 3 + 1] / 2); col.push(cWood.r, cWood.g, cWood.b); }
  pos.push(0, deckY + 0.6, zS); uv.push(0, 0); col.push(cWood.r, cWood.g, cWood.b);
  const centerIdx = pos.length / 3 - 1;
  for (let k = 0; k < K; k++) idx.push(sternStart + k, sternStart + k + 1, centerIdx);
  const hullGeo = new THREE.BufferGeometry();
  hullGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hullGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  hullGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  hullGeo.setIndex(idx);
  hullGeo.computeVertexNormals();
  const hullMat = new THREE.MeshToonMaterial({ vertexColors: true, map: plankTexture('#ffffff', 'rgba(0,0,0,0.35)'), gradientMap: toonGradient(), side: THREE.DoubleSide });
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.castShadow = true;
  hull.receiveShadow = true;
  root.add(hull);
  const hullOutline = new THREE.Mesh(hullGeo, outlineMat);
  hullOutline.scale.set(1.012, 1.01, 1.008);
  root.add(hullOutline);

  // ---- Deck surface.
  const dp: number[] = [], du: number[] = [], di: number[] = [];
  const DS = 24;
  for (let s = 0; s <= DS; s++) {
    const z = -L / 2 + 0.2 + (s / DS) * (L - 0.6);
    const hw = halfWidth(d, z) * 0.97;
    dp.push(-hw, deckY, z, hw, deckY, z);
    du.push(-hw / 3, z / 3, hw / 3, z / 3);
  }
  for (let s = 0; s < DS; s++) { const a = s * 2; di.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const deckGeo = new THREE.BufferGeometry();
  deckGeo.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3));
  deckGeo.setAttribute('uv', new THREE.Float32BufferAttribute(du, 2));
  deckGeo.setIndex(di);
  deckGeo.computeVertexNormals();
  const deckTex = plankTexture(style === 'navy' ? '#c8b088' : style === 'boss' ? '#4a3a2e' : '#b88a58', 'rgba(40,20,10,0.6)');
  deckTex.rotation = Math.PI / 2;
  const deckMat = new THREE.MeshToonMaterial({ map: deckTex, gradientMap: toonGradient() });
  const deck = new THREE.Mesh(deckGeo, deckMat);
  deck.receiveShadow = true;
  root.add(deck);

  // ---- Static props batch (cabins, masts, rails, barrels...).
  const b = new GeoBatch();
  b.jitter = 0.04;
  const wood = 0x8a5a34, darkWood = 0x4a3020, rope = 0xc8b48a;
  const qz = -L / 2 + d.qd, fz = L / 2 - d.fc;
  // Quarterdeck + captain's cabin.
  const qw = halfWidth(d, -L / 2 + d.qd / 2) * 1.9;
  b.box(qw, 1.3, d.qd, 0, deckY + 0.65, -L / 2 + d.qd / 2, hullWood);
  b.box(qw + 0.1, 0.1, d.qd + 0.1, 0, deckY + 1.3, -L / 2 + d.qd / 2, 0xb88a58);
  b.box(qw * 0.9, 0.06, 0.06, 0, deckY + 1.0, qz + 0.02, trim);
  b.box(0.5, 1.1, 0.06, 0, deckY + 0.55, qz + 0.02, darkWood);
  // Stairs up to the quarterdeck.
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) b.box(1.1, 0.3, 0.4, sx * (qw / 2 - 0.9), deckY + 0.15 + i * 0.3, qz + 1.4 - i * 0.4, 0xa07850);
  // Railings on the quarterdeck.
  for (const sx of [-1, 1]) {
    b.box(0.08, 0.08, d.qd, sx * qw / 2, deckY + 2.2, -L / 2 + d.qd / 2, wood);
    for (let z = -L / 2 + 0.3; z < qz; z += 0.9) b.box(0.06, 0.9, 0.06, sx * qw / 2, deckY + 1.75, z, wood);
  }
  b.box(qw, 0.08, 0.08, 0, deckY + 2.2, qz, wood);
  // Forecastle.
  const fw = halfWidth(d, fz + 1) * 1.85;
  b.box(fw, 0.8, d.fc - 0.6, 0, deckY + 0.4, fz + (d.fc - 0.6) / 2, hullWood);
  b.box(fw + 0.08, 0.1, d.fc - 0.5, 0, deckY + 0.8, fz + (d.fc - 0.6) / 2, 0xb88a58);
  // Masts.
  const mainZ = L * 0.04, foreZ = L * 0.3, mainH = L * 0.78, foreH = L * 0.6;
  b.taper(0.32, 0.18, mainH, 0, deckY, mainZ, wood, 10);
  b.taper(0.26, 0.15, foreH, 0, deckY, foreZ, wood, 10);
  if (L > 20) b.taper(0.22, 0.12, L * 0.42, 0, deckY + 1.3, -L / 2 + d.qd * 0.45, wood, 8);
  // Yards.
  const yard = (z: number, y: number, w: number) => b.addGeo(new THREE.CylinderGeometry(0.11, 0.11, w, 8), wood, mat(0, y, z, 0, 0, Math.PI / 2));
  yard(mainZ, deckY + mainH * 0.92, W * 1.15);
  yard(mainZ, deckY + mainH * 0.5, W * 1.35);
  yard(foreZ, deckY + foreH * 0.9, W * 0.95);
  yard(foreZ, deckY + foreH * 0.5, W * 1.15);
  // Crow's nest.
  b.cyl(0.9, 0.15, 0, deckY + mainH * 0.82, mainZ, darkWood, 12);
  b.addGeo(new THREE.CylinderGeometry(0.95, 0.9, 0.7, 12, 1, true), darkWood, mat(0, deckY + mainH * 0.82 + 0.42, mainZ));
  // Bowsprit.
  b.addGeo(new THREE.CylinderGeometry(0.1, 0.2, L * 0.36, 8), wood, mat(0, deckY + 1.6, L / 2 + L * 0.1, Math.PI / 2 - 0.35, 0, 0));
  // Barrels and crates on deck.
  for (const [x, z] of [[-W * 0.32, mainZ - 3], [-W * 0.32, mainZ - 4.2], [W * 0.3, foreZ - 2.5]]) {
    b.cyl(0.42, 1.0, x, deckY, z, 0x8a5a32, 12);
    b.cyl(0.44, 0.08, x, deckY + 0.2, z, 0x333333, 12);
    b.cyl(0.44, 0.08, x, deckY + 0.8, z, 0x333333, 12);
  }
  b.box(1, 1, 1, W * 0.28, deckY + 0.5, mainZ - 3.5, 0x9a7044, 0.3);
  // Stern lanterns.
  for (const sx of [-1, 1]) b.cyl(0.06, 1, sx * qw * 0.45, deckY + 2.2, -L / 2 + 0.2, 0x222222, 6);
  // Figurehead.
  const fhz = L / 2 + 0.2, fhy = deckY + 0.9;
  if (style === 'player') {
    const cy = fhy + 0.75, cz2 = fhz + 0.35;
    b.addGeo(new THREE.CylinderGeometry(0.35, 0.5, 1.2, 10), hullWood, mat(0, fhy + 0.1, fhz - 0.1, -0.5, 0, 0));
    for (let ring = 0; ring < 2; ring++) {
      const n = ring ? 16 : 14, rr = ring ? 1.12 : 0.92;
      for (let i = 0; i < n; i++) {
        const a = ((i + ring * 0.5) / n) * Math.PI * 2;
        const petal = new THREE.ConeGeometry(0.3, 0.75, 6);
        petal.scale(1, 1, 0.45);
        b.addGeo(petal, ring ? 0xd8701e : 0xf0962a, mat(Math.cos(a) * rr, cy + Math.sin(a) * rr, cz2 - 0.25 - ring * 0.12, 0, 0, a - Math.PI / 2));
      }
    }
    b.sphere(0.9, 0, cy, cz2, 0xf6d13e, 1, 1, 0.72);
    b.sphere(0.36, 0, cy - 0.18, cz2 + 0.55, 0xfbe07a, 1.2, 0.8, 0.7);
    b.sphere(0.12, 0, cy - 0.05, cz2 + 0.8, 0x3a2410, 1.3, 0.9, 1);
    for (const sx of [-1, 1]) {
      b.sphere(0.16, sx * 0.33, cy + 0.26, cz2 + 0.6, 0xffffff, 1, 1.2, 0.6);
      b.sphere(0.09, sx * 0.31, cy + 0.24, cz2 + 0.69, 0x1a1410);
      b.box(0.3, 0.06, 0.08, sx * 0.34, cy + 0.5, cz2 + 0.6, 0x7a4a1a, 0, 0, sx * -0.25);
    }
    b.addGeo(new THREE.TorusGeometry(0.26, 0.05, 6, 12, Math.PI), 0x6a2a1a, mat(0, cy - 0.32, cz2 + 0.62, 0, 0, Math.PI));
  } else if (style === 'navy') {
    b.sphere(0.8, 0, fhy + 0.4, fhz, 0xf4f4f4, 1, 1, 1.3);
    b.addGeo(new THREE.ConeGeometry(0.25, 0.8, 6), 0xf4c040, mat(0, fhy + 0.4, fhz + 1.2, Math.PI / 2, 0, 0));
  } else {
    b.sphere(0.8, 0, fhy + 0.4, fhz, 0xeae4d4);
    b.sphere(0.2, 0.28, fhy + 0.5, fhz + 0.68, 0x111111);
    b.sphere(0.2, -0.28, fhy + 0.5, fhz + 0.68, 0x111111);
  }
  // Wales: raised rub strips following the sheer, port and starboard.
  for (const wy of [deckY - 0.7, 0.9]) {
    for (const side of [-1, 1]) {
      for (let s = 0; s < 30; s++) {
        const z0 = -L / 2 + 0.15 + (s / 30) * (L * 0.93), z1 = -L / 2 + 0.15 + ((s + 1) / 30) * (L * 0.93);
        const u0 = (z0 + L / 2) / L, u1 = (z1 + L / 2) / L;
        const y0 = wy + (hullTop(d, u0) - d.deckY - 0.75), y1 = wy + (hullTop(d, u1) - d.deckY - 0.75);
        const x0 = hullX(d, z0, y0) + 0.05, x1 = hullX(d, z1, y1) + 0.05;
        if (x0 < 0.4 || x1 < 0.4) continue;
        const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
        const m = new THREE.Matrix4().lookAt(new THREE.Vector3(side * x0, y0, z0), new THREE.Vector3(side * x1, y1, z1), new THREE.Vector3(0, 1, 0));
        m.setPosition((side * (x0 + x1)) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
        b.addGeo(UNIT_BOX, wy > 1.5 ? trim : darkWood, m.multiply(new THREE.Matrix4().makeScale(0.12, 0.14, len + 0.04)));
      }
    }
  }
  // Stern: gilded bands, carved name board and window frames.
  const sw = halfWidth(d, -L / 2) * 2;
  b.box(sw * 0.98, 0.14, 0.12, 0, deckY + 1.15, -L / 2 - 0.04, trim);
  b.box(sw * 0.92, 0.12, 0.12, 0, deckY + 0.2, -L / 2 - 0.04, trim);
  b.box(sw * 0.55, 0.34, 0.1, 0, deckY - 0.25, -L / 2 - 0.06, 0x3a2414);
  b.box(sw * 0.5, 0.06, 0.12, 0, deckY - 0.1, -L / 2 - 0.07, trim);
  b.box(sw * 0.5, 0.06, 0.12, 0, deckY - 0.4, -L / 2 - 0.07, trim);
  for (let i = -1; i <= 1; i++) b.box(0.86, 0.66, 0.06, i * 1.2, deckY + 0.6, -L / 2 - 0.01, trim);
  for (const sx of [-1, 1]) b.addGeo(UNIT_BOX, trim, mat(sx * (sw / 2 - 0.1), deckY + 0.6, -L / 2 + 0.05, 0, 0, 0, 0.16, 1.2, 0.16));
  // Main hatch with grating.
  const hz = (mainZ + foreZ) / 2;
  b.box(2.2, 0.35, 1.8, 0, deckY + 0.17, hz, darkWood);
  for (let i = 0; i < 6; i++) b.box(0.08, 0.06, 1.6, -0.9 + i * 0.36, deckY + 0.37, hz, 0x2a1a10);
  for (let i = 0; i < 5; i++) b.box(2.0, 0.06, 0.08, 0, deckY + 0.38, hz - 0.7 + i * 0.35, 0x8a6038);
  // Capstan behind the mainmast.
  const cz = mainZ - 2.1;
  b.taper(0.42, 0.32, 0.9, 0, deckY, cz, darkWood, 12);
  b.cyl(0.5, 0.18, 0, deckY + 0.88, cz, wood, 12);
  for (let i = 0; i < 4; i++) b.box(1.9, 0.07, 0.07, 0, deckY + 0.98, cz, 0xa07850, (i / 4) * Math.PI);
  // Fife rails with belaying pins and coiled rope at the mast feet.
  for (const [mz, r] of [[mainZ, 0.9], [foreZ, 0.75]] as const) {
    for (const sx of [-1, 1]) {
      b.box(0.1, 0.8, 0.1, sx * r, deckY + 0.4, mz + 0.55, wood);
      b.box(0.1, 0.8, 0.1, sx * r, deckY + 0.4, mz - 0.55, wood);
      b.box(0.12, 0.08, 1.3, sx * r, deckY + 0.8, mz, darkWood);
      for (let k = 0; k < 4; k++) b.cyl(0.03, 0.3, sx * r, deckY + 0.72, mz - 0.45 + k * 0.3, 0xd8c8a0, 6);
      b.addGeo(UNIT_TORUS, rope, mat(sx * (r + 0.55), deckY + 0.06, mz + 0.4, Math.PI / 2, 0, 0, 0.32, 0.32, 0.6));
      b.addGeo(UNIT_TORUS, rope, mat(sx * (r + 0.55), deckY + 0.13, mz + 0.4, Math.PI / 2, 0, 0, 0.24, 0.24, 0.6));
    }
  }
  // Wheel pedestal.
  b.box(0.3, 1.0, 0.3, 0, deckY + 1.3 + 0.5, -L / 2 + 2.2, darkWood);
  const staticGeo = b.merge();
  const staticMesh = new THREE.Mesh(staticGeo, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() }));
  staticMesh.castShadow = true;
  staticMesh.receiveShadow = true;
  root.add(staticMesh);

  // Cabin windows (glow at night).
  const windows = new THREE.MeshStandardMaterial({ color: 0x3a2a10, emissive: 0xffc25a, emissiveIntensity: 0.2 });
  for (let i = -1; i <= 1; i++) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.05), windows);
    w.position.set(i * 1.2, deckY + 0.6, -L / 2 - 0.02);
    root.add(w);
    const w2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.05), windows);
    w2.position.set(i * 1.0, deckY + 0.6, qz + 0.06);
    root.add(w2);
  }
  for (const sx of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), windows);
    lamp.position.set(sx * qw * 0.45, deckY + 3.3, -L / 2 + 0.2);
    root.add(lamp);
  }

  // ---- Rigging lines.
  const lp: number[] = [];
  const line = (a: number[], c: number[]) => lp.push(...a, ...c);
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      line([sx * (halfWidth(d, mainZ - 1.5 + i) - 0.1), deckY + 0.7, mainZ - 1.5 + i], [0, deckY + mainH * 0.82, mainZ]);
      line([sx * (halfWidth(d, foreZ - 1.2 + i * 0.8) - 0.1), deckY + 0.7, foreZ - 1.2 + i * 0.8], [0, deckY + foreH * 0.85, foreZ]);
    }
  }
  line([0, deckY + mainH, mainZ], [0, deckY + foreH, foreZ]);
  line([0, deckY + foreH, foreZ], [0, deckY + 1.6 + L * 0.06, L / 2 + L * 0.27]);
  line([0, deckY + mainH * 0.95, mainZ], [0, deckY + 1.3, -L / 2 + 0.5]);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  root.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: rope === 0xc8b48a ? 0x3a2a1a : rope })));

  // ---- Sails.
  const sails: ShipParts['sails'] = [];
  const emblem = jollyRoger(style, look?.hat, look?.hatColor);
  const sailTex = canvasTex(256, 256, (g) => {
    const c = new THREE.Color(sailCol);
    g.fillStyle = `#${c.getHexString()}`;
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    g.lineWidth = 2;
    for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(i * 256 / 6, 0); g.lineTo(i * 256 / 6, 256); g.stroke(); }
    g.strokeStyle = 'rgba(70,50,30,0.35)'; g.lineWidth = 6; g.strokeRect(3, 3, 250, 250);
    g.fillStyle = 'rgba(70,50,30,0.4)';
    for (let i = 0; i < 12; i++) { g.beginPath(); g.arc(14 + i * 20.5, 30, 2.2, 0, 7); g.fill(); g.beginPath(); g.arc(14 + i * 20.5, 52, 2.2, 0, 7); g.fill(); }
    const sh = g.createLinearGradient(0, 0, 0, 256); sh.addColorStop(0, 'rgba(0,0,0,0.08)'); sh.addColorStop(0.3, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.06)');
    g.fillStyle = sh; g.fillRect(0, 0, 256, 256);
    if (style === 'navy') { g.fillStyle = '#2a4a8a'; g.fillRect(0, 100, 256, 56); }
  });
  const mainSailTex = canvasTex(256, 256, (g) => {
    g.drawImage(sailTex.image as HTMLCanvasElement, 0, 0);
    if (style !== 'navy') {
      g.globalAlpha = style === 'player' ? 0.95 : 0.9;
      g.drawImage(emblem.image as HTMLCanvasElement, 28, 60, 200, 125);
    } else {
      g.fillStyle = '#f4f6fa'; g.font = 'bold 44px serif'; g.textAlign = 'center'; g.fillText('MARINE', 128, 144);
    }
  });
  // Sailcloth is translucent: a little emissive keeps backlit sails reading as cloth instead of grey.
  const sailMat = (tex: THREE.Texture) => new THREE.MeshToonMaterial({ map: tex, gradientMap: toonGradient(), side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.22 });
  const mkSail = (z: number, yTop: number, h: number, w: number, tex: THREE.Texture, mastIdx: number) => {
    const g = new THREE.PlaneGeometry(w, h, 8, 6);
    const m = new THREE.Mesh(g, sailMat(tex));
    m.position.set(0, yTop - h / 2, z + 0.25);
    m.castShadow = true;
    root.add(m);
    sails.push({ mesh: m, base: (g.attributes.position.array as Float32Array).slice(), w, h, mast: mastIdx });
  };
  mkSail(mainZ, deckY + mainH * 0.9, mainH * 0.36, W * 1.25, mainSailTex, 0);
  mkSail(mainZ, deckY + mainH * 0.48, mainH * 0.3, W * 1.05, sailTex, 0);
  mkSail(foreZ, deckY + foreH * 0.88, foreH * 0.34, W * 1.05, sailTex, 1);
  mkSail(foreZ, deckY + foreH * 0.48, foreH * 0.28, W * 0.9, sailTex, 1);

  const triSail = (a: THREE.Vector3, bb: THREE.Vector3, c: THREE.Vector3, belly: number, tex: THREE.Texture) => {
    const N = 8, P: number[] = [], U: number[] = [], I: number[] = [];
    const n = new THREE.Vector3().subVectors(bb, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N - i; j++) {
      const u = i / N, v = j / N, w = 1 - u - v;
      const p = a.clone().multiplyScalar(w).addScaledVector(bb, u).addScaledVector(c, v);
      p.addScaledVector(n, belly * 4 * u * v * w * 2.2);
      P.push(p.x, p.y, p.z); U.push(u + v * 0.5, v);
    }
    const row = (i: number) => { let k = 0; for (let r = 0; r < i; r++) k += N - r + 1; return k; };
    for (let i = 0; i < N; i++) for (let j = 0; j < N - i; j++) {
      const k0 = row(i) + j, k1 = row(i + 1) + j;
      I.push(k0, k1, k0 + 1);
      if (j < N - i - 1) I.push(k0 + 1, k1, k1 + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, sailMat(tex));
    m.castShadow = true;
    root.add(m);
  };
  triSail(new THREE.Vector3(0, deckY + foreH * 0.86, foreZ + 0.3), new THREE.Vector3(0, deckY + 1.7, L / 2 + L * 0.06), new THREE.Vector3(0, deckY + 1.4 + L * 0.055, L / 2 + L * 0.24), 0.5, sailTex);
  if (L > 20) {
    const mz = -L / 2 + d.qd * 0.45, mh = L * 0.42;
    const gaffGeo = new THREE.CylinderGeometry(0.07, 0.07, 5.2, 6);
    const spars = new THREE.MeshToonMaterial({ color: 0x8a5a34, gradientMap: toonGradient() });
    const gaff = new THREE.Mesh(gaffGeo, spars);
    gaff.position.set(0, deckY + 1.3 + mh * 0.9 - 0.6, mz - 2.3);
    gaff.rotation.x = Math.PI / 2 - 0.25;
    root.add(gaff);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 6, 6), spars);
    boom.position.set(0, deckY + 2.9, mz - 2.6);
    boom.rotation.x = Math.PI / 2;
    root.add(boom);
    triSail(new THREE.Vector3(0, deckY + 1.3 + mh * 0.9, mz - 0.2), new THREE.Vector3(0, deckY + 3.0, mz - 0.2), new THREE.Vector3(0, deckY + 3.0, mz - 5.4), 0.35, sailTex);
    triSail(new THREE.Vector3(0, deckY + 1.3 + mh * 0.9, mz - 0.2), new THREE.Vector3(0, deckY + 3.0, mz - 5.4), new THREE.Vector3(0, deckY + 1.3 + mh * 0.9 - 1.25, mz - 4.8), 0.25, sailTex);
  }

  // ---- Flag.
  const flagGeo = new THREE.PlaneGeometry(3.2, 2, 10, 6);
  flagGeo.translate(1.6, 0, 0);
  const flag = new THREE.Mesh(flagGeo, new THREE.MeshBasicMaterial({ map: emblem, side: THREE.DoubleSide }));
  flag.position.set(0, deckY + mainH + 0.6, mainZ);
  root.add(flag);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), new THREE.MeshToonMaterial({ color: 0x4a3020, gradientMap: toonGradient() }));
  pole.position.set(0, deckY + mainH + 0.4, mainZ);
  root.add(pole);

  // ---- Wheel.
  const wheel = new THREE.Group();
  const wm = new THREE.MeshToonMaterial({ color: 0x6a4428, gradientMap: toonGradient() });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 6, 20), wm);
  wheel.add(ring);
  for (let i = 0; i < 8; i++) {
    const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 5), wm);
    sp.rotation.z = (i / 8) * Math.PI;
    wheel.add(sp);
  }
  wheel.position.set(0, deckY + 1.3 + 1.15, -L / 2 + 2.45);
  root.add(wheel);

  const cannonsGroup = new THREE.Group();
  root.add(cannonsGroup);
  return { root, sails, flag, flagBase: (flagGeo.attributes.position.array as Float32Array).slice(), wheel, cannonsGroup, cannonPorts: [], windows, hullMat, trim };
}

const cannonGeo = (() => {
  const b = new GeoBatch();
  b.addGeo(new THREE.CylinderGeometry(0.17, 0.24, 1.5, 10), 0x222226, mat(0, 0, 0.3, Math.PI / 2, 0, 0));
  b.addGeo(new THREE.TorusGeometry(0.2, 0.05, 6, 12), 0x333338, mat(0, 0, 1.0));
  b.box(0.6, 0.35, 0.8, 0, -0.32, -0.1, 0x5a3a22);
  b.sphere(0.12, 0, 0, -0.5, 0x222226);
  return b.merge();
})();

export function setCannons(parts: ShipParts, d: ShipDims, perSide: number) {
  parts.cannonsGroup.clear();
  parts.cannonPorts = [];
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() });
  const span = d.L * 0.5;
  const ports = new GeoBatch();
  ports.jitter = 0;
  for (const side of [1, -1] as const) {
    for (let i = 0; i < perSide; i++) {
      const z = -span / 2 + 1 + (perSide === 1 ? span / 2 : (i / (perSide - 1)) * (span - 1.5)) + d.L * 0.05;
      const x = side * (halfWidth(d, z) - 0.55);
      const c = new THREE.Mesh(cannonGeo, m);
      c.position.set(x, d.deckY + 0.55, z);
      c.rotation.y = side * Math.PI / 2;
      c.castShadow = true;
      parts.cannonsGroup.add(c);
      parts.cannonPorts.push({ pos: new THREE.Vector3(side * (halfWidth(d, z) + 0.6), d.deckY + 0.6, z), side });
      const px = side * (hullX(d, z, d.deckY + 0.4) + 0.02);
      ports.box(0.08, 0.58, 0.8, px, d.deckY + 0.4, z, parts.trim);
      ports.box(0.1, 0.44, 0.62, px + side * 0.02, d.deckY + 0.4, z, 0x140c08);
    }
  }
  if (perSide > 0) parts.cannonsGroup.add(new THREE.Mesh(ports.merge(), m));
}

/** Animate sails (billow with sail level) and flag waving. */
export function animateRig(parts: ShipParts, time: number, sailLevel: number, speed: number) {
  const furl = 0.15 + 0.85 * Math.min(1, sailLevel / 3 + 0.15);
  for (const s of parts.sails) {
    const p = s.mesh.geometry.attributes.position as THREE.BufferAttribute;
    const arr = p.array as Float32Array;
    const billow = (0.2 + Math.min(1, sailLevel / 3) * 1.1) * s.w * 0.12;
    for (let i = 0; i < p.count; i++) {
      const bx = s.base[i * 3], by = s.base[i * 3 + 1];
      const u = bx / s.w * 2, v = (by / s.h) + 0.5; // u -1..1, v 0(bottom)..1(top)
      const y = s.h / 2 - (s.h / 2 - by) * furl; // furl toward the top yard
      const bulge = (1 - u * u) * Math.sin(Math.min(1, (1 - v) * furl + 0.1) * Math.PI * 0.9) * billow;
      arr[i * 3] = bx;
      arr[i * 3 + 1] = y;
      arr[i * 3 + 2] = bulge + Math.sin(time * 3 + u * 2 + v * 3) * 0.04 * (1 + speed * 0.02);
    }
    p.needsUpdate = true;
    s.mesh.geometry.computeVertexNormals();
  }
  const fp = parts.flag.geometry.attributes.position as THREE.BufferAttribute;
  const fa = fp.array as Float32Array;
  for (let i = 0; i < fp.count; i++) {
    const x = parts.flagBase[i * 3];
    fa[i * 3 + 2] = Math.sin(time * 7 - x * 2.2) * 0.22 * (x / 3.2);
    fa[i * 3 + 1] = parts.flagBase[i * 3 + 1] + Math.sin(time * 5 - x * 1.7) * 0.06 * (x / 3.2);
  }
  fp.needsUpdate = true;
}
