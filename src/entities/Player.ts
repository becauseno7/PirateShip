// The captain: on-foot controller with combos, dodge and devil fruit powers,
// helm control of the ship, drowning (fruit users sink!) and awakening.
import * as THREE from 'three';
import { ctx } from '../game/ctx';
import { Fighter } from './Fighter';
import { FRUITS, FruitId } from '../game/data';
import { Look, damageMult, maxHpFor } from '../game/state';
import { basicHit, castAbility } from '../combat/Fruits';
import type { DamageInfo, Target } from '../combat/Combat';
import { clamp, damp, dampAngle, rand, lerp } from '../core/math';
import { Humanoid, RigLook } from './Humanoid';

export function lookToRig(l: Look, outline = true): RigLook {
  return {
    skin: l.skin, hair: l.hair, hairStyle: l.hairStyle, shirt: l.shirt, pants: l.pants, hat: l.hat, hatColor: l.hatColor,
    scar: l.scar, vest: true, sash: l.hat === 'straw' ? undefined : '#e8c45a', outline, shoes: l.hat === 'straw' ? '#a8703a' : '#3a2a1e',
  };
}

export type PlayerMode = 'foot' | 'helm' | 'locked' | 'drown';

export class Player extends Fighter {
  look: Look;
  fruit: FruitId;
  energy = 100;
  energyMax = 100;
  ult = 0;
  cds = [0, 0, 0, 0];
  combo = 0;
  comboTimer = 0;
  queuedAttack = false;
  dodgeCd = 0;
  mode: PlayerMode = 'foot';
  titan = 0;
  private titanScale = 1;
  private dashVel = new THREE.Vector3();
  private dashT = 0;
  private leap: { from: THREE.Vector3; to: THREE.Vector3; peak: number; t: number; dur: number; onLand: () => void } | null = null;
  private drownT = 0;
  awakened = false;
  combatTimer = 0;
  sprinting = false;
  private auraTimer = 0;

  constructor(look: Look, fruit: FruitId) {
    super(lookToRig(look), 'player', 'player');
    this.look = look;
    this.fruit = fruit;
    this.hpMax = maxHpFor(ctx.progress.level);
    this.hp = this.hpMax;
    ctx.combat.register(this);
  }

  get damageMult() { return damageMult(ctx.progress.level) * (this.awakened ? 1.6 : 1); }

  setAwakened(on: boolean) {
    this.awakened = on;
    const def = FRUITS[this.fruit];
    if (on) {
      this.rig.setAura(def.awakenColor);
      if (this.fruit === 'stretch') this.rig.setHairColor(0xffffff);
      this.rig.setEyeGlow(def.awakenColor);
    } else {
      this.rig.setAura(null);
    }
  }

  rebuildLook(look: Look) {
    const old = this.rig;
    this.look = look;
    ctx.scene.remove(old.root);
    this.rig = new Humanoid(lookToRig(look));
    ctx.scene.add(this.rig.root);
    this.setAwakened(this.awakened);
  }

  onDealtDamage(amount: number) {
    this.combatTimer = 5;
    if (this.awakened) this.ult = Math.min(100, this.ult + amount * 0.045);
  }

  takeDamage(info: DamageInfo) {
    if (!this.alive || this.invuln > 0 || this.mode === 'locked') return;
    const lethal = this.hp - info.amount <= 0;
    if (lethal && ctx.game.onPlayerLethal()) { this.hp = 1; return; }
    super.takeDamage(info);
    this.combatTimer = 5;
    ctx.ui.hurtVignette();
    ctx.fx.shake(Math.min(1, info.amount / 40));
    if (this.mode === 'helm' && info.amount > 0) { /* stay at helm */ }
  }

  die(info?: DamageInfo) {
    super.die(info);
    this.mode = 'foot';
    ctx.game.onPlayerDeath();
  }

