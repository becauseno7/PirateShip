// Kaito, the three-sword swordsman: steers the ship on autopilot toward the
// Log Pose, fires flying slashes at sea and fights beside the captain ashore.
import * as THREE from 'three';
import { ctx } from '../game/ctx';
import { Fighter } from './Fighter';
import { COMPANION, ISLANDS } from '../game/data';
import type { DamageInfo, Target } from '../combat/Combat';
import { angleDiff, clamp, dampAngle, pick, rand } from '../core/math';

const BARKS_FIGHT = ['Three-Sword Style!', 'Is that all you\'ve got?', 'Stay sharp, Captain!', 'I\'ll cut through anything.', 'Nothing happened... yet.'];
const BARKS_SEA = ['Enemy off the bow!', 'Leave the small fry to me!', 'Flying slash... Hundred-Pound Cannon!', 'They picked the wrong ship.'];

export class Companion extends Fighter {
  mode: 'ship' | 'helm' | 'land' = 'ship';
  downed = 0;
  attackCd = 0;
  slashCd = 0;
  combo = 0;
  barkCd = 6;
  target: Target | null = null;
  private waypoint: THREE.Vector3 | null = null;
  private repathTimer = 0;

  constructor() {
    super({
      face: 'hero', iris: '#2a3a2a', skin: '#e3b48a', hair: '#3f9a4a', hairStyle: 'spiky', shirt: '#f4f4f0', pants: '#22262e', shoes: '#1a1a1a', hat: 'none',
      sash: '#3f8a4a', weapon: 'katana3', weaponColor: 0xe8eef4, outline: true, build: 1.08,
    }, 'player', 'ally');
    this.hpMax = 300;
    this.hp = 300;
    ctx.combat.register(this);
  }

  get dmgMult() { return 1 + (ctx.progress.level - 1) * 0.08 + (ctx.progress.awakened ? 0.4 : 0); }

  takeDamage(info: DamageInfo) {
    if (this.downed > 0) return;
    super.takeDamage({ ...info, amount: info.amount * 0.6 });
  }

  die() {
    // Kaito never truly falls; he takes a knee and gets back up.
    this.hp = 1;
    this.downed = 7;
    this.untargetable = true;
    this.action = null;
    ctx.ui.say(COMPANION.name, 'Tch... give me a second...');
  }

  bark(lines: string[], chance = 0.35) {
    if (this.barkCd > 0 || Math.random() > chance || ctx.game.inCutscene) return;
    this.barkCd = 12;
    ctx.ui.say(COMPANION.name, pick(lines));
  }

  placeOnShip(at: 'bow' | 'helm' = 'bow') {
    const s = ctx.ship;
    const p = at === 'bow' ? s.bowWorld(new THREE.Vector3()) : s.helmWorld(new THREE.Vector3());
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.groundShip = s;
    this.grounded = true;
    this.yaw = s.heading;
  }

  placeNear(p: THREE.Vector3) {
    const a = rand(0, Math.PI * 2);
    const q = p.clone().add(new THREE.Vector3(Math.cos(a) * 2.5, 2, Math.sin(a) * 2.5));
    const g = ctx.world.groundAt(q.x, q.z, q.y + 3);
    q.y = g.h;
    this.pos.copy(q);
    this.vel.set(0, 0, 0);
    this.groundShip = g.ship;
  }

