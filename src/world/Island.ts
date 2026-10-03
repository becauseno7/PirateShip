// Procedural island: heightmap terrain, regional styling, vegetation,
// buildings/landmarks, a pier for docking, a boss arena and spawn points.
import * as THREE from 'three';
import { IslandDef, ISLANDS } from '../game/data';
import { Noise2D } from '../core/noise';
import { clamp, lerp, rng, smoothstep } from '../core/math';
import * as P from './props';
import { GeoBatch, mat } from './props';
import { lavaMaterial, propMaterial, sharedUniforms, terrainMaterial } from './materials';

export interface Collider { x: number; z: number; r: number }
export interface ChestSpot { id: string; pos: THREE.Vector3; rotY: number; tier: number }
export interface SpawnGroup { pos: THREE.Vector3; count: number; kind: 'camp' | 'guard' | 'patrol'; radius: number }
export interface NpcSpot { pos: THREE.Vector3; rotY: number; role: 'villager' | 'shipwright' | 'elder' | 'captive'; name: string; lines: string[]; seed: number }
interface Zone { x: number; z: number; r: number; blend: number; h: number }
interface Seg { ax: number; az: number; bx: number; bz: number }

const terrainMat = terrainMaterial();
const lavaTerrainMat = terrainMaterial(1);
const magmaMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
const staticMat = propMaterial(0);
const swayMat = propMaterial(0.11);
const grassMat = propMaterial(0.9);
const glowMat = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.5 });
glowMat.onBeforeCompile = (sh) => {
  sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= diffuseColor.rgb;');
};

let beaconTex: THREE.CanvasTexture | null = null;
/** Vertical alpha ramp so the berth beacon fades softly into the sky. */
function beaconFade() {
  if (beaconTex) return beaconTex;
  const c = document.createElement('canvas');
  c.width = 4; c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, '#000'); gr.addColorStop(0.55, '#555'); gr.addColorStop(1, '#fff');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 128);
  beaconTex = new THREE.CanvasTexture(c);
  return beaconTex;
}

export class Island {
  def: IslandDef;
  cx: number;
  cz: number;
  R: number;
  half: number;
  N: number;
  cell: number;
  heights: Float32Array;
  group = new THREE.Group();
  decoGroup = new THREE.Group();
  terrain!: THREE.Mesh;
  colliders: Collider[] = [];
  private colGrid = new Map<number, Collider[]>();
  dockDir = 0; // angle from center toward the pier
  pierStart = new THREE.Vector3();
  pierEnd = new THREE.Vector3();
  shipPark = new THREE.Vector3();
  shipParkHeading = 0;
  arena: { pos: THREE.Vector3; radius: number } | null = null;
  chests: ChestSpot[] = [];
  spawns: SpawnGroup[] = [];
  npcs: NpcSpot[] = [];
  lavaSegs: (Seg & { w: number })[] = [];
  private zones: Zone[] = [];
  private pathSegs: Seg[] = [];
  private carves: (Seg & { w: number; depth: number })[] = [];
  private noise: Noise2D;
  private rand: () => number;
  private animated: { obj: THREE.Object3D; kind: 'spin' | 'bob' | 'flicker'; speed: number; base: number }[] = [];
  beacon!: THREE.Mesh;
  buoy!: THREE.Group;
  torchPositions: THREE.Vector3[] = [];
  firePositions: THREE.Vector3[] = [];
  private batch = new GeoBatch();
  private glowBatch = new GeoBatch();
  decoVisible = true;
  /** Height (R) and grass coverage (G) per grid vertex, sampled by the grass shader. */
  grassTex: THREE.DataTexture | null = null;
  grassColors: [THREE.Color, THREE.Color] = [new THREE.Color(), new THREE.Color()];

  constructor(def: IslandDef) {
    this.def = def;
    this.cx = def.pos[0];
    this.cz = def.pos[1];
    this.R = def.radius;
    this.noise = new Noise2D(def.seed);
    this.rand = rng(def.seed * 7919);
    this.half = this.R * 1.32 + 60;
    this.N = this.R >= 380 ? 300 : 200;
    this.cell = (this.half * 2) / this.N;
    this.heights = new Float32Array((this.N + 1) * (this.N + 1));
    this.group.name = def.name;

    this.planLayout();
    this.computeHeights();
    this.buildTerrain();
    this.buildPier();
    this.buildStyle();
    this.scatterVegetation();
    this.buildGrassMap();
    this.placeChests();
    this.finalizeProps();
    this.group.add(this.decoGroup);
  }

  // ------------------------------------------------------------------ shape
  private coastRadius(a: number) {
    const n = this.noise;
    const c = Math.cos(a), s = Math.sin(a);
    return this.R * (1 + 0.15 * n.noise(c * 1.3 + 5, s * 1.3 + 5) + 0.07 * n.noise(c * 3.1 + 9, s * 3.1 - 2) + 0.03 * n.noise(c * 7, s * 7));
  }

  /** Raw height (local coords) before zones and carving. */
  private rawHeight(lx: number, lz: number) {
    const n = this.noise;
    const d = Math.hypot(lx, lz);
    const a = Math.atan2(lz, lx);
    const rc = this.coastRadius(a);
    const s = 1 - d / rc;
    const H = this.def.height;
    if (s < 0) return Math.max(-42, s * this.R * 0.45);
    const beach = smoothstep(0, 0.08, s) * 2.2;
    const inland = smoothstep(0.05, 0.45, s);
    const f = n.fbm(lx / 170, lz / 170, 4);
    const detail = n.fbm(lx / 40 + 20, lz / 40, 3) * 2.5;
    switch (this.def.style) {
      case 'home':
        return beach + inland * (H * 0.35 * (0.6 + 0.6 * f) + H * 0.35 * smoothstep(0.45, 1, s)) + detail * inland;
      case 'tropical': {
        const mx = Math.cos(this.dockDir + 2.2) * this.R * 0.3, mz = Math.sin(this.dockDir + 2.2) * this.R * 0.3;
        const md = Math.hypot(lx - mx, lz - mz) / (this.R * 0.28);
        const mountain = H * Math.exp(-md * md) * (0.8 + 0.4 * n.ridged(lx / 60, lz / 60, 3));
        return beach + inland * (H * 0.22 * (0.5 + 0.7 * f) + mountain) + detail * inland;
      }
      case 'volcano': {
        const cone = Math.pow(clamp(s, 0, 1), 1.35) * H * 1.05;
        const rim = this.R * 0.17;
        let h = cone;
        if (d < rim * 1.25) h = lerp(H * 0.55, cone, smoothstep(rim * 0.82, rim * 1.25, d));
        const ridges = n.ridged(lx / 55, lz / 55, 4) * 14 * inland;
        return beach + inland * h + ridges * (d > rim * 1.2 ? 1 : 0.2) + detail * inland;
      }
      case 'snow': {
        const peaks = n.ridged(lx / 120, lz / 120, 5) * H * 0.85;
        const plateau = H * 0.55 * smoothstep(0.4, 0.85, s);
        return beach + inland * (H * 0.18 * (0.5 + f) + Math.max(peaks * smoothstep(0.15, 0.6, s), plateau)) + detail * inland;
      }
      case 'fortress': {
        const raw = inland * H * (0.45 + 0.4 * f + 0.3 * smoothstep(0.35, 0.9, s));
        const t = raw / 13;
        const terr = (Math.floor(t) + smoothstep(0.65, 1, t - Math.floor(t))) * 13;
        return beach + terr + detail * 0.5 * inland;
      }
      case 'desert': {
        const dunes = (Math.sin(lx * 0.035 + f * 4) * 0.5 + 0.5) * 7 + (Math.sin(lz * 0.05 + lx * 0.02) * 0.5 + 0.5) * 4;
        const mesa = smoothstep(0.62, 0.68, n.noise(lx / 140 + 40, lz / 140 - 7)) * 26;
        return beach + inland * (H * 0.25 * (0.5 + 0.5 * f) + dunes + mesa * smoothstep(0.2, 0.4, s));
      }
      case 'final': {
        const t1 = smoothstep(0.25, 0.32, s) * 14, t2 = smoothstep(0.5, 0.57, s) * 22, t3 = smoothstep(0.74, 0.8, s) * 26;
        return beach + inland * (H * 0.12 * (0.5 + f)) + t1 + t2 + t3 + detail * 0.6 * inland;
      }
    }
  }