  autoTarget(range: number): Target | null {
    const dir = ctx.cam.flatForward(new THREE.Vector3());
    return ctx.combat.nearest('player', this.pos, range, dir, 0.55) || null;
  }

  aimDirection(target: Target | null) {
    if (target) {
      const c = target.center(new THREE.Vector3());
      return c.sub(this.pos.clone().add(new THREE.Vector3(0, 1.2 * this.scale, 0))).normalize();
    }
    const d = ctx.cam.aimDir(new THREE.Vector3());
    d.y = clamp(d.y + 0.08, -0.4, 0.5);
    return d.normalize();
  }

  faceDir(d: THREE.Vector3) { this.yaw = Math.atan2(d.x, d.z); }

  teleport(p: THREE.Vector3) {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.groundShip = null;
  }

  dash(dir: THREE.Vector3, speed: number, dur: number) {
    this.dashVel.copy(dir).multiplyScalar(speed);
    this.dashT = dur;
  }

  leapTo(from: THREE.Vector3, to: THREE.Vector3, peak: number, dur: number, onLand: () => void) {
    this.leap = { from: from.clone(), to: to.clone(), peak, t: 0, dur, onLand };
    this.groundShip = null;
  }

  get atHelm() { return this.mode === 'helm'; }

  enterHelm() {
    if (!ctx.ship.alive) return;
    this.mode = 'helm';
    ctx.game.kaitoSteering = false;
    ctx.cam.setMode('ship');
    ctx.ui.toast('At the helm: W/S sails, A/D steer, Click fires cannons, Shift for Gale Burst');
  }
  leaveHelm() {
    this.mode = 'foot';
    this.steer = null;
    const p = ctx.ship.toWorld(new THREE.Vector3(0, 0, -ctx.ship.dims.L / 2 + 4.2));
    const h = ctx.ship.deckHeightAtWorld(p.x, p.z);
    this.pos.set(p.x, h ?? p.y, p.z);
    this.vel.set(0, 0, 0);
    this.groundShip = ctx.ship;
    this.grounded = true;
    ctx.cam.setMode('follow');
  }