  update(dt: number) {
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.slashCd = Math.max(0, this.slashCd - dt);
    this.barkCd = Math.max(0, this.barkCd - dt);
    const player = ctx.player;
    const ship = ctx.ship;
    if (this.downed > 0) {
      this.downed -= dt;
      this.action = { name: 'down', anim: 'kneel', t: 0.5, dur: 1, events: [], lockMove: true };
      if (this.downed <= 0) { this.action = null; this.untargetable = false; this.hp = this.hpMax * 0.6; ctx.ui.say(COMPANION.name, 'Alright. Round two.'); }
      this.physics(dt, new THREE.Vector3());
      this.animate(dt);
      return;
    }
    if (this.hp < this.hpMax) this.hp = Math.min(this.hpMax, this.hp + dt * 4);

    const playerOnShip = player.groundShip === ship || player.mode === 'helm';
    const steering = ctx.game.kaitoSteering && !ship.docked && ship.alive && player.mode !== 'helm';
    // Keep up with the captain.
    if (playerOnShip && this.groundShip !== ship && this.grounded) this.placeOnShip();
    if (!playerOnShip && player.grounded && this.pos.distanceTo(player.pos) > 45) this.placeNear(player.pos);
    if (this.inWater) { if (playerOnShip) this.placeOnShip(); else this.placeNear(player.pos); }

    let wish = new THREE.Vector3();
    this.steer = null;
    if (steering && this.groundShip === ship) {
      // Walk (or hop) to the helm and drive.
      const helm = ship.helmWorld(new THREE.Vector3());
      if (this.pos.distanceTo(helm) > 1.2) {
        if (this.pos.distanceTo(helm) > 4) this.placeOnShip('helm');
        wish = helm.clone().sub(this.pos).setY(0).normalize().multiplyScalar(6);
      } else {
        this.pos.copy(helm);
        this.yaw = ship.heading;
        this.autopilot(dt);
        this.steer = ship.rudder;
      }
      this.seaCombat();
    } else if (this.groundShip === ship && playerOnShip) {
      // Hang out at the bow, slashing at anything that comes close.
      const bow = ship.toWorld(new THREE.Vector3(1.4, 0, ship.dims.L / 2 - 6));
      if (this.pos.distanceTo(bow) > 1.5 && !this.action) wish = bow.sub(this.pos).setY(0).normalize().multiplyScalar(4);
      else if (!this.action) this.yaw = dampAngle(this.yaw, ship.heading, 3, dt);
      this.seaCombat();
      if (ship.rudderInput === 0 && !ctx.game.kaitoSteering && player.mode !== 'helm') ship.rudderInput = 0;
    } else {
      wish = this.landAI(dt);
    }

    this.physics(dt, wish, false);
    this.tickAction(dt);
    this.animate(dt);
  }

  private seaCombat() {
    if (this.slashCd > 0 || this.action) return;
    const t = ctx.combat.nearest('player', this.pos, 110, undefined, Math.PI, (x) => x.kind === 'ship' || x.kind === 'monster' || x.kind === 'humanoid' || x.kind === 'boss');
    if (!t) return;
    this.slashCd = 2.4;
    const c = t.center(new THREE.Vector3());
    const wasYaw = this.yaw;
    this.faceTowards(c, 0);
    this.play('atkSlash', Math.random() < 0.5 ? 'slashR' : 'slashL', 0.5, [[0.45, () => {
      const from = this.pos.clone().add(new THREE.Vector3(0, 1.3, 0));
      const dir = t.center(new THREE.Vector3()).sub(from).normalize();
      ctx.projectiles.spawn({ kind: 'slash', pos: from, vel: dir.multiplyScalar(75), radius: 1.6, scale: 1.4, life: 2.5, color: 0xbfffe8, info: { amount: Math.round(38 * this.dmgMult), from, team: 'player', element: 'slash', source: 'companion', knockback: 3, shipDamageMult: 1.2 } });
      ctx.audio.sfx('slash', from, 1);
    }]], false, () => { if (this.mode !== 'land') this.yaw = wasYaw; });
    this.bark(BARKS_SEA, 0.25);
  }

  /** Steer the ship along the Log Pose, around islands, into the next berth. */
  private autopilot(dt: number) {
    const ship = ctx.ship;
    const dest = ISLANDS[Math.min(ctx.progress.nextIsland, ISLANDS.length - 1)];
    const isl = ctx.world.islands[dest.id];
    const dock = isl.shipPark;
    const outward = new THREE.Vector3(Math.cos(isl.dockDir), 0, Math.sin(isl.dockDir));
    const approach = dock.clone().addScaledVector(outward, 150);
    const toDock = Math.hypot(dock.x - ship.pos.x, dock.z - ship.pos.z);
    const toApproach = Math.hypot(approach.x - ship.pos.x, approach.z - ship.pos.z);
    let goal: THREE.Vector3;
    // Final approach once we're in front of the pier.
    const inFront = new THREE.Vector3(ship.pos.x - dock.x, 0, ship.pos.z - dock.z).dot(outward) > 20;
    if (toDock < 190 && inFront) goal = dock;
    else goal = approach;
    this.repathTimer -= dt;
    if (this.repathTimer <= 0) {
      this.repathTimer = 1;
      this.waypoint = this.routeAround(ship.pos, goal, dest.id);
    }
    const aim = this.waypoint ?? goal;
    const desired = Math.atan2(aim.x - ship.pos.x, aim.z - ship.pos.z);
    const diff = angleDiff(ship.heading, desired);
    ship.rudderInput = clamp(-diff * 2.2, -1, 1);
    ship.anchored = false;
    if (goal === dock) {
      ship.sail = toDock < 60 ? 1 : 2;
      if (toDock < 34) ctx.game.dock(isl);
    } else {
      ship.sail = Math.abs(diff) > 1.2 ? 2 : 3;
      if (toApproach < 40 && !inFront) this.repathTimer = 0;
    }
  }