  private planLayout() {
    const def = this.def;
    // The pier faces the island we arrive from.
    const prev = def.id === 0 ? { pos: [0, 0] } : ISLANDS[def.id - 1];
    this.dockDir = Math.atan2(prev.pos[1] - this.cz, prev.pos[0] - this.cx);
    if (def.id === 0) this.dockDir = -Math.PI / 2; // home pier points toward the voyage
    const dx = Math.cos(this.dockDir), dz = Math.sin(this.dockDir);
    let rc = this.R * 0.5;
    while (rc < this.R * 1.4 && this.rawHeight(dx * rc, dz * rc) > 0.2) rc += 2;
    const startD = rc - 10, endD = rc + 30;
    this.pierStart.set(this.cx + dx * startD, 1.6, this.cz + dz * startD);
    this.pierEnd.set(this.cx + dx * endD, 1.6, this.cz + dz * endD);
    // Ship berths alongside the pier, bow pointing out to sea.
    const px = -dz, pz = dx;
    this.shipPark.set(this.cx + dx * (endD - 6) + px * 8.5, 0, this.cz + dz * (endD - 6) + pz * 8.5);
    this.shipParkHeading = Math.atan2(dx, dz);
    this.zones.push({ x: dx * (startD - 14), z: dz * (startD - 14), r: 22, blend: 16, h: 1.8 });
    this.carves.push({ ax: dx * (rc - 6), az: dz * (rc - 6), bx: dx * (rc + 120), bz: dz * (rc + 120), w: 26, depth: -9 });

    // Arena location per style.
    const style = def.style;
    if (style !== 'home') {
      let ad = 0;
      if (style === 'tropical') ad = 0.42;
      else if (style === 'desert') ad = 0.38;
      const aa = this.dockDir + Math.PI;
      const ax = Math.cos(aa) * this.R * ad, az = Math.sin(aa) * this.R * ad;
      let ah = this.rawHeight(ax, az);
      if (style === 'volcano') ah = def.height * 0.55;
      if (style === 'fortress') ah = Math.max(ah, 26);
      if (style === 'final') ah = Math.max(ah, 62);
      ah = Math.max(ah, 6);
      const radius = style === 'fortress' ? 46 : 42;
      this.arena = { pos: new THREE.Vector3(this.cx + ax, ah, this.cz + az), radius };
      this.zones.push({ x: ax, z: az, r: radius + 6, blend: 30, h: ah });
    }

    // Main path from the pier to the arena (or island heart).
    const target = this.arena ? new THREE.Vector2(this.arena.pos.x - this.cx, this.arena.pos.z - this.cz) : new THREE.Vector2(0, 0);
    const start = new THREE.Vector2(dx * (startD - 10), dz * (startD - 10));
    const ctrl: THREE.Vector2[] = [start];
    const dir = target.clone().sub(start);
    const len = dir.length();
    const perp = new THREE.Vector2(-dir.y, dir.x).normalize();
    const K = 5;
    for (let i = 1; i < K; i++) {
      const t = i / K;
      const off = (this.rand() - 0.5) * len * 0.35;
      ctrl.push(start.clone().addScaledVector(dir, t).addScaledVector(perp, off));
    }
    if (this.arena) {
      const gd = new THREE.Vector2(Math.cos(dx === 0 && dz === 0 ? 0 : this.dockDir), Math.sin(this.dockDir));
      ctrl.push(target.clone().addScaledVector(gd, this.arena.radius + 45));
      ctrl.push(target.clone().addScaledVector(gd, this.arena.radius - 4));
    } else ctrl.push(target);
    const curve = new THREE.SplineCurve(ctrl);
    const pts = curve.getSpacedPoints(Math.max(20, Math.floor(len / 8)));
    for (let i = 0; i < pts.length - 1; i++) this.pathSegs.push({ ax: pts[i].x, az: pts[i].y, bx: pts[i + 1].x, bz: pts[i + 1].y });

    // Camps along the path plus a few in the wilds.
    if (style !== 'home') {
      const fracs = [0.22, 0.45, 0.68, 0.86];
      fracs.forEach((f, i) => {
        const p = pts[Math.floor(f * (pts.length - 1))];
        const side = i % 2 ? 1 : -1;
        const off = 32 + this.rand() * 26;
        const cpos = p.clone().addScaledVector(perp, side * off);
        this.addCamp(cpos, p);
      });
      for (let i = 0; i < 2; i++) {
        const a = this.rand() * Math.PI * 2, d = this.R * (0.35 + this.rand() * 0.35);
        const cpos = new THREE.Vector2(Math.cos(a) * d, Math.sin(a) * d);
        if (cpos.distanceTo(target) < 90 || cpos.distanceTo(start) < 70) continue;
        this.addCamp(cpos, this.nearestPathPoint(cpos));
      }
    }
    // Lava rivers.
    if (style === 'volcano') {
      for (let r = 0; r < 5; r++) {
        let a = this.dockDir + Math.PI / 3 + (r / 5) * (Math.PI * 4 / 3) + (this.rand() - 0.5) * 0.3;
        let d = this.R * 0.2;
        let px0 = Math.cos(a) * d, pz0 = Math.sin(a) * d;
        while (d < this.R * 1.05) {
          d += 12;
          a += (this.noise.noise(d * 0.01, r * 7) * 0.12);
          const px1 = Math.cos(a) * d, pz1 = Math.sin(a) * d;
          const w = 5 + d / this.R * 4;
          this.carves.push({ ax: px0, az: pz0, bx: px1, bz: pz1, w: w + 2, depth: -1.6 });
          this.lavaSegs.push({ ax: px0 + this.cx, az: pz0 + this.cz, bx: px1 + this.cx, bz: pz1 + this.cz, w });
          px0 = px1; pz0 = pz1;
        }
      }
    }
  }

  private nearestPathPoint(p: THREE.Vector2) {
    let best = new THREE.Vector2(), bd = Infinity;
    for (const s of this.pathSegs) {
      const q = closestOnSeg(p.x, p.y, s.ax, s.az, s.bx, s.bz);
      const d = Math.hypot(q[0] - p.x, q[1] - p.y);
      if (d < bd) { bd = d; best.set(q[0], q[1]); }
    }
    return best;
  }

  private addCamp(c: THREE.Vector2, joinTo: THREE.Vector2) {
    const h = Math.max(3, this.rawHeight(c.x, c.y));
    if (this.rawHeight(c.x, c.y) < 2.5) return;
    this.zones.push({ x: c.x, z: c.y, r: 15, blend: 14, h });
    this.pathSegs.push({ ax: joinTo.x, az: joinTo.y, bx: c.x, bz: c.y });
    this.spawns.push({ pos: new THREE.Vector3(c.x + this.cx, h, c.y + this.cz), count: 3 + Math.floor(this.rand() * 2), kind: 'camp', radius: 9 });
  }

  private zoneAndCarve(lx: number, lz: number, h: number) {
    for (const z of this.zones) {
      const d = Math.hypot(lx - z.x, lz - z.z);
      if (d < z.r + z.blend) {
        const w = 1 - smoothstep(z.r, z.r + z.blend, d);
        h = lerp(h, z.h, w);
      }
    }
    for (const c of this.carves) {
      const q = closestOnSeg(lx, lz, c.ax, c.az, c.bx, c.bz);
      const d = Math.hypot(q[0] - lx, q[1] - lz);
      if (d < c.w) {
        const w = 1 - smoothstep(c.w * 0.4, c.w, d);
        if (c.depth < -5) h = Math.min(h, lerp(h, c.depth, w));
        else h += c.depth * w;
      }
    }
    return h;
  }

