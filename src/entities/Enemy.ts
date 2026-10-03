// Island and boarding-party foot soldiers: brutes, gunners and heavies, each
// dressed in their faction's colors, with simple but readable AI.
import * as THREE from 'three';
import { ctx } from '../game/ctx';
import { Fighter } from './Fighter';
import type { RigLook } from './Humanoid';
import type { IslandStyle } from '../game/data';
import type { DamageInfo } from '../combat/Combat';
import { clamp, dampAngle, pick, rand } from '../core/math';

export type EnemyType = 'brute' | 'gunner' | 'heavy';

export function factionLook(style: IslandStyle | 'pirate' | 'navy', type: EnemyType): RigLook {
  const skins = ['#f1c59b', '#d9a066', '#a8714a', '#7a4a2a', '#e8b890'];
  const skin = pick(skins);
  const hair = pick(['#1d1a1a', '#5a3a1e', '#a8702a', '#3a3a3a', '#c8c0b0']);
  const w: Record<EnemyType, RigLook['weapon']> = { brute: 'cutlass', gunner: 'musket', heavy: 'axe' };
  const base: RigLook = { skin, hair, hairStyle: pick(['messy', 'bald', 'spiky', 'topknot'] as const), shirt: '#888', pants: '#333', hat: 'none', weapon: w[type], build: type === 'heavy' ? 1.5 : 1, height: type === 'heavy' ? 1.35 : rand(0.95, 1.05), belly: type === 'heavy' ? 0.5 : 0 };
  switch (style) {
    case 'tropical':
    case 'pirate':
      return { ...base, shirt: pick(['#c8282b', '#e8e2d4', '#2a5a8a']), pants: pick(['#3a2a1e', '#2a2a3a']), hat: type === 'gunner' ? 'tricorn' : 'bandana', hatColor: type === 'gunner' ? '#222' : '#b8322a', sash: '#d8b04a', beard: Math.random() < 0.4 ? hair : undefined, weapon: type === 'heavy' ? 'anchor' : base.weapon };
    case 'volcano':
      return { ...base, shirt: '#3a3230', pants: '#2a2422', hat: 'helmet', hatColor: '#4a4040', armor: '#5a4a44', eyeGlow: 0xff7a20, weaponColor: 0xff8a40 };
    case 'snow':
      return { ...base, shirt: pick(['#8a6a4a', '#e8e4dc']), pants: '#5a4a3a', hat: 'hood', hatColor: '#f0ece4', beard: Math.random() < 0.6 ? '#d8c8a8' : undefined, weaponColor: 0xbfe8ff, weapon: type === 'brute' ? 'axe' : base.weapon };
    case 'fortress':
      return { ...base, shirt: '#5a1a1a', pants: '#1e1a1a', hat: 'horns', armor: '#3a3a3a', weapon: type === 'heavy' ? 'kanabo' : base.weapon, eyeGlow: 0xffd040 };
    case 'desert':
      return { ...base, shirt: '#f0e6d0', pants: '#c8a868', hat: 'turban', hatColor: pick(['#2a6ab8', '#b82a4a', '#f4f0e8']), sash: '#b8322a', weapon: type === 'brute' ? 'scimitar2' : base.weapon };
    case 'final':
    case 'navy':
      return { ...base, shirt: '#f4f4f4', pants: '#1a2a5a', hat: 'navy', cape: type === 'heavy' ? '#f4f4f4' : undefined, weapon: type === 'heavy' ? 'spear' : base.weapon, weaponColor: style === 'final' ? 0xffd54a : 0xd8dde4 };
    default:
      return base;
  }
}

export class Enemy extends Fighter {
  type: EnemyType;
  spawn: THREE.Vector3;
  aggro = false;
  attackCd = rand(0.5, 1.5);
  level: number;
  dmg: number;
  wanderT = rand(1, 4);
  wanderTarget: THREE.Vector3 | null = null;
  removeTimer = 0;
  rewarded = false;
  onDeath: ((e: Enemy) => void) | null = null;
  private strafe = Math.random() < 0.5 ? 1 : -1;
  leashed = true;
  name = '';

  constructor(look: RigLook, type: EnemyType, level: number, spawn: THREE.Vector3) {
    super({ ...look, outline: false }, 'enemy', 'humanoid');
    this.type = type;
    this.level = level;
    this.spawn = spawn.clone();
    const hpBase = { brute: 70, gunner: 55, heavy: 190 }[type];
    this.hpMax = Math.round(hpBase * (1 + level * 0.65));
    this.hp = this.hpMax;
    this.dmg = { brute: 11, gunner: 9, heavy: 22 }[type] * (1 + level * 0.32);
    this.poise = type === 'heavy' ? 1 : 0;
    this.superArmor = type === 'heavy';
    this.pos.copy(spawn);
    this.yaw = rand(0, Math.PI * 2);
    ctx.combat.register(this);
  }

  takeDamage(info: DamageInfo) {
    super.takeDamage(info);
    this.aggro = true;
  }

  die(info?: DamageInfo) {
    super.die(info);
    ctx.audio.sfx('hurt', this.pos, 0.6);
    this.onDeath?.(this);
  }

  private pickTarget() {
    const p = ctx.player, k = ctx.companion;
    const dp = p.alive ? p.pos.distanceTo(this.pos) : Infinity;
    const dk = k.downed <= 0 && k.alive && !k.untargetable ? k.pos.distanceTo(this.pos) * 1.3 : Infinity;
    return dp <= dk ? p : k;
  }

