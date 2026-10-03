// A sailing ship: kinematic sailing physics on the waves, buoyancy, island
// and ship collisions, broadside cannons, damage, sinking and wreck state.
import * as THREE from 'three';
import { ctx } from '../game/ctx';
import { buildShip, deckHeight, halfWidth, setCannons, animateRig, ShipDims, ShipParts, ShipStyle } from './shipModel';
import { clamp, damp, dampAngle, rand } from '../core/math';
import type { DamageInfo, Target, Team } from '../combat/Combat';
import { Projectiles } from '../combat/Projectiles';
import { WakeTrail } from '../fx/WakeTrail';

const SAIL_FRAC = [0, 0.38, 0.7, 1];

export class Ship implements Target {
  group = new THREE.Group();
  parts: ShipParts;
  dims: ShipDims;
  style: ShipStyle;
  team: Team;
  kind = 'ship' as const;
  alive = true;
  radius: number;
  name: string;

  pos = new THREE.Vector3();
  heading = 0;
  speed = 0;
  rudder = 0;
  rudderInput = 0;
  sail = 0;
  maxSpeed = 30;
  turnRate = 0.55;
  hp = 400;
  hpMax = 400;
  cannonsPerSide = 2;
  cannonDamage = 55;
  reload = 0;
  reloadTime = 2.6;
  burst = 0;
  sinking = 0; // 0 alive; >0 seconds since sinking began
  wreck = false;
  wreckTimer = 0;
  anchored = false;
  docked = false;
  private pitch = 0;
  private roll = 0;
  private heave = 0;
  private recoil = 0;
  prevMatrix = new THREE.Matrix4();
  delta = new THREE.Matrix4();
  deltaYaw = 0;
  private invYaw = new THREE.Matrix4();
  private time = Math.random() * 10;
  smoke = 0;
  onSunk: (() => void) | null = null;
  lastHitBy: 'player' | 'companion' | 'ship' | 'enemy' | 'env' | undefined;
  private trail: WakeTrail;

  constructor(style: ShipStyle, dims: Partial<ShipDims> = {}, opts: { name?: string; look?: { hat: string; hatColor: string } } = {}) {
    this.style = style;
    this.dims = { L: 24, W: 8, deckY: 2.4, qd: 5.2, fc: 4.6, ...dims };
    this.team = style === 'player' ? 'player' : 'enemy';
    this.name = opts.name ?? 'Ship';
    this.parts = buildShip(style, this.dims, opts.look);
    this.group.add(this.parts.root);
    this.radius = this.dims.L * 0.45;
    setCannons(this.parts, this.dims, this.cannonsPerSide);
    ctx.scene.add(this.group);
    this.trail = new WakeTrail(ctx.scene, this.dims.W * 0.55);
  }

  setCannonCount(n: number) {
    this.cannonsPerSide = n;
    setCannons(this.parts, this.dims, n);
  }