  update(dt: number) {
    const inp = ctx.input;
    this.cds = this.cds.map((c) => Math.max(0, c - dt));
    this.dodgeCd = Math.max(0, this.dodgeCd - dt);
    this.combatTimer = Math.max(0, this.combatTimer - dt);
    this.energy = Math.min(this.energyMax, this.energy + dt * (this.combatTimer > 0 ? 11 : 22));
    if (this.alive && this.combatTimer <= 0 && this.hp < this.hpMax && this.mode !== 'drown') this.hp = Math.min(this.hpMax, this.hp + dt * this.hpMax * 0.02);
    this.updateTitan(dt);

    if (this.awakened) {
      this.auraTimer -= dt;
      if (this.auraTimer <= 0) {
        this.auraTimer = 0.05;
        const c = FRUITS[this.fruit].awakenColor;
        ctx.particles.emit({ pos: this.pos.clone().add(new THREE.Vector3(rand(-0.5, 0.5) * this.scale, rand(0, 1.8) * this.scale, rand(-0.5, 0.5) * this.scale)), vel: new THREE.Vector3(0, rand(1.5, 3.5), 0), life: 0.7, size: 0.35 * this.scale, sizeEnd: 0.02, color: c, additive: true });
      }
    }

    if (!this.alive) { this.physics(dt, new THREE.Vector3()); this.animate(dt); return; }

    if (this.mode === 'locked') {
      this.tickAction(dt);
      this.physics(dt, new THREE.Vector3());
      this.animate(dt);
      return;
    }
    if (this.mode === 'helm') { this.updateHelm(dt); return; }
    if (this.mode === 'drown') { this.updateDrown(dt); return; }

    // ---- Leap (scripted arc).
    if (this.leap) {
      const L = this.leap;
      L.t += dt;
      const k = Math.min(1, L.t / L.dur);
      this.pos.lerpVectors(L.from, L.to, k);
      this.pos.y += Math.sin(k * Math.PI) * L.peak;
      this.vel.set(0, 0, 0);
      this.grounded = false;
      this.faceTowards(L.to, dt, 20);
      if (k >= 1) {
        this.leap = null;
        const g = ctx.world.groundAt(this.pos.x, this.pos.z, this.pos.y + 1);
        this.pos.y = Math.max(g.h, this.pos.y);
        this.groundShip = g.ship;
        L.onLand();
      }
      this.tickAction(dt);
      this.animate(dt);
      return;
    }

    // ---- Movement.
    const fwd = ctx.cam.flatForward(new THREE.Vector3());
    const right = ctx.cam.flatRight(new THREE.Vector3());
    const ix = inp.axis('KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight');
    const iz = inp.axis('KeyS', 'KeyW', 'ArrowDown', 'ArrowUp');
    const wishDir = fwd.multiplyScalar(iz).add(right.multiplyScalar(ix));
    if (wishDir.lengthSq() > 1) wishDir.normalize();
    this.sprinting = inp.isDown('ShiftLeft') && wishDir.lengthSq() > 0.1;
    const base = this.titan > 0 ? 9 : 7;
    let speed = this.sprinting ? base * 1.55 : base;
    if (this.action?.lockMove) speed *= 0.12;
    const wish = wishDir.clone().multiplyScalar(speed);
    if (this.dashT > 0) {
      this.dashT -= dt;
      wish.copy(this.dashVel);
      this.vel.x = this.dashVel.x; this.vel.z = this.dashVel.z;
    }
    if (wishDir.lengthSq() > 0.01 && !this.action?.lockMove && this.dashT <= 0) {
      const a = Math.atan2(wishDir.x, wishDir.z);
      this.turnInput = Math.sign(Math.sin(a - this.yaw));
      this.yaw = dampAngle(this.yaw, a, 14, dt);
    } else this.turnInput = 0;

    // ---- Combat input.
    if (inp.pressed('Mouse0')) this.attack();
    if (this.comboTimer > 0) { this.comboTimer -= dt; if (this.comboTimer <= 0) this.combo = 0; }
    if (inp.pressed('Digit1')) this.ability(0);
    if (inp.pressed('Digit2')) this.ability(1);
    if (inp.pressed('Digit3')) this.ability(2);
    if (inp.pressed('Digit4') || inp.pressed('KeyV')) this.ability(3);
    if (inp.pressed('KeyQ') || inp.pressed('ControlLeft')) this.dodge(wishDir);

    this.physics(dt, wish, inp.pressed('Space'));
    this.tickAction(dt);
    this.animate(dt);

    // Queued combo continuation.
    if (this.queuedAttack && (!this.action || (this.action.name.startsWith('atkBasic') && this.action.t / this.action.dur > 0.55))) {
      this.queuedAttack = false;
      this.action = null;
      this.attack();
    }

    // Fruit users sink like a stone.
    if (this.inWater) this.startDrown();
    // Lava burns.
    if (this.grounded && !this.groundShip && ctx.world.isLava(this.pos.x, this.pos.z) && this.invuln <= 0) {
      if (Math.random() < dt * 4) ctx.combat.apply(this, { amount: 9, from: this.pos.clone(), team: 'enemy', element: 'fire', source: 'env' });
      this.burn = Math.max(this.burn, 0.5);
    }
  }

  private updateTitan(dt: number) {
    const target = this.titan > 0 ? 3.2 : 1;
    if (this.titan > 0) {
      this.titan -= dt;
      if (this.titan <= 0) { ctx.fx.sphere(this.pos.clone().add(new THREE.Vector3(0, 2, 0)), 6, 0xffffff, 0.4); ctx.audio.sfx('boing', this.pos); }
    }
    this.titanScale = damp(this.titanScale, target, 5, dt);
    this.scale = this.titanScale;
    this.rig.root.scale.setScalar(this.titanScale);
    this.radius = 0.45 * this.titanScale;
    this.height = 1.8 * this.titanScale;
    ctx.cam.heightOffset = 1.6 * this.titanScale;
    if (this.titan > 0) ctx.cam.distTarget = Math.max(ctx.cam.distTarget, 16);
  }

