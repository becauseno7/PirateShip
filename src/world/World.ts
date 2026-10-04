// The world: all islands, global terrain/ground queries, collision and the
// shared height texture used by the water shader and the map.
import * as THREE from 'three';
import { ISLANDS } from '../game/data';
import { Island } from './Island';
import { WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_X, WORLD_MIN_Z } from '../game/state';
import type { Ship } from '../entities/Ship';
import { ctx } from '../game/ctx';
import { rand } from '../core/math';

export const HT_CELL = 8;
export const HT_W = Math.ceil((WORLD_MAX_X - WORLD_MIN_X) / HT_CELL);
export const HT_H = Math.ceil((WORLD_MAX_Z - WORLD_MIN_Z) / HT_CELL);

export interface Ground { h: number; ship: Ship | null; island: Island | null }

export class World {
  islands: Island[] = [];
  ships: Ship[] = [];
  group = new THREE.Group();
  heightGrid = new Float32Array(HT_W * HT_H);
  heightTex!: THREE.DataTexture;
  private flames: THREE.Mesh[] = [];
  private flameMat: THREE.MeshBasicMaterial;
  private fireLights: THREE.PointLight[] = [];
  private firePos: THREE.Vector3[] = [];
  private lightTimer = 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.flameMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 5; i++) {
      const l = new THREE.PointLight(0xff8a30, 0, 30, 1.6);
      this.fireLights.push(l);
      scene.add(l);
    }
  }

  /** Generate islands incrementally so the loading screen can show progress. */
  async generate(onProgress: (f: number, label: string) => void) {
    for (let i = 0; i < ISLANDS.length; i++) {
      onProgress(i / (ISLANDS.length + 1), `Charting ${ISLANDS[i].name}...`);
      await new Promise((r) => setTimeout(r, 16));
      const isl = new Island(ISLANDS[i]);
      this.islands.push(isl);
      this.group.add(isl.group);
      for (const p of [...isl.torchPositions, ...isl.firePositions]) this.addFlame(p, isl.torchPositions.includes(p) ? 0.7 : 1.1);
    }
    onProgress(ISLANDS.length / (ISLANDS.length + 1), 'Mapping the Grand Meridian...');
    await new Promise((r) => setTimeout(r, 16));
    this.buildHeightTexture();
    ctx.ocean.setHeightTexture(this.heightTex, WORLD_MIN_X, WORLD_MIN_Z, WORLD_MAX_X - WORLD_MIN_X, WORLD_MAX_Z - WORLD_MIN_Z);
    ctx.ocean.setIslands(this.islands.map((i) => ({ x: i.cx, z: i.cz, r: i.R, tint: i.def.theme.shallow })));
  }

  private addFlame(p: THREE.Vector3, s: number) {
    const geo = new THREE.ConeGeometry(0.45 * s, 1.6 * s, 7);
    geo.translate(0, 0.8 * s, 0);
    const m = new THREE.Mesh(geo, this.flameMat);
    m.position.copy(p);
    this.group.add(m);
    const core = new THREE.Mesh(new THREE.ConeGeometry(0.25 * s, 1.0 * s, 6).translate(0, 0.5 * s, 0), new THREE.MeshBasicMaterial({ color: 0xfff0a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.add(core);
    this.flames.push(m);
    this.firePos.push(p);
  }

  private buildHeightTexture() {
    const g = this.heightGrid;
    for (let j = 0; j < HT_H; j++) {
      const z = WORLD_MIN_Z + (j + 0.5) * HT_CELL;
      for (let i = 0; i < HT_W; i++) {
        const x = WORLD_MIN_X + (i + 0.5) * HT_CELL;
        g[j * HT_W + i] = this.terrainHeight(x, z);
      }
    }
    const half = new Uint16Array(g.length);
    for (let i = 0; i < g.length; i++) half[i] = THREE.DataUtils.toHalfFloat(Math.max(-60, g[i]));
    this.heightTex = new THREE.DataTexture(half, HT_W, HT_H, THREE.RedFormat, THREE.HalfFloatType);
    this.heightTex.minFilter = THREE.LinearFilter;
    this.heightTex.magFilter = THREE.LinearFilter;
    this.heightTex.wrapS = this.heightTex.wrapT = THREE.ClampToEdgeWrapping;
    this.heightTex.needsUpdate = true;
  }

  islandAt(x: number, z: number, pad = 0): Island | null {
    for (const i of this.islands) if (i.contains(x, z, pad)) return i;
    return null;
  }

  terrainHeight(x: number, z: number) {
    let h = -60;
    for (const isl of this.islands) {
      if (Math.abs(x - isl.cx) > isl.half || Math.abs(z - isl.cz) > isl.half) continue;
      h = Math.max(h, isl.heightAt(x, z), isl.pierHeight(x, z));
    }
    return h;
  }

  /** Highest walkable surface under (x,z) that is not far above y. */
  groundAt(x: number, z: number, y: number, stepUp = 0.9): Ground {
    let best = this.terrainHeight(x, z);
    let ship: Ship | null = null;
    for (const s of this.ships) {
      const dh = s.deckHeightAtWorld(x, z);
      if (dh !== null && dh <= y + stepUp && dh > best) { best = dh; ship = s; }
    }
    return { h: best, ship, island: ship ? null : this.islandAt(x, z) };
  }

  /** Push a circle out of static colliders. */
  collide(pos: THREE.Vector3, radius: number) {
    const isl = this.islandAt(pos.x, pos.z);
    if (!isl) return;
    for (let iter = 0; iter < 2; iter++) {
      for (const c of isl.collidersNear(pos.x, pos.z)) {
        const dx = pos.x - c.x, dz = pos.z - c.z;
        const d = Math.hypot(dx, dz);
        const min = c.r + radius;
        if (d < min && d > 1e-4) {
          pos.x = c.x + (dx / d) * min;
          pos.z = c.z + (dz / d) * min;
        }
      }
    }
  }

  isLava(x: number, z: number) {
    const isl = this.islandAt(x, z);
    return !!isl && isl.def.style === 'volcano' && isl.isOnLava(x, z);
  }

  update(dt: number, time: number, cam: THREE.Vector3) {
    for (const i of this.islands) i.update(dt, time, cam);
    for (let k = 0; k < this.flames.length; k++) {
      const f = this.flames[k];
      const near = f.position.distanceToSquared(cam) < 600 * 600;
      f.visible = near;
      if (!near) continue;
      const fl = 0.85 + Math.sin(time * 13 + k * 3.1) * 0.1 + Math.sin(time * 23 + k) * 0.06;
      f.scale.set(1 + (fl - 1) * 0.5, fl, 1 + (fl - 1) * 0.5);
      if (Math.random() < dt * 6 && f.position.distanceToSquared(cam) < 120 * 120) {
        ctx.particles.emit({ pos: f.position.clone().add(new THREE.Vector3(rand(-0.2, 0.2), 1.2, rand(-0.2, 0.2))), vel: new THREE.Vector3(rand(-0.3, 0.3), rand(1.5, 3), rand(-0.3, 0.3)), life: rand(0.5, 1), size: rand(0.15, 0.35), sizeEnd: 0.02, color: 0xffb040, colorEnd: 0xff3010, additive: true });
      }
    }
    this.lightTimer -= dt;
    if (this.lightTimer <= 0) {
      this.lightTimer = 0.5;
      const sorted = this.firePos.map((p, i) => ({ p, d: p.distanceToSquared(cam), i })).sort((a, b) => a.d - b.d);
      this.fireLights.forEach((l, i) => {
        const s = sorted[i];
        if (s && s.d < 200 * 200) { l.position.copy(s.p).add(new THREE.Vector3(0, 1.4, 0)); l.userData.on = true; }
        else l.userData.on = false;
      });
    }
    this.fireLights.forEach((l, i) => { l.intensity = l.userData.on ? 22 * (0.85 + Math.sin(time * 17 + i * 2) * 0.15) : 0; });
  }
}