  private computeHeights() {
    const N = this.N;
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const lx = -this.half + i * this.cell, lz = -this.half + j * this.cell;
        this.heights[j * (N + 1) + i] = this.zoneAndCarve(lx, lz, this.rawHeight(lx, lz));
      }
    }
  }

  /** World-space terrain height, or -60 outside the island grid. */
  heightAt(x: number, z: number) {
    const fx = (x - this.cx + this.half) / this.cell, fz = (z - this.cz + this.half) / this.cell;
    const N = this.N;
    if (fx < 0 || fz < 0 || fx >= N || fz >= N) return -60;
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const h = this.heights, W = N + 1;
    const a = h[j * W + i], b = h[j * W + i + 1], c = h[(j + 1) * W + i], d = h[(j + 1) * W + i + 1];
    // Match the mesh triangulation (PlaneGeometry splits along the a-d diagonal).
    if (tx + tz <= 1) return a + (b - a) * tx + (c - a) * tz;
    return d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  }

  normalAt(x: number, z: number, out = new THREE.Vector3()) {
    const e = 1.5;
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  distToPath(lx: number, lz: number) {
    let best = Infinity;
    for (const s of this.pathSegs) {
      if (Math.abs(lx - s.ax) > best + 20 && Math.abs(lx - s.bx) > best + 20) continue;
      const q = closestOnSeg(lx, lz, s.ax, s.az, s.bx, s.bz);
      const d = Math.hypot(q[0] - lx, q[1] - lz);
      if (d < best) best = d;
    }
    return best;
  }

  inZone(lx: number, lz: number, pad = 0) {
    for (const z of this.zones) if (Math.hypot(lx - z.x, lz - z.z) < z.r + pad) return true;
    return false;
  }

  // ---------------------------------------------------------------- terrain
  private buildTerrain() {
    const N = this.N;
    const geo = new THREE.PlaneGeometry(this.half * 2, this.half * 2, N, N);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    // PlaneGeometry rows run from -z to +z after rotation? Verify via coords.
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), z = pos.getZ(k);
      const i = Math.round((x + this.half) / this.cell), j = Math.round((z + this.half) / this.cell);
      pos.setY(k, this.heights[j * (N + 1) + i]);
    }
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal as THREE.BufferAttribute;
    const cols = new Float32Array(pos.count * 3);
    const t = this.def.theme;
    const C = (h: number) => new THREE.Color(h);
    const sand = C(t.sand), wet = C(t.sand).multiplyScalar(0.72), grass = C(t.grass), grass2 = C(t.grass2), rockC = C(t.rock), peak = C(t.peak), path = C(t.path);
    const seabed = C(t.sand).lerp(C(0x2a6f7a), 0.35);
    const tmp = new THREE.Color();
    const H = this.def.height;
    const peakLine = this.def.style === 'snow' ? H * 0.42 : this.def.style === 'volcano' ? H * 0.62 : H * 0.75;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
      const ny = nrm.getY(k);
      const n = this.noise.noise(x / 25, z / 25) * 0.5 + 0.5;
      const n2 = this.noise.noise(x / 6 + 100, z / 6) * 0.5 + 0.5;
      if (y < -0.3) tmp.copy(seabed).lerp(wet, smoothstep(-6, -0.3, y));
      else if (y < 1.0) tmp.copy(wet).lerp(sand, smoothstep(-0.3, 1.0, y));
      else {
        tmp.copy(grass).lerp(grass2, smoothstep(0.3, 0.7, n));
        tmp.lerp(sand, 1 - smoothstep(1.0, 2.4, y));
        if (y > peakLine) tmp.lerp(peak, smoothstep(peakLine, peakLine + 12, y));
        const steep = 1 - smoothstep(0.62, 0.86, ny);
        tmp.lerp(rockC, steep);
        const pd = this.distToPath(x, z);
        if (pd < 4.5) tmp.lerp(path, (1 - smoothstep(2.2, 4.5, pd)) * 0.85);
        if (this.arena) {
          const ad = Math.hypot(x - (this.arena.pos.x - this.cx), z - (this.arena.pos.z - this.cz));
          if (ad < this.arena.radius) {
            tmp.lerp(path, 0.6);
            const ring = Math.abs(ad - this.arena.radius * 0.7);
            if (ring < 0.8) tmp.lerp(rockC, 0.5);
          }
        }
        if (this.def.style === 'volcano') {
          let ld = Infinity;
          for (const s of this.lavaSegs) {
            const q = closestOnSeg(x + this.cx, z + this.cz, s.ax, s.az, s.bx, s.bz);
            ld = Math.min(ld, Math.hypot(q[0] - x - this.cx, q[1] - z - this.cz) - s.w);
          }
          if (ld < 6) tmp.lerp(new THREE.Color(0x5a2410), (1 - smoothstep(0, 6, ld)) * 0.8);
        }
      }
      tmp.multiplyScalar(0.92 + n2 * 0.16);
      cols[k * 3] = tmp.r; cols[k * 3 + 1] = tmp.g; cols[k * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.deleteAttribute('uv');
    this.terrain = new THREE.Mesh(geo, this.def.style === 'volcano' ? lavaTerrainMat : terrainMat);
    this.terrain.position.set(this.cx, 0, this.cz);
    this.terrain.receiveShadow = true;
    this.group.add(this.terrain);

    if (this.lavaSegs.length) this.buildLava();
  }

  private buildLava() {
    // One ribbon per river: segments are contiguous until the radius resets.
    const ribbons: (Seg & { w: number })[][] = [];
    let cur: (Seg & { w: number })[] = [];
    for (const s of this.lavaSegs) {
      if (cur.length && (Math.abs(cur[cur.length - 1].bx - s.ax) > 0.01 || Math.abs(cur[cur.length - 1].bz - s.az) > 0.01)) { ribbons.push(cur); cur = []; }
      cur.push(s);
    }
    if (cur.length) ribbons.push(cur);
    const mat = lavaMaterial();
    for (const rb of ribbons) {
      const pos: number[] = [], uv: number[] = [], idx: number[] = [];
      let v = 0;
      rb.forEach((s, i) => {
        const dx = s.bx - s.ax, dz = s.bz - s.az;
        const l = Math.hypot(dx, dz);
        const px = -dz / l, pz = dx / l;
        const pts = i === rb.length - 1 ? [[s.ax, s.az], [s.bx, s.bz]] : [[s.ax, s.az]];
        for (const [x, z] of pts) {
          for (const side of [-1, 1]) {
            const wx = x + px * s.w * side, wz = z + pz * s.w * side;
            const h = Math.max(this.heightAt(x, z), 0.1) + 0.35;
            pos.push(wx - this.cx, h, wz - this.cz);
            uv.push(side < 0 ? 0 : 1, v);
          }
          v += l / 6;
        }
      });
      const n = pos.length / 6;
      for (let i = 0; i < n - 1; i++) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      const m = new THREE.Mesh(g, mat);
      m.position.set(this.cx, 0, this.cz);
      m.renderOrder = 1;
      this.decoGroup.add(m);
    }
    const light = new THREE.PointLight(0xff6a20, 60, 260, 1.5);
    light.position.set(this.cx, this.def.height * 0.75, this.cz);
    this.decoGroup.add(light);
  }

  // ------------------------------------------------------------------- props
  private h(x: number, z: number) { return this.heightAt(x, z); }

  addCollider(x: number, z: number, r: number) {
    const c = { x, z, r };
    this.colliders.push(c);
    const minI = Math.floor((x - r) / 16), maxI = Math.floor((x + r) / 16);
    const minJ = Math.floor((z - r) / 16), maxJ = Math.floor((z + r) / 16);
    for (let i = minI; i <= maxI; i++) for (let j = minJ; j <= maxJ; j++) {
      const key = i * 73856093 ^ j * 19349663;
      let arr = this.colGrid.get(key);
      if (!arr) { arr = []; this.colGrid.set(key, arr); }
      arr.push(c);
    }
  }
  collidersNear(x: number, z: number): Collider[] {
    return this.colGrid.get(Math.floor(x / 16) * 73856093 ^ Math.floor(z / 16) * 19349663) || [];
  }
  private blocked(x: number, z: number, r: number) {
    for (const c of this.collidersNear(x, z)) if (Math.hypot(c.x - x, c.z - z) < c.r + r) return true;
    return false;
  }

  /** Place a building batch at a world position, flattening nothing (sits on terrain). */
  private place(x: number, z: number, ry: number, build: (b: GeoBatch) => void, colR = 0, sink = 0.3, glow = false) {
    const y = this.minHeightAround(x, z, Math.max(2, colR * 0.7)) - sink;
    const b = glow ? this.glowBatch : this.batch;
    b.push(mat(x - this.cx, y, z - this.cz, 0, ry, 0));
    build(b);
    b.pop();
    if (colR > 0) this.addCollider(x, z, colR);
    return y;
  }
  private minHeightAround(x: number, z: number, r: number) {
    let m = this.h(x, z);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      m = Math.min(m, this.h(x + Math.cos(a) * r, z + Math.sin(a) * r));
    }
    return m;
  }
  private local(lx: number, lz: number) { return [lx + this.cx, lz + this.cz] as const; }

  private buildPier() {
    const len = this.pierStart.distanceTo(this.pierEnd) + 8;
    const ry = Math.atan2(this.pierEnd.x - this.pierStart.x, this.pierEnd.z - this.pierStart.z);
    const b = this.batch;
    b.push(mat(this.pierStart.x - this.cx - Math.sin(ry) * 8, 1.6, this.pierStart.z - this.cz - Math.cos(ry) * 8, 0, ry, 0));
    P.pier(b, len, 5.5);
    P.barrel(b, 2, 0.1, 6);
    P.crate(b, -1.8, 0.1, 9, 0.8, 0.4);
    b.pop();
    // Lantern posts glow.
    const gb = this.glowBatch;
    for (const t of [0.3, 0.7, 1]) {
      const x = lerp(this.pierStart.x, this.pierEnd.x, t), z = lerp(this.pierStart.z, this.pierEnd.z, t);
      gb.sphere(0.3, x - this.cx + Math.cos(ry) * 2.7, 3.1, z - this.cz - Math.sin(ry) * 2.7, 0xffc25a);
      this.batch.cyl(0.08, 1.6, x - this.cx + Math.cos(ry) * 2.7, 1.5, z - this.cz - Math.sin(ry) * 2.7, 0x333333, 6);
    }
    // Buoy + beacon marking the berth.
    this.buoy = new THREE.Group();
    const buoyMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.3, 2.2, 10), new THREE.MeshStandardMaterial({ color: 0xd83a2a, roughness: 0.6 }));
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: 0xffc040, emissiveIntensity: 2 }));
    top.position.y = 1.6;
    this.buoy.add(buoyMesh, top);
    const dirx = Math.sin(ry), dirz = Math.cos(ry);
    this.buoy.position.set(this.shipPark.x + dirx * 18, 0, this.shipPark.z + dirz * 18);
    this.group.add(this.buoy);
    const bm = new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, alphaMap: beaconFade() });
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.6, 160, 16, 1, true), bm);
    this.beacon.position.set(this.shipPark.x, 80, this.shipPark.z);
    this.beacon.visible = false;
    this.group.add(this.beacon);
    // Shipwright on every pier.
    const sx = this.pierStart.x - Math.cos(ry) * 4.5 - dirx * 8, sz = this.pierStart.z + Math.sin(ry) * 4.5 - dirz * 8;
    this.npcs.push({
      pos: new THREE.Vector3(sx, this.h(sx, sz), sz), rotY: ry + Math.PI / 2, role: 'shipwright', name: 'Shipwright Bonnie', seed: 3,
      lines: ['Need repairs or upgrades? Wood and iron, captain, that\'s all I ask. And Berries. Lots of Berries.'],
    });
    // Little shack + crates by the shipwright.
    this.place(sx - Math.cos(ry) * 5, sz + Math.sin(ry) * 5, ry, (bb) => { bb.box(4, 3, 4, 0, 1.5, 0, 0x8a6a48); bb.cone(3.4, 1.6, 0, 3, 0, 0x5a7a9a, 4, 0, Math.PI / 4); P.crate(bb, 2.6, 0, 1, 0.9); P.barrel(bb, 2.6, 0, -1.2); }, 3.2);
  }

  private buildStyle() {
    const style = this.def.style;
    const R = this.R;
    const dd = this.dockDir;
    const r = this.rand;
    const pr = (minD: number, maxD: number, avoidArena = 50) => {
      for (let k = 0; k < 40; k++) {
        const a = r() * Math.PI * 2, d = R * (minD + r() * (maxD - minD));
        const lx = Math.cos(a) * d, lz = Math.sin(a) * d;
        if (this.h(lx + this.cx, lz + this.cz) < 2.5) continue;
        if (this.distToPath(lx, lz) < 8) continue;
        if (this.inZone(lx, lz, 4)) continue;
        if (this.arena && Math.hypot(lx + this.cx - this.arena.pos.x, lz + this.cz - this.arena.pos.z) < this.arena.radius + avoidArena) continue;
        if (this.blocked(lx + this.cx, lz + this.cz, 6)) continue;
        return [lx + this.cx, lz + this.cz, a] as const;
      }
      return null;
    };
    // Camps: tents, fires, crates.
    const factionColor: Record<string, number> = { tropical: 0xb8322a, volcano: 0x3a3a3a, snow: 0x5a6a8a, fortress: 0x6a2a2a, desert: 0xc89a4a, final: 0x1a2a5a, home: 0xffffff };
    for (const s of this.spawns) {
      if (s.kind !== 'camp') continue;
      const n = 2 + Math.floor(r() * 2);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r();
        const x = s.pos.x + Math.cos(a) * 8, z = s.pos.z + Math.sin(a) * 8;
        if (style === 'snow' && i === 0) this.place(x, z, -a + Math.PI / 2, (b) => P.igloo(b), 3);
        else this.place(x, z, -a - Math.PI / 2, (b) => P.tent(b, factionColor[style]), 2.4);
      }
      this.place(s.pos.x, s.pos.z, 0, (b) => P.campfireBase(b), 0, 0.1);
      this.firePositions.push(new THREE.Vector3(s.pos.x, s.pos.y + 0.4, s.pos.z));
      this.place(s.pos.x + 4, s.pos.z - 3, r() * 3, (b) => { P.crate(b, 0, 0, 0); P.crate(b, 1.3, 0, 0.2, 0.8, 0.3); P.barrel(b, 0.4, 0, 1.4); }, 1.6);
      if (r() < 0.6) {
        const a = r() * Math.PI * 2;
        this.place(s.pos.x + Math.cos(a) * 13, s.pos.z + Math.sin(a) * 13, a, (b) => P.watchtower(b), 2.6);
      }
    }

    // Arena dressing: ring of pillars with torches.
    if (this.arena) {
      const A = this.arena;
      const stone = style === 'final' ? 0xf4efe4 : style === 'snow' ? 0xbfe8f8 : style === 'volcano' ? 0x2a2420 : style === 'desert' ? 0xd8b87a : style === 'fortress' ? 0x4a4a52 : 0x8a8a7a;
      const n = 12;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const toDock = Math.abs(Math.atan2(Math.sin(a - dd), Math.cos(a - dd)));
        if (toDock < 0.35) continue; // entrance gap facing the path
        const x = A.pos.x + Math.cos(a) * (A.radius + 3), z = A.pos.z + Math.sin(a) * (A.radius + 3);
        const broken = style === 'tropical' && i % 3 === 0;
        if (style === 'snow') this.place(x, z, a, (b) => b.addGeo(P.crystal(0xbfeaff), 0xbfeaff, mat(0, 0, 0, 0, 0, 0, 2.2, 3.2, 2.2)), 2.2);
        else this.place(x, z, a, (b) => P.pillar(b, 8, stone, broken), 1.6);
        if (!broken && i % 2 === 0) {
          const ty = this.h(x, z) + (style === 'snow' ? 9 : 9.2);
          this.torchPositions.push(new THREE.Vector3(x, ty, z));
        }
      }
    }

    switch (style) {
      case 'home': this.buildHome(); break;
      case 'tropical': this.buildTropical(pr); break;
      case 'volcano': this.buildVolcano(pr); break;
      case 'snow': this.buildSnow(pr); break;
      case 'fortress': this.buildFortress(pr); break;
      case 'desert': this.buildDesert(pr); break;
      case 'final': this.buildFinal(pr); break;
    }
  }

  private villagerLines = [
    ['They say the Grand Meridian current loops the whole world, and only a Log Pose can follow it.', 'My grandpa saw a Sea King swallow a navy ship whole. Whole!'],
    ['Devil Fruits taste awful, everyone knows that. Like old socks and seawater.', 'The sea will drag down any fruit-eater. Never fall overboard, kid.'],
    ['Seven islands to Solhaven. Seven bosses. Nobody\'s made it past the Calamity.', 'Bring back some treasure for the village, would ya?'],
    ['When I was young, Aurelio\'s flag flew over every harbor. A sun with a crown of fire.', 'Bounties go up when you beat big names. Wear yours with pride.'],
    ['Wood and iron keep a ship alive. Loot every wreck you sink!', 'If a fight goes bad, run back to your ship and repair with R.'],
  ];

  private buildHome() {
    const dd = this.dockDir;
    const dx = Math.cos(dd), dz = Math.sin(dd);
    const base = this.pierStart.clone().addScaledVector(new THREE.Vector3(dx, 0, dz), -26);
    // Village houses in a crescent behind the pier.
    const wallCols = [0xf6efe0, 0xf4dcc0, 0xdfeaf1, 0xf6eab8, 0xf8e4e0];
    const roofCols = [0xc4502e, 0x3d6fb6, 0x3f8f58, 0xd98a2b, 0x8a4a7a];
    for (let i = 0; i < 9; i++) {
      const a = dd + Math.PI + (i - 4) * 0.32;
      const d = 30 + (i % 2) * 18;
      const x = base.x + Math.cos(a) * d, z = base.z + Math.sin(a) * d;
      if (this.distToPath(x - this.cx, z - this.cz) < 6) continue;
      this.place(x, z, -a + Math.PI / 2 + Math.PI, (b) => P.house(b, wallCols[i % 5], roofCols[(i * 3) % 5], i), 4.6);
    }
    // Windmills on the hills.
    for (let i = 0; i < 3; i++) {
      const a = dd + Math.PI + (i - 1) * 0.9;
      const d = this.R * 0.45;
      const x = this.cx + Math.cos(a) * d, z = this.cz + Math.sin(a) * d;
      const y = this.place(x, z, -a, (b) => P.windmillBase(b), 3);
      const blades = new THREE.Mesh(P.windmillBlades(), staticMat);
      const pivot = new THREE.Group();
      pivot.position.set(x, y + 7.8, z);
      pivot.rotation.y = -a;
      blades.position.set(0, 0, 2.4);
      pivot.add(blades);
      blades.castShadow = true;
      this.decoGroup.add(pivot);
      this.animated.push({ obj: blades, kind: 'spin', speed: 0.6 + i * 0.1, base: 0 });
    }
    // Lighthouse on the coast.
    const la = dd + 1.1;
    const lr = this.coastRadius(la) * 0.9;
    const lx = this.cx + Math.cos(la) * lr, lz = this.cz + Math.sin(la) * lr;
    const ly = this.place(lx, lz, 0, (b) => P.lighthouse(b), 3.2);
    const lamp = new THREE.PointLight(0xffe2a0, 40, 120, 1.5);
    lamp.position.set(lx, ly + 19.5, lz);
    this.decoGroup.add(lamp);
    // Villagers.
    const names = ['Old Marlo', 'Fishwife Gretta', 'Little Pip', 'Mayor Hobb', 'Net-mender Suli'];
    for (let i = 0; i < 5; i++) {
      const a = dd + Math.PI + (i - 2) * 0.45;
      const d = 20 + (i % 2) * 10;
      const x = base.x + Math.cos(a) * d, z = base.z + Math.sin(a) * d;
      this.npcs.push({ pos: new THREE.Vector3(x, this.h(x, z), z), rotY: dd, role: i === 3 ? 'elder' : 'villager', name: names[i], lines: this.villagerLines[i], seed: 10 + i });
    }
    // Street life: lamps along the path, a well, market stalls by the pier, rowboats on the beach.
    const along = new THREE.Vector3(Math.cos(dd), 0, Math.sin(dd));
    const side = new THREE.Vector3(-along.z, 0, along.x);
    for (let i = 0; i < 6; i++) {
      const p = base.clone().addScaledVector(along, -8 - i * 11).addScaledVector(side, (i % 2 ? 1 : -1) * 4.2);
      this.place(p.x, p.z, Math.atan2(side.x, side.z) * (i % 2 ? 1 : -1), (b) => P.lampPost(b), 0.5, 0.1);
    }
    const wp = base.clone().addScaledVector(along, -30).addScaledVector(side, 10);
    this.place(wp.x, wp.z, 0.4, (b) => P.well(b), 1.6, 0.1);
    const stripes = [0xc8282b, 0x2f5fa8, 0x3f8a4a, 0xe8a030];
    for (let i = 0; i < 4; i++) {
      const p = base.clone().addScaledVector(along, -2 - (i % 2) * 5).addScaledVector(side, (i < 2 ? -1 : 1) * (9 + (i % 2) * 2));
      const ry = Math.atan2(side.x, side.z) + (i < 2 ? 0 : Math.PI);
      this.place(p.x, p.z, ry, (b) => { P.marketStall(b, stripes[i], i); P.crate(b, 2.2, 0, -0.4, 0.7, 0.3); P.barrel(b, -2.2, 0, -0.3, 0.8); }, 2, 0.1);
    }
    for (let i = 0; i < 3; i++) {
      const a = dd + 0.25 + i * 0.07;
      const r = this.coastRadius(a) * 0.985;
      const x = this.cx + Math.cos(a) * r, z = this.cz + Math.sin(a) * r;
      this.place(x, z, -a + i * 0.4, (b) => P.rowboat(b, stripes[i]), 0, 0.2);
    }
    // Fences and flower beds.
    for (let i = 0; i < 30; i++) {
      const a = dd + Math.PI + (i / 30 - 0.5) * 2.4;
      const x = base.x + Math.cos(a) * 62, z = base.z + Math.sin(a) * 62;
      if (this.distToPath(x - this.cx, z - this.cz) < 5) continue;
      this.place(x, z, -a, (b) => { b.box(0.15, 1.1, 0.15, 0, 0.55, 0, 0xf0e8d8); b.box(2.2, 0.12, 0.08, 0, 0.8, 0, 0xf0e8d8); b.box(2.2, 0.12, 0.08, 0, 0.4, 0, 0xf0e8d8); }, 0, 0.1);
    }
  }

  private captive(lines: string[], name: string, at: readonly [number, number, number] | null) {
    if (!at) return;
    this.npcs.push({ pos: new THREE.Vector3(at[0], this.h(at[0], at[1]), at[1]), rotY: at[2], role: 'captive', name, lines, seed: 20 + this.npcs.length });
  }

  private buildTropical(pr: (a: number, b: number, c?: number) => readonly [number, number, number] | null) {
    const stone = 0x9a9682;
    // Overgrown ruins.
    for (let i = 0; i < 14; i++) {
      const p = pr(0.2, 0.85);
      if (!p) continue;
      const kind = i % 3;
      this.place(p[0], p[1], p[2], (b) => {
        if (kind === 0) { P.pillar(b, 7, stone, true); P.pillar(b.pushT(4, 0, 1), 7, stone, false); b.pop(); }
        else if (kind === 1) P.arch(b, 5, 6, stone);
        else { b.box(3, 1.5, 2, 0, 0.7, 0, stone, 0.3); b.box(2, 1.2, 1.6, 2.2, 0.5, 1, stone, 1.1); b.ico(1.2, -2, 0.5, 1, stone, 0); }
      }, 3);
    }
    // Native village of huts (the people Barnacle oppresses).
    const vp = pr(0.3, 0.55, 90);
    if (vp) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        this.place(vp[0] + Math.cos(a) * 14, vp[1] + Math.sin(a) * 14, -a - Math.PI / 2, (b) => P.hut(b), 3.4);
      }
      this.captive(['Barnacle\'s men burned our fishing boats... please, drive them off our island!', 'The old temple behind the reef is where he hoards everything he steals.'], 'Chief Lulani', [vp[0] + 3, vp[1] + 2, 0]);
      this.captive(['You came on that little ship? Brave. Or foolish. Probably both!'], 'Kai the Diver', [vp[0] - 3, vp[1] - 2, 1]);
    }
    // Temple behind the arena.
    if (this.arena) {
      const A = this.arena, back = this.dockDir + Math.PI;
      const tx = A.pos.x + Math.cos(back) * (A.radius + 26), tz = A.pos.z + Math.sin(back) * (A.radius + 26);
      this.place(tx, tz, -back + Math.PI / 2, (b) => P.steppedTemple(b, 34, 4, 0xa8a48e), 17, 1);
    }
  }

  private buildVolcano(pr: (a: number, b: number, c?: number) => readonly [number, number, number] | null) {
    // Watch towers ringing the crater rim.
    const rim = this.R * 0.2;
    for (let i = 0; i < 7; i++) {
      const a = this.dockDir + (i / 7) * Math.PI * 2 + 0.45;
      const x = this.cx + Math.cos(a) * rim, z = this.cz + Math.sin(a) * rim;
      this.place(x, z, a, (b) => P.tower(b, 3, 10, 0x2e2826, 0x5a1a12), 3.6);
    }
    // Forges with glowing furnaces.
    for (let i = 0; i < 6; i++) {
      const p = pr(0.3, 0.8);
      if (!p) continue;
      this.place(p[0], p[1], p[2], (b) => { b.box(6, 4, 5, 0, 2, 0, 0x3a3230); b.box(1.6, 6, 1.6, 2, 5, -1.5, 0x2a2420); }, 4);
      this.place(p[0], p[1], p[2], (b) => b.box(2.4, 1.4, 0.3, 0, 1.2, 2.55, 0xff7a20), 0, 0.3, true);
    }
    for (let i = 0; i < 18; i++) {
      const p = pr(0.25, 0.95, 20);
      if (!p) continue;
      this.place(p[0], p[1], p[2], (b) => { b.addGeo(P.crystal(0x2a1a34), 0x2a1a34, mat(0, 0, 0, 0, 0, 0, 1.5, 2.2, 1.5)); }, 1.6);
    }
    this.captive(['Kazan says the volcano is his. It\'s not. It was ours. We forged blades for kings here.', 'If you climb to the crater, watch the ground. When it glows... run.'], 'Smith Oruma', pr(0.35, 0.7));
  }

  private buildSnow(pr: (a: number, b: number, c?: number) => readonly [number, number, number] | null) {
    const vp = pr(0.25, 0.5, 90);
    if (vp) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const x = vp[0] + Math.cos(a) * 16, z = vp[1] + Math.sin(a) * 16;
        if (i % 2) this.place(x, z, -a + Math.PI / 2, (b) => P.logCabin(b), 4);
        else this.place(x, z, -a + Math.PI / 2, (b) => P.igloo(b), 3.2);
      }
      this.firePositions.push(new THREE.Vector3(vp[0], this.h(vp[0], vp[1]) + 0.4, vp[1]));
      this.place(vp[0], vp[1], 0, (b) => P.campfireBase(b), 0, 0.1);
      this.captive(['Borr was our protector, once. Then the cold got into his heart.', 'The giants lived here before the ice. Their bones are the mountains now.'], 'Elder Sigrun', [vp[0] + 4, vp[1], 0]);
    }
    for (let i = 0; i < 24; i++) {
      const p = pr(0.15, 0.95, 20);
      if (!p) continue;
      this.place(p[0], p[1], p[2], (b) => b.addGeo(P.crystal(0x9fe6ff), 0x9fe6ff, mat(0, 0, 0, 0, 0, 0, 1.2 + (i % 3) * 0.6, 1.5 + (i % 4) * 0.6, 1.2 + (i % 3) * 0.6)), 1.5);
    }
    // Throne of ice behind the arena.
    if (this.arena) {
      const A = this.arena, back = this.dockDir + Math.PI;
      const tx = A.pos.x + Math.cos(back) * (A.radius - 6), tz = A.pos.z + Math.sin(back) * (A.radius - 6);
      this.place(tx, tz, -back + Math.PI / 2 - Math.PI / 2, (b) => { b.box(10, 2, 8, 0, 1, 0, 0xcfefff); b.box(8, 12, 2, 0, 8, -3, 0xbfe8ff); b.box(2, 5, 6, -4, 4.5, 0, 0xbfe8ff); b.box(2, 5, 6, 4, 4.5, 0, 0xbfe8ff); }, 6);
    }
  }

  private buildFortress(pr: (a: number, b: number, c?: number) => readonly [number, number, number] | null) {
    if (!this.arena) return;
    const A = this.arena;
    const wallR = A.radius + 30;
    const segs = 20;
    const stone = 0x45454e;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const toDock = Math.abs(Math.atan2(Math.sin(am - this.dockDir), Math.cos(am - this.dockDir)));
      const x0 = A.pos.x + Math.cos(a0) * wallR, z0 = A.pos.z + Math.sin(a0) * wallR;
      const x1 = A.pos.x + Math.cos(a1) * wallR, z1 = A.pos.z + Math.sin(a1) * wallR;
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (toDock > 0.22) {
        this.place(mx, mz, -am + Math.PI / 2, (b) => P.wallSegment(b, len + 1, 12, stone, 3), 0, 1.5);
        for (let k = -2; k <= 2; k++) this.addCollider(mx + (x1 - x0) * k / 5, mz + (z1 - z0) * k / 5, 2.4);
      }
      if (i % 2 === 0) this.place(x0, z0, 0, (b) => P.tower(b, 4, 18, stone, 0x6a1a1a), 4.6, 1.5);
    }
    // Gate towers.
    for (const s of [-1, 1]) {
      const a = this.dockDir + s * 0.24;
      this.place(A.pos.x + Math.cos(a) * wallR, A.pos.z + Math.sin(a) * wallR, 0, (b) => P.tower(b, 5, 24, stone, 0x6a1a1a), 5.6, 1.5);
    }
    // Great keep behind the arena.
    const back = this.dockDir + Math.PI;
    this.place(A.pos.x + Math.cos(back) * (A.radius + 14), A.pos.z + Math.sin(back) * (A.radius + 14), 0, (b) => { P.tower(b, 9, 40, 0x3a3a42, 0x7a1a1a); }, 10, 1.5);
    // Lightning rods across the rock.
    for (let i = 0; i < 12; i++) {
      const p = pr(0.2, 0.9, 30);
      if (!p) continue;
      this.place(p[0], p[1], p[2], (b) => { b.cyl(0.25, 16, 0, 0, 0, 0x6a6a72, 6); b.sphere(0.6, 0, 16.4, 0, 0x9ab0c8); b.box(2, 1, 2, 0, 0.5, 0, 0x3a3a42); }, 1.2);
    }
    for (let i = 0; i < 8; i++) {
      const p = pr(0.3, 0.85, 40);
      if (!p) continue;
      this.place(p[0], p[1], p[2], (b) => P.watchtower(b, 0x4a3a2a), 2.6);
    }
    this.captive(['Gorrath has crushed every crew that came for him. Every. Single. One.', 'They say he can\'t be hurt... unless something in you wakes up. Something old.'], 'Prisoner Vey', pr(0.3, 0.6, 60));
  }

  private buildDesert(pr: (a: number, b: number, c?: number) => readonly [number, number, number] | null) {
    // Great pyramids.
    for (let i = 0; i < 3; i++) {
      const p = pr(0.35, 0.8, 70);
      if (!p) continue;
      const s = 50 + i * 12;
      this.place(p[0], p[1], 0.3 * i, (b) => P.pyramid(b, s, 0xd8b06a), s * 0.42, 2);
    }
    for (let i = 0; i < 8; i++) {
      const p = pr(0.2, 0.9, 30);
      if (!p) continue;
      this.place(p[0], p[1], 0, (b) => P.obelisk(b, 10 + (i % 3) * 3, 0xd0a868), 1.6);
    }
    // Town near the pier.
    const dd = this.dockDir;
    const base = this.pierStart.clone().add(new THREE.Vector3(Math.cos(dd), 0, Math.sin(dd)).multiplyScalar(-40));
    for (let i = 0; i < 10; i++) {
      const a = dd + Math.PI + (i - 5) * 0.3;
      const d = 18 + (i % 3) * 12;
      const x = base.x + Math.cos(a) * d, z = base.z + Math.sin(a) * d;
      if (this.distToPath(x - this.cx, z - this.cz) < 7) continue;
      if (i % 3 === 0) this.place(x, z, -a + Math.PI / 2, (b) => P.domeHouse(b, 3.4, 0xe8d0a0, 0xf4f0e8), 3.8);
      else this.place(x, z, -a + Math.PI / 2, (b) => P.sandHouse(b, 5 + (i % 2) * 2, 4 + (i % 3), 5, 0xe0c08a), 3.8);
    }
    // Palace behind the arena.
    if (this.arena) {
      const A = this.arena, back = dd + Math.PI;
      const px = A.pos.x + Math.cos(back) * (A.radius + 22), pz = A.pos.z + Math.sin(back) * (A.radius + 22);
      this.place(px, pz, -back + Math.PI / 2, (b) => {
        b.box(36, 10, 18, 0, 5, 0, 0xead6a8);
        P.domeHouse(b.pushT(0, 10, 0), 7, 0xead6a8, 0xf8f4ec); b.pop();
        for (const sx of [-15, 15]) { b.cyl(2.2, 22, sx, 0, 6, 0xead6a8, 12); b.shape('hemi', 0xf8f4ec, sx, 22, 6, 2.6, 3, 2.6); }
      }, 18, 1);
    }
    // Oasis.
    const op = pr(0.3, 0.6, 70);
    if (op) {
      const water = new THREE.Mesh(new THREE.CircleGeometry(14, 24), new THREE.MeshStandardMaterial({ color: 0x2fd0c8, roughness: 0.15, metalness: 0.1 }));
      water.rotation.x = -Math.PI / 2;
      water.position.set(op[0], this.h(op[0], op[1]) + 0.25, op[1]);
      this.decoGroup.add(water);
      const pg = P.palmTree();
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const x = op[0] + Math.cos(a) * 17, z = op[1] + Math.sin(a) * 17;
        const m = new THREE.Mesh(pg, swayMat);
        m.position.set(x, this.h(x, z) - 0.2, z);
        m.rotation.y = a;
        m.castShadow = true;
        this.decoGroup.add(m);
        this.addCollider(x, z, 0.7);
      }
      this.captive(['The Sultana sees through the sand. She\'s watching you right now.', 'If the dunes start to swirl, don\'t let them pull you in!'], 'Water-seller Amun', [op[0] + 15, op[1] + 4, 0]);
    }
  }

  private buildFinal(pr: (a: number, b: number, c?: number) => readonly [number, number, number] | null) {
    const marble = 0xf4efe4;
    if (this.arena) {
      const A = this.arena, back = this.dockDir + Math.PI;
      const sx = A.pos.x + Math.cos(back) * (A.radius + 34), sz = A.pos.z + Math.sin(back) * (A.radius + 34);
      this.place(sx, sz, -back - Math.PI / 2, (b) => P.sunStatue(b, 2.2, 0xe8e2d4), 13, 1);
    }
    for (let i = 0; i < 5; i++) {
      const p = pr(0.25, 0.8, 60);
      if (!p) continue;
      this.place(p[0], p[1], p[2], (b) => P.marbleTemple(b, 7, 10, marble, 0xffd54a), 9);
    }
    // Golden gates along the path.
    for (let i = 1; i < 4; i++) {
      const s = this.pathSegs[Math.floor((i / 4) * (this.pathSegs.length - 1))];
      if (!s) continue;
      const ry = Math.atan2(s.bx - s.ax, s.bz - s.az);
      const x = s.ax + this.cx, z = s.az + this.cz;
      this.place(x, z, ry + Math.PI / 2 - Math.PI / 2, (b) => P.arch(b, 9, 9, 0xffd54a), 0);
      this.addCollider(x + Math.cos(ry) * 5.3, z - Math.sin(ry) * 5.3, 1.2);
      this.addCollider(x - Math.cos(ry) * 5.3, z + Math.sin(ry) * 5.3, 1.2);
    }
    // Floating rocks drifting above the island.
    const rockGeo = P.rock(0xe8e2d4, 3);
    for (let i = 0; i < 14; i++) {
      const a = this.rand() * Math.PI * 2, d = this.R * (0.2 + this.rand() * 0.7);
      const x = this.cx + Math.cos(a) * d, z = this.cz + Math.sin(a) * d;
      const m = new THREE.Mesh(rockGeo, staticMat);
      const s = 3 + this.rand() * 6;
      m.scale.set(s, s * 0.7, s);
      m.rotation.set(Math.PI, this.rand() * 6, 0);
      m.position.set(x, Math.max(0, this.h(x, z)) + 40 + this.rand() * 50, z);
      m.castShadow = true;
      this.decoGroup.add(m);
      this.animated.push({ obj: m, kind: 'bob', speed: 0.3 + this.rand() * 0.4, base: m.position.y });
    }
    this.captive(['You... you actually made it? No one has stood here in two hundred years.', 'Vexis drinks the light of the Daybreak to live forever. Free it, and the dawn returns to the whole world.'], 'Last Keeper Iolo', pr(0.3, 0.6, 60));
  }

  // -------------------------------------------------------------- vegetation
  private scatterVegetation() {
    const style = this.def.style;
    const areaK = Math.pow(this.R / 400, 2);
    type Spec = { geo: THREE.BufferGeometry; count: number; mat: THREE.Material; col: number; minH: number; maxS?: number; minS?: number; scale: [number, number]; shadow: boolean; slope: number; tint?: [number, number] };
    const specs: Spec[] = [];
    const t = this.def.theme;
    const add = (geo: THREE.BufferGeometry, count: number, opts: Partial<Spec>) => specs.push({ geo, count: Math.round(count * areaK), mat: staticMat, col: 0.7, minH: 2, scale: [0.8, 1.3], shadow: true, slope: 0.72, ...opts });
    switch (style) {
      case 'home':
        add(P.jungleTree(), 70, { mat: swayMat, scale: [0.6, 0.9] });
        add(P.bush(0x4caa40), 120, { col: 0, shadow: false });
        add(P.flowers(), 260, { col: 0, shadow: false, mat: grassMat, scale: [1, 1.5] });
        add(P.grassTuft(0x6dbb4a), 2200, { col: 0, shadow: false, mat: grassMat, scale: [0.8, 1.6] });
        add(P.rock(t.rock, 1), 50, { col: 1.2, scale: [0.6, 1.6] });
        add(P.palmTree(), 30, { mat: swayMat, minH: 0.8, maxS: 0.18 });
        break;
      case 'tropical':
        add(P.palmTree(), 220, { mat: swayMat, minH: 0.8, maxS: 0.32, scale: [0.9, 1.4] });
        add(P.jungleTree(), 300, { mat: swayMat, minS: 0.15, scale: [0.8, 1.5] });
        add(P.bush(0x2f8a3a), 260, { col: 0, shadow: false, scale: [0.8, 1.8] });
        add(P.flowers(), 200, { col: 0, shadow: false, mat: grassMat });
        add(P.grassTuft(0x4caa3a), 3000, { col: 0, shadow: false, mat: grassMat, scale: [0.9, 1.8] });
        add(P.rock(t.rock, 2), 70, { col: 1.2, scale: [0.7, 2.2] });
        break;
      case 'volcano':
        add(P.deadTree(), 130, { scale: [0.8, 1.5] });
        add(P.rock(0x2a2523, 3), 320, { col: 1.2, scale: [0.6, 3], slope: 0.4 });
        add(P.rock(0x4a2a1a, 4), 120, { col: 1, scale: [0.5, 1.5], slope: 0.4 });
        add(P.obsidian(), 140, { col: 1, scale: [0.6, 1.8], slope: 0.5 });
        add(P.magmaPool(), 60, { col: 1.5, scale: [0.8, 2.2], slope: 0.85, mat: magmaMat, shadow: false });
        add(P.ashShrub(), 260, { col: 0, scale: [0.7, 1.4], shadow: false });
        break;
      case 'snow':
        add(P.pineTree(true), 420, { scale: [0.8, 1.6], slope: 0.6 });
        add(P.rock(0x6f7c88, 5), 140, { col: 1.2, scale: [0.6, 2.5], slope: 0.4 });
        add(P.bush(0xdfe8ef), 90, { col: 0, shadow: false });
        break;
      case 'fortress':
        add(P.pineTree(false), 120, { scale: [0.8, 1.3] });
        add(P.deadTree(), 90, { scale: [0.8, 1.4] });
        add(P.rock(0x3a3a40, 6), 260, { col: 1.2, scale: [0.6, 2.8], slope: 0.35 });
        add(P.grassTuft(0x3c4a3a), 1200, { col: 0, shadow: false, mat: grassMat });
        break;
      case 'desert':
        add(P.cactus(), 160, { scale: [0.8, 1.5] });
        add(P.palmTree(), 50, { mat: swayMat, minH: 0.8, maxS: 0.25 });
        add(P.rock(0xb07a4a, 7), 160, { col: 1.2, scale: [0.6, 2.5], slope: 0.4 });
        add(P.bush(0x9a9a4a), 90, { col: 0, shadow: false, scale: [0.5, 1] });
        break;
      case 'final':
        add(P.goldenTree(), 240, { mat: swayMat, scale: [0.8, 1.4] });
        add(P.crystal(0xffe27a), 80, { col: 0.8, scale: [0.8, 2] });
        add(P.crystal(0x9ff6ff), 60, { col: 0.8, scale: [0.8, 2] });
        add(P.flowers(), 400, { col: 0, shadow: false, mat: grassMat, scale: [1, 1.6] });
        add(P.grassTuft(0xc7e07a), 2400, { col: 0, shadow: false, mat: grassMat, scale: [0.9, 1.7] });
        add(P.rock(0xe8e2d4, 8), 60, { col: 1.2, scale: [0.6, 1.8] });
        break;
    }
    if (style === 'snow') this.scatterFloes();

    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), nrm = new THREE.Vector3();
    const color = new THREE.Color();
    for (const sp of specs) {
      const mats: THREE.Matrix4[] = [];
      let tries = 0;
      while (mats.length < sp.count && tries < sp.count * 6) {
        tries++;
        const a = this.rand() * Math.PI * 2, d = Math.sqrt(this.rand()) * this.R * 1.2;
        const lx = Math.cos(a) * d, lz = Math.sin(a) * d;
        const x = lx + this.cx, z = lz + this.cz;
        const y = this.h(x, z);
        if (y < sp.minH) continue;
        const sNorm = 1 - d / this.coastRadius(a);
        if (sp.maxS !== undefined && sNorm > sp.maxS) continue;
        if (sp.minS !== undefined && sNorm < sp.minS) continue;
        this.normalAt(x, z, nrm);
        if (nrm.y < sp.slope) continue;
        if (this.inZone(lx, lz, sp.col > 0 ? 6 : 0)) continue;
        if (sp.col > 0 && this.distToPath(lx, lz) < 5) continue;
        if (sp.col > 0 && this.blocked(x, z, sp.col + 0.5)) continue;
        if (this.arena && Math.hypot(x - this.arena.pos.x, z - this.arena.pos.z) < this.arena.radius + 4) continue;
        const s = sp.scale[0] + this.rand() * (sp.scale[1] - sp.scale[0]);
        p.set(x, y - 0.15, z);
        if (sp.col === 0) q.setFromUnitVectors(up, nrm).multiply(new THREE.Quaternion().setFromAxisAngle(up, this.rand() * 6.28));
        else q.setFromAxisAngle(up, this.rand() * 6.28);
        sc.set(s, s, s);
        m4.compose(p, q, sc);
        mats.push(m4.clone());
        if (sp.col > 0) this.addCollider(x, z, sp.col * s);
      }
      if (!mats.length) continue;
      const im = new THREE.InstancedMesh(sp.geo, sp.mat, mats.length);
      mats.forEach((mm, i) => {
        im.setMatrixAt(i, mm);
        const v = 0.82 + this.rand() * 0.18;
        color.setRGB(v, v, v);
        im.setColorAt(i, color);
      });
      im.castShadow = sp.shadow;
      im.receiveShadow = !sp.shadow;
      im.computeBoundingSphere();
      this.decoGroup.add(im);
    }
  }

  private buildGrassMap() {
    const style = this.def.style;
    if (style === 'volcano' || style === 'snow' || style === 'desert') return;
    const N = this.N, W = N + 1;
    const t = this.def.theme;
    this.grassColors[0].setHex(t.grass);
    this.grassColors[1].setHex(t.grass2);
    const data = new Uint16Array(W * W * 4);
    const h = this.heights;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const k = j * W + i;
      const y = h[k];
      const lx = i * this.cell - this.half, lz = j * this.cell - this.half;
      let m = 0;
      if (y > 1.6 && i > 0 && j > 0 && i < N && j < N) {
        const dx = h[k + 1] - h[k - 1], dz = h[k + W] - h[k - W];
        const ny = 2 * this.cell / Math.hypot(dx, 2 * this.cell, dz);
        m = smoothstep(0.78, 0.9, ny) * smoothstep(2.6, 4.5, this.distToPath(lx, lz));
        if (m > 0 && this.inZone(lx, lz, 1)) m = 0;
        if (m > 0 && this.arena && Math.hypot(lx + this.cx - this.arena.pos.x, lz + this.cz - this.arena.pos.z) < this.arena.radius + 2) m = 0;
        if (m > 0 && this.blocked(lx + this.cx, lz + this.cz, 0)) m = 0;
        if (m > 0 && y > this.def.height * 0.75 && style !== 'final') m *= 0.4;
      }
      data[k * 4] = THREE.DataUtils.toHalfFloat(y);
      data[k * 4 + 1] = THREE.DataUtils.toHalfFloat(m);
    }
    const tex = new THREE.DataTexture(data, W, W, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.grassTex = tex;
  }

  private scatterFloes() {
    const geo = P.iceFloe();
    const n = 90;
    const im = new THREE.InstancedMesh(geo, staticMat, n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let k = 0;
    for (let i = 0; i < n * 3 && k < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const d = this.coastRadius(a) + 15 + this.rand() * 120;
      const x = this.cx + Math.cos(a) * d, z = this.cz + Math.sin(a) * d;
      if (Math.abs(Math.atan2(Math.sin(a - this.dockDir), Math.cos(a - this.dockDir))) < 0.25) continue;
      const r = 3 + this.rand() * 9;
      p.set(x, 0.05, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rand() * 6);
      s.set(r, 0.6, r * (0.6 + this.rand() * 0.5));
      m4.compose(p, q, s);
      im.setMatrixAt(k++, m4);
    }
    im.count = k;
    im.receiveShadow = true;
    this.decoGroup.add(im);
  }

  private placeChests() {
    const n = this.def.style === 'home' ? 3 : 9;
    let made = 0;
    for (let k = 0; k < 400 && made < n; k++) {
      const a = this.rand() * Math.PI * 2, d = this.R * (0.1 + this.rand() * 0.85);
      const lx = Math.cos(a) * d, lz = Math.sin(a) * d;
      const x = lx + this.cx, z = lz + this.cz;
      const y = this.h(x, z);
      if (y < 2) continue;
      if (this.inZone(lx, lz, 3)) continue;
      const pd = this.distToPath(lx, lz);
      if (pd < 6 || pd > 70) continue;
      if (this.blocked(x, z, 2)) continue;
      if (this.chests.some((c) => c.pos.distanceTo(new THREE.Vector3(x, y, z)) < 60)) continue;
      this.chests.push({ id: `i${this.def.id}c${made}`, pos: new THREE.Vector3(x, y, z), rotY: this.rand() * 6.28, tier: 1 });
      this.addCollider(x, z, 1);
      made++;
    }
    // Every camp has a chest too.
    this.spawns.forEach((s, i) => {
      if (s.kind !== 'camp') return;
      const x = s.pos.x - 4, z = s.pos.z + 3;
      this.chests.push({ id: `i${this.def.id}k${i}`, pos: new THREE.Vector3(x, this.h(x, z), z), rotY: 0.5, tier: 2 });
    });
    // Arena guards and a few patrols.
    if (this.arena) {
      const A = this.arena;
      const gx = A.pos.x + Math.cos(this.dockDir) * (A.radius + 14), gz = A.pos.z + Math.sin(this.dockDir) * (A.radius + 14);
      this.spawns.push({ pos: new THREE.Vector3(gx, this.h(gx, gz), gz), count: 3, kind: 'guard', radius: 7 });
    }
  }

  private finalizeProps() {
    const g = this.batch.merge();
    if (g.attributes.position) {
      const m = new THREE.Mesh(g, staticMat);
      m.position.set(this.cx, 0, this.cz);
      m.castShadow = true;
      m.receiveShadow = true;
      this.decoGroup.add(m);
    }
    const gg = this.glowBatch.merge();
    if (gg.attributes.position) {
      const m = new THREE.Mesh(gg, glowMat);
      m.position.set(this.cx, 0, this.cz);
      this.decoGroup.add(m);
    }
  }

  isOnLava(x: number, z: number) {
    for (const s of this.lavaSegs) {
      const q = closestOnSeg(x, z, s.ax, s.az, s.bx, s.bz);
      if (Math.hypot(q[0] - x, q[1] - z) < s.w * 0.8) return true;
    }
    return false;
  }

  /** Walkable pier deck height at (x,z), or -Infinity if not on the pier. */
  pierHeight(x: number, z: number) {
    const ex = this.pierEnd.x - this.pierStart.x, ez = this.pierEnd.z - this.pierStart.z;
    const len = Math.hypot(ex, ez);
    const dx = ex / len, dz = ez / len;
    const rx = x - this.pierStart.x, rz = z - this.pierStart.z;
    const t = rx * dx + rz * dz;
    if (t < -8 || t > len + 0.6) return -Infinity;
    if (Math.abs(rx * dz - rz * dx) > 2.95) return -Infinity;
    return 1.71;
  }

  contains(x: number, z: number, pad = 0) {
    return Math.hypot(x - this.cx, z - this.cz) < this.R * 1.25 + pad;
  }

  update(dt: number, time: number, cam: THREE.Vector3) {
    const d = Math.hypot(cam.x - this.cx, cam.z - this.cz) - this.R;
    const vis = d < 1500;
    if (vis !== this.decoVisible) { this.decoVisible = vis; this.decoGroup.visible = vis; }
    this.terrain.castShadow = false;
    if (this.beacon.visible) (this.beacon.material as THREE.MeshBasicMaterial).opacity = 0.16 + Math.sin(time * 2) * 0.06;
    this.buoy.position.y = Math.sin(time * 1.3) * 0.3 - 0.4;
    if (!vis) return;
    for (const a of this.animated) {
      if (a.kind === 'spin') a.obj.rotation.z += dt * a.speed;
      else if (a.kind === 'bob') { a.obj.position.y = a.base + Math.sin(time * a.speed) * 3; a.obj.rotation.y += dt * 0.05; }
    }
  }
}

export function closestOnSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): [number, number] {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [ax + dx * t, az + dz * t];
}

export { sharedUniforms };