  attack() {
    if (this.action && !this.action.name.startsWith('atkBasic')) return;
    if (this.action) { this.queuedAttack = true; return; }
    if (this.stun > 0 || this.freeze > 0) return;
    const target = this.autoTarget(this.fruit === 'stretch' ? 7 : 4.5);
    if (target) {
      const c = target.center(new THREE.Vector3());
      this.yaw = Math.atan2(c.x - this.pos.x, c.z - this.pos.z);
      const d = Math.hypot(c.x - this.pos.x, c.z - this.pos.z) - target.radius;
      if (d > 1.5 && d < 4.5 && this.fruit !== 'stretch') this.dash(this.facing(), d * 5, 0.15);
    } else {
      const f = ctx.cam.flatForward(new THREE.Vector3());
      if (!ctx.input.isDown('KeyW') && !ctx.input.isDown('KeyA') && !ctx.input.isDown('KeyS') && !ctx.input.isDown('KeyD')) this.yaw = Math.atan2(f.x, f.z);
    }
    const idx = this.combo % 3;
    const anims = ['punchR', 'punchL', idx === 2 && this.fruit === 'quake' ? 'uppercut' : 'kick'];
    const dur = this.titan > 0 ? 0.5 : idx === 2 ? 0.48 : 0.34;
    this.play('atkBasic' + idx, anims[idx], dur, [[0.42, () => basicHit(this, idx)]], false);
    this.combo++;
    this.comboTimer = 0.8;
  }

  ability(slot: 0 | 1 | 2 | 3) {
    if (this.stun > 0 || this.freeze > 0) return;
    if (this.action && !this.action.name.startsWith('atkBasic') && this.action.name !== 'hit') return;
    const def = FRUITS[this.fruit];
    if (slot === 3) {
      if (!this.awakened) { ctx.ui.toast('Your fruit has not awakened yet...'); return; }
      if (this.ult < 100) { ctx.ui.toast('Ultimate is still charging'); return; }
      this.action = null;
      this.ult = 0;
      castAbility(this, 3);
      return;
    }
    const ab = def.abilities[slot];
    if (this.cds[slot] > 0) return;
    if (this.energy < ab.cost) { ctx.ui.toast('Not enough energy'); ctx.audio.sfx('uiback'); return; }
    this.action = null;
    if (castAbility(this, slot)) {
      this.energy -= ab.cost;
      this.cds[slot] = ab.cd * (this.awakened ? 0.7 : 1);
      this.combatTimer = 5;
    }
  }

  dodge(dir: THREE.Vector3) {
    if (this.dodgeCd > 0 || this.stun > 0 || this.freeze > 0) return;
    const d = dir.lengthSq() > 0.01 ? dir.clone().normalize() : this.facing().negate();
    this.action = null;
    this.dash(d, 24, 0.22);
    this.invuln = 0.35;
    this.dodgeCd = 0.75;
    this.yaw = Math.atan2(d.x, d.z);
    this.play('dodge', 'dash', 0.25, [], false);
    ctx.audio.sfx('dash', this.pos, 0.8);
    for (let i = 0; i < 8; i++) ctx.particles.emit({ pos: this.pos.clone().add(new THREE.Vector3(rand(-0.3, 0.3), rand(0.2, 1.5), rand(-0.3, 0.3))), vel: d.clone().multiplyScalar(-4), life: 0.35, size: 0.6, sizeEnd: 0.1, color: FRUITS[this.fruit].color, additive: true });
  }