  private routeAround(from: THREE.Vector3, to: THREE.Vector3, destId: number): THREE.Vector3 | null {
    const d = to.clone().sub(from).setY(0);
    const len = d.length();
    if (len < 1) return null;
    const dir = d.clone().divideScalar(len);
    for (const isl of ctx.world.islands) {
      const c = new THREE.Vector3(isl.cx, 0, isl.cz);
      const rb = isl.R * 1.32 + 50;
      const t = clamp(c.clone().sub(from).dot(dir), 0, len);
      const closest = from.clone().addScaledVector(dir, t);
      const dist = closest.distanceTo(c);
      if (dist < rb && !(isl.def.id === destId && from.distanceTo(c) < rb * 0.9)) {
        const n = new THREE.Vector3(-dir.z, 0, dir.x);
        const side = closest.clone().sub(c).dot(n) >= 0 ? 1 : -1;
        return c.clone().addScaledVector(n, side * (rb + 80));
      }
    }
    return null;
  }

  private landAI(dt: number): THREE.Vector3 {
    const player = ctx.player;
    // Pick a fight near the captain.
    if (!this.target || !this.target.alive || this.target.center(new THREE.Vector3()).distanceTo(player.pos) > 35) {
      this.target = ctx.combat.nearest('player', player.pos, 26, undefined, Math.PI, (t) => t.kind !== 'ship');
    }
    const wish = new THREE.Vector3();
    if (this.target) {
      const c = this.target.center(new THREE.Vector3());
      const d = Math.hypot(c.x - this.pos.x, c.z - this.pos.z) - this.target.radius;
      if (!this.action) this.faceTowards(c, dt, 10);
      if (d > 2.2) {
        if (d > 9 && d < 22 && this.slashCd <= 0 && !this.action) {
          this.slashCd = 3.5;
          this.play('atkFly', 'slashR', 0.5, [[0.45, () => {
            const from = this.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
            const dir = c.clone().sub(from).normalize();
            ctx.projectiles.spawn({ kind: 'slash', pos: from, vel: dir.multiplyScalar(55), radius: 1.3, scale: 1, life: 1.2, info: { amount: Math.round(26 * this.dmgMult), from, team: 'player', element: 'slash', source: 'companion', knockback: 4 } });
            ctx.audio.sfx('slash', from);
          }]]);
        }
        if (!this.action?.lockMove) wish.copy(c).sub(this.pos).setY(0).normalize().multiplyScalar(7.5);
      } else if (this.attackCd <= 0 && !this.action) {
        this.attackCd = 0.55;
        const k = this.combo++ % 4;
        const anim = ['slashR', 'slashL', 'slashDown', 'spin'][k];
        this.play('atkK' + k, anim, k === 3 ? 0.7 : 0.45, [[0.45, () => {
          const fwd = this.facing();
          const o = this.pos.clone().add(new THREE.Vector3(0, 1, 0));
          const hits = k === 3
            ? ctx.combat.sphere(o, 3.4, { amount: Math.round(24 * this.dmgMult), from: this.pos.clone(), team: 'player', element: 'slash', source: 'companion', knockback: 8 })
            : ctx.combat.cone(o, fwd, 3, 1.0, { amount: Math.round(18 * this.dmgMult), from: this.pos.clone(), team: 'player', element: 'slash', source: 'companion', knockback: 3, stun: 0.3 });
          ctx.fx.slash(o, this.yaw, 0xbfffe8, k === 3 ? 3.4 : 2.6, k === 2 ? 1.2 : k === 1 ? 0.3 : -0.3, 0.2, k === 3 ? Math.PI * 2 : Math.PI * 0.9);
          ctx.audio.sfx(hits.length ? 'clang' : 'slash', o, 0.7);
        }]]);
        this.bark(BARKS_FIGHT, 0.12);
      }
    } else {
      // Follow at the captain's shoulder.
      const side = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
      const spot = player.pos.clone().addScaledVector(side, 2.2).addScaledVector(player.facing(), -1.8);
      const d = spot.distanceTo(this.pos);
      if (d > 1.5) wish.copy(spot).sub(this.pos).setY(0).normalize().multiplyScalar(d > 8 ? 10 : 6);
      if (wish.lengthSq() > 0.1) this.yaw = dampAngle(this.yaw, Math.atan2(wish.x, wish.z), 10, dt);
    }
    return wish;
  }
}
