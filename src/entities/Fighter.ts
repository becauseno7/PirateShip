// Base class for anything that walks and fights: physics on terrain and
// ship decks, knockback, status effects, timed actions and rig animation.
import * as THREE from 'three';
import { ctx } from '../game/ctx';
import { Humanoid, RigLook, type CharRig } from './Humanoid';
import type { Ship } from './Ship';
import type { DamageInfo, Target, Team } from '../combat/Combat';
import { clamp, damp, dampAngle, rand } from '../core/math';

export interface ActionEvent { t: number; fn: () => void; done?: boolean }
export interface Action { name: string; anim: string; t: number; dur: number; events: ActionEvent[]; lockMove: boolean; onEnd?: () => void }

const GRAVITY = 30;

export class Fighter implements Target {
  rig: CharRig;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  knock = new THREE.Vector3();
  yaw = 0;
  grounded = false;
  groundShip: Ship | null = null;
  hp = 100;
  hpMax = 100;
  team: Team;
  kind: Target['kind'];
  radius: number;
  height: number;
  alive = true;
  action: Action | null = null;
  stun = 0;
  freeze = 0;
  burn = 0;
  private burnTick = 0;
  inWater = false;
  moveSpeed = 0;
  scale: number;
  invuln = 0;
  superArmor = false;
  poise = 0; // hits needed before flinching
  active = true;
  untargetable = false;
  lastGroundH = 0;
  private stepTimer = 0;
  private landed = true;
  turnInput = 0;
  steer: number | null = null;
  deathTime = 0;

  constructor(look: RigLook, team: Team, kind: Target['kind']) {
    this.rig = new Humanoid(look);
    this.team = team;
    this.kind = kind;
    this.scale = look.height ?? 1;
    this.radius = 0.45 * this.scale;
    this.height = 1.8 * this.scale;
    ctx.scene.add(this.rig.root);
  }

  center(out: THREE.Vector3) { return out.copy(this.pos).setY(this.pos.y + this.height * 0.55); }

  hitTest(p: THREE.Vector3, r: number) {
    if (!this.alive) return false;
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    if (dx * dx + dz * dz > (r + this.radius) * (r + this.radius)) return false;
    return p.y > this.pos.y - r - 0.2 && p.y < this.pos.y + this.height + r;
  }

  takeDamage(info: DamageInfo) {
    if (!this.alive || this.invuln > 0) return;
    this.hp -= info.amount;
    this.rig.flash(info.element === 'fire' ? 0xff6a20 : info.element === 'ice' ? 0x9fe6ff : info.element === 'thunder' ? 0xfff27a : 0xffffff);
    const dir = this.pos.clone().sub(info.from).setY(0);
    if (dir.lengthSq() < 1e-4) dir.set(rand(-1, 1), 0, rand(-1, 1));
    dir.normalize();
    const resist = this.superArmor ? 0.15 : 1;
    if (info.knockback) this.knock.addScaledVector(dir, info.knockback * resist * 3);
    if (info.launch && !this.superArmor) { this.vel.y = Math.max(this.vel.y, info.launch); this.grounded = false; }
    if (info.stun && !this.superArmor) this.stun = Math.max(this.stun, info.stun);
    if (info.freeze) { this.freeze = Math.max(this.freeze, info.freeze * (this.superArmor ? 0.3 : 1)); this.rig.setTint(0x3a8ac8); }
    if (info.burn) this.burn = Math.max(this.burn, info.burn);
    if (!this.superArmor && this.poise <= 0 && this.hp > 0) this.flinch();
    ctx.audio.sfx('hit', this.pos, 0.7);
    if (this.hp <= 0) { this.hp = 0; this.die(info); }
  }

  flinch() {
    if (this.action && this.action.name.startsWith('atk')) this.action = null;
    if (!this.action) this.play('hit', 'hit', 0.35, [], false);
  }

  die(_info?: DamageInfo) {
    this.alive = false;
    this.action = null;
    this.deathTime = 0;
  }

  play(name: string, anim: string, dur: number, events: [number, () => void][] = [], lockMove = true, onEnd?: () => void) {
    this.action = { name, anim, t: 0, dur, events: events.map(([t, fn]) => ({ t, fn })), lockMove, onEnd };
  }

  get busy() { return !!this.action && this.action.lockMove; }