  update(dt: number) {
    if (!this.alive) {
      this.removeTimer += dt;
      this.physics(dt, new THREE.Vector3());
      this.animate(dt);
      if (this.removeTimer > 2.5) this.rig.root.position.y -= (this.removeTimer - 2.5) * 0.8;
      return;
    }
    this.attackCd = Math.max(0, this.attackCd - dt);
    const tgt = this.pickTarget();
    const tpos = tgt.pos;
    const dist = Math.hypot(tpos.x - this.pos.x, tpos.z - this.pos.z);
    const playerTargetable = ctx.player.alive && ctx.player.mode !== 'locked';
    if (!this.aggro && dist < (this.type === 'gunner' ? 30 : 22) && playerTargetable) { this.aggro = true; ctx.audio.sfx('hit', this.pos, 0.2); }
    if (this.aggro && this.leashed && this.pos.distanceTo(this.spawn) > 70) this.aggro = false;
    if (!playerTargetable) this.aggro = false;

    const wish = new THREE.Vector3();
    if (this.aggro) {
      if (!this.action) this.faceTowards(tpos, dt, 8);
      if (this.type === 'gunner') {
        if (dist < 9) wish.copy(this.pos).sub(tpos).setY(0).normalize().multiplyScalar(4.5);
        else if (dist > 22) wish.copy(tpos).sub(this.pos).setY(0).normalize().multiplyScalar(5);
        else wish.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(this.strafe * 2.5);
        if (this.attackCd <= 0 && dist < 32 && !this.action) {
          this.attackCd = rand(2.4, 3.4);
          const aimLine = ctx.fx.telegraphRect(this.pos.clone(), this.yaw, Math.min(dist, 30), 0.35, 0.75, 0xff6a3a);
          this.play('atkShoot', 'shoot', 1.0, [[0.72, () => {
            ctx.fx.removeTelegraph(aimLine);
            const from = this.rig.worldPos('haR').add(this.facing().multiplyScalar(1.1));
            const aim = tgt.center(new THREE.Vector3()).add(new THREE.Vector3(rand(-0.6, 0.6), rand(-0.3, 0.3), rand(-0.6, 0.6)));
            const vel = aim.sub(from).normalize().multiplyScalar(70);
            ctx.projectiles.spawn({ kind: 'musket', pos: from, vel, radius: 0.45, life: 1.2, info: { amount: Math.round(this.dmg), from, team: 'enemy', source: 'enemy', element: 'physical', knockback: 2 } });
            ctx.particles.burst(from, 6, { speed: 3, life: 0.5, size: 0.5, sizeEnd: 1.2, color: 0xcccccc, alpha: 0.5 });
            ctx.audio.sfx('musket', from, 0.8);
          }]]);
        }
      } else {
        const reach = this.type === 'heavy' ? 3.4 : 2.1;
        if (dist > reach && !this.action?.lockMove) wish.copy(tpos).sub(this.pos).setY(0).normalize().multiplyScalar(this.type === 'heavy' ? 4.2 : 5.8);
        if (dist <= reach + 0.6 && this.attackCd <= 0 && !this.action) {
          this.attackCd = this.type === 'heavy' ? rand(2.4, 3.2) : rand(1.3, 2.0);
          if (this.type === 'heavy') {
            const at = this.pos.clone().addScaledVector(this.facing(), 2.6);
            const tg = ctx.fx.telegraphCircle(at, 3.6, 0.85);
            this.play('atkSlam', 'slashDown', 1.2, [[0.62, () => {
              ctx.fx.removeTelegraph(tg);
              ctx.combat.sphere(at.clone().add(new THREE.Vector3(0, 1, 0)), 3.6, { amount: Math.round(this.dmg), from: this.pos.clone(), team: 'enemy', source: 'enemy', knockback: 9, launch: 6 });
              ctx.fx.shockwave(at.clone().setY(at.y + 0.2), 4.5, 0xd8c8a8, 0.4);
              ctx.particles.burst(at, 16, { speed: 6, up: 3, life: 0.7, size: 0.6, sizeEnd: 0.1, color: 0x8a7a68, gravity: 12 });
              ctx.audio.sfx('quake', at, 0.5);
              ctx.fx.shake(0.3);
            }]]);
          } else {
            const anim = Math.random() < 0.5 ? 'slashR' : 'slashL';
            this.play('atkSlash', anim, 0.75, [[0.5, () => {
              const o = this.pos.clone().add(new THREE.Vector3(0, 1, 0));
              const hits = ctx.combat.cone(o, this.facing(), reach + 0.6, 0.9, { amount: Math.round(this.dmg), from: this.pos.clone(), team: 'enemy', source: 'enemy', knockback: 3 });
              ctx.fx.slash(o, this.yaw, 0xffd0c0, 2.2, anim === 'slashR' ? -0.3 : 0.3, 0.16);
              ctx.audio.sfx(hits.length ? 'clang' : 'slash', o, 0.6);
            }]]);
          }
        }
      }
    } else {
      // Idle wandering around the camp.
      this.wanderT -= dt;
      if (this.wanderT <= 0) {
        this.wanderT = rand(2.5, 6);
        this.wanderTarget = Math.random() < 0.6 ? this.spawn.clone().add(new THREE.Vector3(rand(-7, 7), 0, rand(-7, 7))) : null;
      }
      if (this.wanderTarget && this.wanderTarget.distanceTo(this.pos) > 1) {
        wish.copy(this.wanderTarget).sub(this.pos).setY(0).normalize().multiplyScalar(1.6);
        this.yaw = dampAngle(this.yaw, Math.atan2(wish.x, wish.z), 5, dt);
      }
    }
    this.physics(dt, wish);
    this.tickAction(dt);
    this.animate(dt);
    if (this.inWater && this.alive) { this.hp = 0; this.die(); ctx.fx.splash(this.pos, 1); }
  }
}