  private startDrown() {
    this.mode = 'drown';
    this.drownT = 0;
    this.action = null;
    ctx.audio.sfx('splash', this.pos, 1.2);
    ctx.fx.splash(this.pos, 1.2);
    ctx.ui.toast('Devil fruit users can\'t swim! You\'re sinking...');
    ctx.ui.say('Kaito', 'Hang on, Captain! I\'ve got you!');
  }

  private updateDrown(dt: number) {
    this.drownT += dt;
    this.pos.y -= dt * 1.2;
    this.vel.set(0, 0, 0);
    if (Math.random() < dt * 25) ctx.particles.emit({ pos: this.pos.clone().add(new THREE.Vector3(rand(-0.4, 0.4), 1, rand(-0.4, 0.4))), vel: new THREE.Vector3(0, 3, 0), life: 0.6, size: 0.25, color: 0xe8f8ff, alpha: 0.8 });
    this.rig.root.position.copy(this.pos);
    this.rig.update(dt, { speed: 0, grounded: false, vy: -1, action: 'hit', actionT: 0.2 });
    if (this.drownT > 1.8) {
      this.mode = 'foot';
      ctx.game.rescuePlayer();
      ctx.combat.apply(this, { amount: Math.round(this.hpMax * 0.12), from: this.pos.clone(), team: 'enemy', source: 'env' });
    }
  }

  private updateHelm(dt: number) {
    const ship = ctx.ship;
    const inp = ctx.input;
    if (!ship.alive) { this.leaveHelm(); return; }
    if (inp.pressed('KeyW') || inp.pressed('ArrowUp')) { if (ship.docked) ctx.game.undock(); else ship.sail = Math.min(3, ship.sail + 1); ship.anchored = false; ctx.audio.sfx('creak'); }
    if (inp.pressed('KeyS') || inp.pressed('ArrowDown')) { ship.sail = Math.max(0, ship.sail - 1); ctx.audio.sfx('creak'); }
    ship.rudderInput = inp.axis('KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight');
    if (inp.pressed('ShiftLeft') && !ship.docked) {
      if (ctx.progress.cola > 0 && ship.burst <= 0) { ctx.progress.cola--; ship.gale(); ctx.ui.toast('GALE BURST!'); }
      else if (ship.burst <= 0) ctx.ui.toast('No Burst Cola left. Buy more from a shipwright.');
    }
    if (inp.pressed('Mouse0')) this.fireCannons();
    if (inp.pressed('Digit1')) this.ability(0);
    if (inp.pressed('Digit2')) this.ability(1);
    if (inp.pressed('Digit3')) this.ability(2);
    if (inp.pressed('Digit4') || inp.pressed('KeyV')) this.ability(3);
    // Stand at the wheel.
    const hp = ship.helmWorld(new THREE.Vector3());
    this.pos.copy(hp);
    this.yaw = ship.heading;
    this.groundShip = ship;
    this.grounded = true;
    this.vel.set(0, 0, 0);
    this.moveSpeed = 0;
    this.steer = ship.rudder;
    this.tickAction(dt);
    this.animate(dt);
  }

  fireCannons() {
    const ship = ctx.ship;
    if (ship.reload > 0) return;
    const camF = ctx.cam.flatForward(new THREE.Vector3());
    const side: 1 | -1 = camF.dot(ship.right) > 0 ? -1 : 1;
    const sideDir = ship.right.multiplyScalar(-side);
    const target = ctx.combat.nearest('player', ship.pos, 280, sideDir, 0.9, (t) => t.kind === 'ship' || t.kind === 'monster' || t.kind === 'boss');
    const mult = [1, 1.25, 1.6, 2.1][ctx.progress.upgrades.cannons] * (1 + (ctx.progress.level - 1) * 0.04);
    ship.fireBroadside(side, target ? target.center(new THREE.Vector3()) : null, 'player', mult);
  }
}