  facing(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  faceTowards(p: THREE.Vector3, dt: number, rate = 12) {
    const a = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
    this.yaw = dt > 0 ? dampAngle(this.yaw, a, rate, dt) : a;
  }

  /** Integrate physics: desired horizontal velocity in world space. */
  physics(dt: number, wish: THREE.Vector3, jump = false) {
    // Ride the deck we stand on.
    if (this.groundShip && this.grounded) {
      this.pos.applyMatrix4(this.groundShip.delta);
      this.yaw += this.groundShip.deltaYaw;
    }
    const frozen = this.freeze > 0;
    const stunned = this.stun > 0 || frozen;
    if (stunned || !this.alive) wish.set(0, 0, 0);
    const accel = this.grounded ? 14 : 4;
    this.vel.x = damp(this.vel.x, wish.x, accel, dt);
    this.vel.z = damp(this.vel.z, wish.z, accel, dt);
    if (jump && this.grounded && !stunned) { this.vel.y = 11; this.grounded = false; ctx.audio.sfx('jump', this.pos); }
    this.vel.y -= GRAVITY * dt;
    this.pos.x += (this.vel.x + this.knock.x) * dt;
    this.pos.z += (this.vel.z + this.knock.z) * dt;
    this.pos.y += this.vel.y * dt;
    this.knock.multiplyScalar(Math.exp(-6 * dt));

    // Static collisions.
    if (this.groundShip) this.groundShip.collideOnDeck(this.pos, this.radius);
    else ctx.world.collide(this.pos, this.radius);

    const g = ctx.world.groundAt(this.pos.x, this.pos.z, this.pos.y);
    const water = ctx.ocean.heightAt(this.pos.x, this.pos.z);
    const wasGrounded = this.grounded;
    if (this.pos.y <= g.h + 0.02 && this.vel.y <= 0.01) {
      // Step up gently onto higher ground; snap down onto lower ground if close.
      this.pos.y = g.h;
      this.vel.y = 0;
      this.grounded = true;
      this.groundShip = g.ship;
    } else if (wasGrounded && this.vel.y <= 0 && this.pos.y - g.h < 0.6 && g.h > water - 0.3) {
      this.pos.y = g.h;
      this.vel.y = 0;
      this.grounded = true;
      this.groundShip = g.ship;
    } else {
      this.grounded = false;
    }
    // Rails: keep deck walkers aboard.
    if (this.grounded && this.groundShip) {
      if (this.groundShip.clampToDeck(this.pos)) {
        const ng = this.groundShip.deckHeightAtWorld(this.pos.x, this.pos.z);
        if (ng !== null) this.pos.y = ng;
      }
    } else if (!this.grounded && wasGrounded && this.groundShip && this.vel.y <= 0) {
      // Walked off a deck edge while not jumping: keep aboard.
      this.groundShip.clampToDeck(this.pos);
    }
    if (!this.grounded && this.groundShip && this.groundShip.deckHeightAtWorld(this.pos.x, this.pos.z) === null && this.pos.y < g.h + 3) {
      // Airborne beyond the rails; we're no longer on that ship.
      this.groundShip = null;
    }
    if (this.grounded && !wasGrounded && !this.landed) { ctx.audio.sfx('land', this.pos); }
    this.landed = this.grounded;
    this.lastGroundH = g.h;
    this.inWater = g.h < water - 0.5 && this.pos.y < water - 0.4 && !g.ship;

    // Status ticks.
    if (this.freeze > 0) { this.freeze -= dt; if (this.freeze <= 0) this.rig.setTint(null); }
    if (this.stun > 0) this.stun -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.burn > 0 && this.alive) {
      this.burn -= dt;
      this.burnTick -= dt;
      if (Math.random() < dt * 20) ctx.particles.emit({ pos: this.pos.clone().add(new THREE.Vector3(rand(-0.4, 0.4), rand(0.3, this.height), rand(-0.4, 0.4))), vel: new THREE.Vector3(0, 2, 0), life: 0.5, size: 0.5, sizeEnd: 0.05, color: 0xffb040, colorEnd: 0xff2000, additive: true });
      if (this.burnTick <= 0) { this.burnTick = 0.5; this.hp -= 4; if (this.hp <= 0 && this.alive) { this.hp = 0; this.die(); } }
    }

    // Footsteps.
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.moveSpeed = hs;
    if (this.grounded && hs > 1.5) {
      this.stepTimer -= dt * hs;
      if (this.stepTimer <= 0) {
        this.stepTimer = 2.4;
        if (this.kind === 'player') ctx.audio.sfx('step', this.pos);
        if (hs > 6 && !this.groundShip && Math.random() < 0.5) ctx.particles.emit({ pos: this.pos.clone().add(new THREE.Vector3(0, 0.1, 0)), vel: new THREE.Vector3(rand(-0.5, 0.5), 0.6, rand(-0.5, 0.5)), life: 0.6, size: 0.4, sizeEnd: 1.0, color: 0xc8b898, alpha: 0.35 });
      }
    }
  }

  tickAction(dt: number) {
    const a = this.action;
    if (!a) return;
    const frozen = this.freeze > 0;
    if (frozen) return;
    a.t += dt;
    const nt = a.t / a.dur;
    for (const e of a.events) if (!e.done && nt >= e.t) { e.done = true; e.fn(); }
    if (a.t >= a.dur) { this.action = null; a.onEnd?.(); }
  }

  animate(dt: number) {
    const a = this.action;
    const frozen = this.freeze > 0;
    const rdt = frozen ? 0 : dt;
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
    this.rig.update(rdt, {
      speed: this.moveSpeed,
      grounded: this.grounded,
      vy: this.vel.y,
      action: a ? a.anim : null,
      actionT: a ? a.t / a.dur : 0,
      dead: !this.alive,
      stun: this.stun > 0 && !a,
      steer: this.steer,
      turn: this.turnInput,
    });
  }

  setVisible(v: boolean) { this.rig.root.visible = v; }

  dispose() {
    ctx.scene.remove(this.rig.root);
    ctx.combat.unregister(this);
    this.rig.dispose();
  }
}