  get forward() { return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading)); }
  get right() { return new THREE.Vector3(-Math.cos(this.heading), 0, Math.sin(this.heading)); }

  /** Local deck coordinates -> world. */
  toWorld(local: THREE.Vector3, out = new THREE.Vector3()) {
    return out.copy(local).applyMatrix4(this.group.matrixWorld);
  }
  toLocalFlat(x: number, z: number) {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    return { lx: dx * c - dz * s, lz: dx * s + dz * c };
  }

  insideDeck(lx: number, lz: number, margin = 0.45) {
    const d = this.dims;
    if (lz < -d.L / 2 + 0.4 || lz > d.L / 2 - 1.2) return false;
    return Math.abs(lx) < halfWidth(d, lz) - margin;
  }

  deckHeightAtWorld(x: number, z: number): number | null {
    if (this.sinking > 4 && !this.wreck) return null;
    const dx = x - this.pos.x, dz = z - this.pos.z;
    if (dx * dx + dz * dz > this.dims.L * this.dims.L) return null;
    const { lx, lz } = this.toLocalFlat(x, z);
    if (!this.insideDeck(lx, lz, 0.1)) return null;
    const p = new THREE.Vector3(lx, deckHeight(this.dims, lz), lz).applyMatrix4(this.group.matrixWorld);
    return p.y;
  }

  /** Clamp a world position to stay on deck (ship rails). */
  clampToDeck(p: THREE.Vector3) {
    const { lx, lz } = this.toLocalFlat(p.x, p.z);
    const d = this.dims;
    const clz = clamp(lz, -d.L / 2 + 0.6, d.L / 2 - 1.6);
    const hw = halfWidth(d, clz) - 0.6;
    const clx = clamp(lx, -hw, hw);
    if (clx === lx && clz === lz) return false;
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    p.x = this.pos.x + clx * c + clz * s;
    p.z = this.pos.z - clx * s + clz * c;
    return true;
  }

  /** Mast colliders in world space. */
  collideOnDeck(p: THREE.Vector3, r: number) {
    const d = this.dims;
    const masts: [number, number][] = [[d.L * 0.04, 0.4], [d.L * 0.3, 0.4], [d.L * 0.04 - 2.1, 0.55]];
    for (const [mz, pad] of masts) {
      const mx = this.pos.x + Math.sin(this.heading) * mz, mzw = this.pos.z + Math.cos(this.heading) * mz;
      const dx = p.x - mx, dz = p.z - mzw;
      const dist = Math.hypot(dx, dz);
      if (dist < r + pad && dist > 1e-4) { p.x = mx + dx / dist * (r + pad); p.z = mzw + dz / dist * (r + pad); }
    }
  }

  helmWorld(out = new THREE.Vector3()) {
    return this.toWorld(new THREE.Vector3(0, deckHeight(this.dims, -this.dims.L / 2 + 1.6), -this.dims.L / 2 + 1.6), out);
  }
  bowWorld(out = new THREE.Vector3()) {
    return this.toWorld(new THREE.Vector3(0, deckHeight(this.dims, this.dims.L / 2 - 3), this.dims.L / 2 - 3), out);
  }

  center(out: THREE.Vector3) { return out.copy(this.pos).setY(this.pos.y + 2.5); }

  hitTest(p: THREE.Vector3, r: number) {
    if (!this.alive) return false;
    const { lx, lz } = this.toLocalFlat(p.x, p.z);
    const d = this.dims;
    if (Math.abs(lz) > d.L / 2 + r) return false;
    if (Math.abs(lx) > halfWidth(d, clamp(lz, -d.L / 2, d.L / 2)) + r + 0.3) return false;
    const ly = p.y - this.pos.y;
    return ly > -3 - r && ly < d.deckY + 6 + r;
  }

  takeDamage(info: DamageInfo) {
    if (!this.alive) return;
    const dmg = info.amount * (info.shipDamageMult ?? 1);
    this.hp -= dmg;
    this.lastHitBy = info.source;
    this.smoke = Math.min(1, this.smoke + dmg / this.hpMax * 2);
    if (this.style === 'player') { ctx.fx.shake(0.5); ctx.audio.sfx('creak'); }
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.sinking = 0.001;
      ctx.audio.sfx('explosion', this.pos, 1.2);
      ctx.fx.explosion(this.center(new THREE.Vector3()), 2.2);
      this.onSunk?.();
    }
  }

  repair(amount: number) {
    this.hp = Math.min(this.hpMax, this.hp + amount);
    if (this.hp > this.hpMax * 0.5) this.smoke = 0;
  }

  /** Fire a broadside to one side; optional target point for auto-elevation. */
  fireBroadside(side: 1 | -1, target?: THREE.Vector3 | null, source: 'player' | 'companion' | 'enemy' = 'enemy', dmgMult = 1) {
    if (this.reload > 0 || !this.alive) return false;
    this.reload = this.reloadTime;
    const ports = this.parts.cannonPorts.filter((p) => p.side === side);
    const speed = 85;
    const g = 22;
    ports.forEach((port, i) => {
      setTimeout(() => {
        if (!this.alive && this.sinking > 2) return;
        const from = this.toWorld(port.pos.clone());
        const sideDir = this.right.multiplyScalar(-side);
        let vel: THREE.Vector3 | null = null;
        if (target) {
          const aim = target.clone().add(new THREE.Vector3(rand(-2, 2), 0, rand(-2, 2)));
          vel = Projectiles.ballistic(from, aim, speed, g);
          if (vel && vel.clone().setY(0).normalize().dot(sideDir) < 0.35) vel = null;
        }
        if (!vel) vel = sideDir.clone().multiplyScalar(speed * Math.cos(0.12)).setY(speed * Math.sin(0.12)).add(new THREE.Vector3(rand(-2, 2), rand(-1, 1), rand(-2, 2)));
        vel.add(this.forward.multiplyScalar(this.speed));
        ctx.projectiles.spawn({
          kind: 'cannon', pos: from, vel, gravity: g, radius: 0.9,
          info: { amount: this.cannonDamage * dmgMult, from, team: this.team, element: 'cannon', source, knockback: 4, shipDamageMult: 1 },
          aoe: 3,
        });
        ctx.particles.burst(from, 12, { speed: 4, life: 1.2, size: 1.0, sizeEnd: 2.8, color: 0xdddddd, colorEnd: 0x888888, alpha: 0.6, drag: 2.5 });
        ctx.particles.burst(from, 6, { speed: 8, life: 0.25, size: 0.9, sizeEnd: 0.2, color: 0xfff0a0, colorEnd: 0xff6010, additive: true, drag: 5 });
        ctx.fx.light(from, 0xffb050, 40, 0.15, 25);
        ctx.audio.sfx('cannon', from, 0.9);
        this.recoil += side * 0.03;
      }, i * 90 + rand(0, 40));
    });
    if (this.style === 'player') ctx.fx.shake(0.35);
    return true;
  }

  gale() {
    this.burst = 2.6;
    ctx.audio.sfx('cannon', this.pos, 1.2);
    ctx.audio.sfx('whoosh', this.pos, 1);
    const stern = this.toWorld(new THREE.Vector3(0, 2, -this.dims.L / 2));
    ctx.fx.explosion(stern, 1.2, 0xffd08a);
    ctx.fx.shake(0.8);
  }

  update(dt: number) {
    this.time += dt;
    this.prevMatrix.copy(this.group.matrixWorld);
    const prevYaw = this.heading;
    this.reload = Math.max(0, this.reload - dt);

    if (this.sinking > 0) {
      this.sinking += dt;
      this.speed = damp(this.speed, 0, 1, dt);
    } else if (this.docked) {
      this.speed = 0;
    } else {
      const target = this.anchored ? 0 : this.maxSpeed * SAIL_FRAC[this.sail];
      const accel = target > this.speed ? 3.2 : 2.4;
      this.speed += clamp(target - this.speed, -accel * dt, accel * dt);
      if (this.burst > 0) {
        this.burst -= dt;
        this.speed = Math.max(this.speed, this.maxSpeed * 2.1);
        if (Math.random() < 0.8) {
          const stern = this.toWorld(new THREE.Vector3(rand(-1, 1), 1.5, -this.dims.L / 2 - 1));
          ctx.particles.emit({ pos: stern, vel: this.forward.multiplyScalar(-15).add(new THREE.Vector3(rand(-2, 2), rand(0, 2), rand(-2, 2))), life: 0.8, size: 1.5, sizeEnd: 4, color: 0xffffff, colorEnd: 0xbfe0ff, alpha: 0.7, drag: 2 });
        }
      }
      this.rudder = damp(this.rudder, this.rudderInput, 3, dt);
      const turnK = 0.35 + 0.65 * Math.min(1, Math.abs(this.speed) / 10);
      this.heading += -this.rudder * this.turnRate * turnK * dt;
    }

    const fwd = this.forward;
    this.pos.x += fwd.x * this.speed * dt;
    this.pos.z += fwd.z * this.speed * dt;

    // Collisions with islands (sample hull points).
    if (this.sinking === 0 && !this.docked) this.collideTerrain(dt);
    this.collideShips();

    // Buoyancy.
    const o = ctx.ocean;
    const L = this.dims.L, W = this.dims.W;
    const r = this.right;
    const pb = this.pos.clone().addScaledVector(fwd, L * 0.4), ps = this.pos.clone().addScaledVector(fwd, -L * 0.4);
    const pp = this.pos.clone().addScaledVector(r, W * 0.45), pst = this.pos.clone().addScaledVector(r, -W * 0.45);
    const hb = o.heightAt(pb.x, pb.z), hs = o.heightAt(ps.x, ps.z), hp = o.heightAt(pp.x, pp.z), hst = o.heightAt(pst.x, pst.z);
    const heave = (hb + hs + hp + hst) / 4;
    this.heave = damp(this.heave, heave, 4, dt);
    this.pitch = damp(this.pitch, Math.atan2(hs - hb, L * 0.8) * 0.85, 3, dt);
    const lean = -this.rudder * Math.min(1, this.speed / this.maxSpeed) * 0.08;
    this.roll = damp(this.roll, Math.atan2(hst - hp, W * 0.9) * 0.9 + lean, 3, dt);
    this.recoil = damp(this.recoil, 0, 4, dt);
    let sinkY = 0, sinkRoll = 0, sinkPitch = 0;
    if (this.sinking > 0) {
      const t = this.sinking;
      if (this.wreck) { sinkY = -Math.min(1.4, t * 0.4); sinkRoll = Math.min(0.22, t * 0.06); sinkPitch = Math.min(0.08, t * 0.02); }
      else { sinkY = -t * t * 0.35; sinkRoll = Math.min(0.6, t * 0.12); sinkPitch = Math.min(0.5, t * 0.08); }
    }
    this.pos.y = this.heave - 0.25 + sinkY;
    this.group.position.copy(this.pos);
    this.group.rotation.set(this.pitch + sinkPitch, this.heading, this.roll + this.recoil + sinkRoll, 'YXZ');
    this.group.updateMatrixWorld(true);
    this.delta.copy(this.group.matrixWorld).multiply(this.invYaw.copy(this.prevMatrix).invert());
    this.deltaYaw = this.heading - prevYaw;

    // Visuals.
    animateRig(this.parts, this.time, this.sinking > 0 ? 0 : this.anchored || this.docked ? 0 : this.sail, this.speed);
    this.parts.wheel.rotation.z = this.rudder * 2.5;
    this.parts.windows.emissiveIntensity = 0.2 + ctx.env.night * 2.5;
    this.wake(dt);
    if (this.smoke > 0.15 || this.sinking > 0) {
      if (Math.random() < dt * 20 * Math.max(this.smoke, this.sinking > 0 ? 1 : 0)) {
        const p = this.toWorld(new THREE.Vector3(rand(-2, 2), this.dims.deckY + 1, rand(-L * 0.3, L * 0.3)));
        ctx.particles.emit({ pos: p, vel: new THREE.Vector3(rand(-0.5, 0.5), rand(2, 4), rand(-0.5, 0.5)), life: 2.5, size: 1.5, sizeEnd: 5, color: 0x444444, colorEnd: 0x222222, alpha: 0.5, drag: 0.5 });
        if (Math.random() < 0.3) ctx.particles.emit({ pos: p, vel: new THREE.Vector3(0, 2, 0), life: 0.6, size: 1, sizeEnd: 0.2, color: 0xffa040, colorEnd: 0xff3000, additive: true });
      }
    }
  }

  private wake(dt: number) {
    const sp = Math.abs(this.speed);
    const sternW = this.toWorld(new THREE.Vector3(0, 0, -this.dims.L * 0.47));
    this.trail.update(dt, sternW, this.sinking > 0 ? 0 : this.speed, (x, z) => ctx.ocean.heightAt(x, z));
    if (sp < 2 || this.group.position.distanceToSquared(ctx.camera.position) > 400 * 400) return;
    const rate = Math.min(1, sp / 25);
    const L = this.dims.L;
    if (Math.random() < rate * 1.5) {
      for (const side of [-1, 1]) {
        const p = this.toWorld(new THREE.Vector3(side * this.dims.W * 0.35, 0, -L * 0.45));
        p.y = ctx.ocean.heightAt(p.x, p.z) + 0.2;
        ctx.particles.emit({ pos: p, vel: this.right.multiplyScalar(side * -1.5).add(new THREE.Vector3(0, 0.6, 0)), life: 1.4, size: 0.9, sizeEnd: 2.2, color: 0xffffff, colorEnd: 0xd8f0ff, alpha: 0.4, drag: 1.5 });
      }
    }
    if (Math.random() < rate) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const p = this.toWorld(new THREE.Vector3(side * 1.2, 0.3, L * 0.48));
      p.y = ctx.ocean.heightAt(p.x, p.z) + 0.4;
      const v = this.right.multiplyScalar(-side * rand(2, 5)).add(new THREE.Vector3(0, rand(2, 5) * rate, 0)).add(this.forward.multiplyScalar(sp * 0.4));
      ctx.particles.emit({ pos: p, vel: v, life: 0.9, size: 0.7, sizeEnd: 1.6, color: 0xffffff, colorEnd: 0xcfeeff, alpha: 0.8, gravity: 9, drag: 0.8 });
    }
  }

  private collideTerrain(dt: number) {
    const fwd = this.forward, r = this.right, L = this.dims.L, W = this.dims.W;
    const probes: [THREE.Vector3, number][] = [
      [this.pos.clone().addScaledVector(fwd, L * 0.5), 1],
      [this.pos.clone().addScaledVector(fwd, L * 0.25).addScaledVector(r, W * 0.45), 0.6],
      [this.pos.clone().addScaledVector(fwd, L * 0.25).addScaledVector(r, -W * 0.45), 0.6],
      [this.pos.clone().addScaledVector(fwd, -L * 0.45), 0.5],
    ];
    for (const [p, k] of probes) {
      const h = ctx.world.terrainHeight(p.x, p.z);
      if (h > -1.6) {
        // Push away from the slope.
        const isl = ctx.world.islandAt(p.x, p.z, 50);
        let push = new THREE.Vector3();
        if (isl) push.set(p.x - isl.cx, 0, p.z - isl.cz).normalize();
        else push.copy(fwd).negate();
        this.pos.addScaledVector(push, (2 + Math.abs(this.speed) * dt * 2) * k);
        if (Math.abs(this.speed) > 9 && this.style === 'player') {
          this.takeDamage({ amount: Math.abs(this.speed) * 0.8, from: p, team: 'enemy', source: 'env' });
          ctx.audio.sfx('creak', p);
          ctx.fx.splash(p, 1);
        }
        this.speed *= 0.4;
        break;
      }
    }
  }

  private collideShips() {
    for (const s of ctx.world.ships) {
      if (s === this) continue;
      if (s.sinking > 3 && !s.wreck) continue;
      const dx = this.pos.x - s.pos.x, dz = this.pos.z - s.pos.z;
      const d = Math.hypot(dx, dz);
      const min = (this.radius + s.radius) * 0.62;
      if (d < min && d > 0.01) {
        const push = (min - d) * 0.5;
        this.pos.x += (dx / d) * push;
        this.pos.z += (dz / d) * push;
      }
    }
  }

  dispose() {
    ctx.scene.remove(this.group);
    this.trail.dispose(ctx.scene);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
      }
    });
  }
}
