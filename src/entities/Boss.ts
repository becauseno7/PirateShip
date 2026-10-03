// Island bosses: data-driven attack patterns built from telegraphed
// primitives (smash, sweep, charge, throw, rain, shockwave, beam, orbs...).
import * as THREE from 'three';
import { ctx } from '../game/ctx';
import { Fighter } from './Fighter';
import type { RigLook } from './Humanoid';
import type { BossId } from '../game/data';
import type { DamageInfo } from '../combat/Combat';
import { Enemy, factionLook } from './Enemy';
import { clamp, pick, rand, smoothstep } from '../core/math';
import { energyMaterial } from '../world/materials';

type Atk = 'smash' | 'sweep' | 'charge' | 'throw' | 'rain' | 'shockwave' | 'beam' | 'summon' | 'vortex' | 'teleport' | 'orbs' | 'lightning';

export interface BossDef {
  id: BossId;
  name: string;
  title: string;
  bounty: number;
  look: RigLook;
  hp: number;
  dmg: number;
  speed: number;
  color: number;
  color2: number;
  element: DamageInfo['element'];
  projectile: 'rock' | 'fireball' | 'water' | 'orb' | 'light' | 'cannon';
  attacks: Atk[];
  phase2: Atk[];
  phase3?: Atk[];
  intro: string;
  defeat: string;
  style: string;
}

export const BOSSES: Record<BossId, BossDef> = {
  barnacle: {
    id: 'barnacle', name: 'Captain Barnacle', title: '"The Iron Anchor"', bounty: 48_000_000, style: 'pirate',
    look: { skin: '#d9a066', hair: '#3a2a1a', hairStyle: 'bald', shirt: '#8a1a1a', pants: '#2a2018', hat: 'tricorn', hatColor: '#1a1414', beard: '#3a2a1a', build: 1.6, belly: 0.8, height: 1.8, weapon: 'anchor', weaponColor: 0x6a6e78, cape: '#5a0e0e', sash: '#d8b04a', outline: true },
    hp: 2400, dmg: 24, speed: 4.8, color: 0xff7a3a, color2: 0xd8c8a8, element: 'physical', projectile: 'cannon',
    attacks: ['smash', 'sweep', 'throw', 'charge'], phase2: ['smash', 'sweep', 'throw', 'charge', 'summon', 'rain'],
    intro: 'Har! Another brat chasin\' the Daybreak? I\'ll sink you where you stand!', defeat: 'Impossible... beaten by a rookie...',
  },
  kazan: {
    id: 'kazan', name: 'Admiral Kazan', title: '"Magma Fist"', bounty: 120_000_000, style: 'volcano',
    look: { skin: '#a8714a', hair: '#e8e4dc', hairStyle: 'spiky', shirt: '#2a2626', pants: '#1a1616', hat: 'none', armor: '#5a3a2a', cape: '#f4f4f4', build: 1.45, height: 1.7, eyeGlow: 0xff7a20, outline: true },
    hp: 3800, dmg: 30, speed: 5.4, color: 0xff5a10, color2: 0xffc040, element: 'fire', projectile: 'fireball',
    attacks: ['smash', 'throw', 'rain', 'charge'], phase2: ['smash', 'throw', 'rain', 'charge', 'shockwave', 'beam'],
    intro: 'The Navy called it justice. I call it heat. Let\'s see if you burn as easily as they did.', defeat: 'The fire... goes out...',
  },
  borr: {
    id: 'borr', name: 'Borr', title: '"The Frost Titan"', bounty: 260_000_000, style: 'snow',
    look: { skin: '#9ab8c8', hair: '#f4f8fb', hairStyle: 'wild', shirt: '#6a5a4a', pants: '#4a3a2e', hat: 'none', beard: '#f4f8fb', build: 1.3, belly: 0.4, height: 3.6, weapon: 'axe', weaponColor: 0xa8e8ff, eyeGlow: 0x8ae8ff, sash: '#8a6a4a', outline: true },
    hp: 5600, dmg: 38, speed: 5, color: 0x8ae8ff, color2: 0xffffff, element: 'ice', projectile: 'rock',
    attacks: ['smash', 'shockwave', 'throw', 'rain'], phase2: ['smash', 'shockwave', 'throw', 'rain', 'beam', 'sweep'],
    intro: 'Little sailor... the cold will keep you. Forever.', defeat: 'Warm... I had forgotten... warm...',
  },
  gorrath: {
    id: 'gorrath', name: 'Warlord Gorrath', title: '"The Calamity"', bounty: 2_100_000_000, style: 'fortress',
    look: { skin: '#c8906a', hair: '#1a1414', hairStyle: 'long', shirt: '#3a1a14', pants: '#1a1414', hat: 'horns', armor: '#2a2a2e', cape: '#6a1010', beard: '#1a1414', build: 1.5, height: 4.0, weapon: 'kanabo', weaponColor: 0x3a3a40, eyeGlow: 0xffd040, sash: '#b8322a', outline: true },
    hp: 16000, dmg: 62, speed: 6, color: 0xb070ff, color2: 0xfff27a, element: 'thunder', projectile: 'rock',
    attacks: ['smash', 'sweep', 'charge', 'shockwave', 'beam'], phase2: ['smash', 'sweep', 'charge', 'shockwave', 'beam', 'lightning'], phase3: ['smash', 'sweep', 'charge', 'shockwave', 'beam', 'lightning', 'summon'],
    intro: 'Another one who wants to die in an interesting way? Good. Entertain me.', defeat: 'Hah... HAHAHA! So THIS is the Dawn they feared! Go on, then... take the sea.',
  },
  zahra: {
    id: 'zahra', name: 'Sultana Zahra', title: '"The Mirage Queen"', bounty: 1_400_000_000, style: 'desert',
    look: { skin: '#b07a4a', hair: '#1a1414', hairStyle: 'long', shirt: '#2a8ab8', pants: '#f0e6d0', hat: 'crown', cape: '#d8b04a', build: 0.95, height: 1.5, weapon: 'scimitar2', weaponColor: 0xffe08a, sash: '#b8322a', outline: true },
    hp: 11000, dmg: 48, speed: 7.5, color: 0xffc860, color2: 0x2ad1c4, element: 'physical', projectile: 'orb',
    attacks: ['teleport', 'vortex', 'orbs', 'rain', 'charge'], phase2: ['teleport', 'vortex', 'orbs', 'rain', 'charge', 'summon'],
    intro: 'You crossed my desert. Bold. But nothing here is real, captain. Not even your hope.', defeat: 'The sands... are settling... how unbecoming.',
  },
  vexis: {
    id: 'vexis', name: 'Emperor Vexis', title: '"The Eternal Night"', bounty: 5_000_000_000, style: 'final',
    look: { skin: '#e8dcd0', hair: '#f4f4f4', hairStyle: 'long', shirt: '#14141e', pants: '#14141e', hat: 'crown', cape: '#1a1030', armor: '#d8b04a', build: 1.15, height: 2.0, weapon: 'spear', weaponColor: 0xffe08a, eyeGlow: 0xc070ff, outline: true },
    hp: 22000, dmg: 64, speed: 7, color: 0xc070ff, color2: 0xfff2a0, element: 'dark', projectile: 'orb',
    attacks: ['orbs', 'beam', 'teleport', 'sweep', 'rain'], phase2: ['orbs', 'beam', 'teleport', 'sweep', 'rain', 'shockwave', 'summon'], phase3: ['orbs', 'beam', 'teleport', 'sweep', 'rain', 'shockwave', 'charge', 'lightning'],
    intro: 'Two hundred years I have kept the dawn in chains. You think a pirate with a fruit will break them?', defeat: 'The light... I had forgotten how it burns... how it... warms...',
  },
};

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export class Boss extends Fighter {
  def: BossDef;
  phase = 1;
  attackCd = 2;
  arena: { pos: THREE.Vector3; radius: number };
  fighting = false;
  cutscene = false;
  onPhase: ((phase: number) => void) | null = null;
  onDefeat: (() => void) | null = null;
  minions: Enemy[] = [];
  private lastAtk: Atk | null = null;
  private barrier: THREE.Mesh;
  private vortexT = 0;
  private vortexAt = V();
  scriptedHook: ((b: Boss) => boolean) | null = null;
  level: number;
  private growTo = 0;

  constructor(def: BossDef, arena: { pos: THREE.Vector3; radius: number }, level: number) {
    super(def.look, 'enemy', 'boss');
    this.def = def;
    this.level = level;
    this.arena = arena;
    this.hpMax = def.hp;
    this.hp = def.hp;
    this.superArmor = true;
    this.pos.copy(arena.pos).add(V(0, 0, 0));
    const back = arena.pos.clone();
    this.pos.copy(back);
    ctx.combat.register(this);
    this.active = false;
    this.radius = 0.55 * this.scale + 0.4;
    const bm = energyMaterial(def.color, 0.55);
    this.barrier = new THREE.Mesh(new THREE.CylinderGeometry(arena.radius + 2, arena.radius + 2, 14, 64, 1, true), bm);
    this.barrier.position.copy(arena.pos).add(V(0, 5, 0));
    this.barrier.visible = false;
    ctx.scene.add(this.barrier);
  }

  get dmgScale() { return this.phase >= 3 ? 1.25 : this.phase === 2 ? 1.1 : 1; }

  startFight() {
    this.fighting = true;
    this.active = true;
    this.barrier.visible = true;
    this.attackCd = 1.5;
  }

  endFight() {
    this.fighting = false;
    this.barrier.visible = false;
  }

  takeDamage(info: DamageInfo) {
    if (!this.fighting || this.cutscene || this.invuln > 0) return;
    const prev = this.hp;
    super.takeDamage(info);
    this.knock.multiplyScalar(0.3);
    if (this.scriptedHook && this.scriptedHook(this)) return;
    const frac = this.hp / this.hpMax;
    if (this.phase === 1 && frac <= 0.5 && prev / this.hpMax > 0.5) this.enterPhase(2);
    else if (this.def.phase3 && this.phase === 2 && frac <= 0.25) this.enterPhase(3);
  }

  enterPhase(p: number) {
    this.phase = p;
    this.action = null;
    this.invuln = 1.5;
    this.attackCd = 1.8;
    this.play('roar', 'roar', 1.4, [[0.15, () => {
      ctx.audio.sfx('roar', this.pos, 1.3);
      ctx.fx.shockwave(this.pos.clone().add(V(0, 0.4, 0)), 16, this.def.color, 0.8, 2);
      ctx.fx.shake(1);
      ctx.combat.sphere(this.pos.clone().add(V(0, 1, 0)), 7, this.info(10, { knockback: 14 }));
    }]]);
    if (this.def.id === 'vexis' && p === 2) { this.growTo = 3.0; ctx.env.darken = 0.6; }
    if (this.def.id === 'vexis' && p === 3) ctx.env.darken = 0.85;
    this.onPhase?.(p);
  }

  die(info?: DamageInfo) {
    super.die(info);
    this.endFight();
    for (const m of this.minions) if (m.alive) { m.hp = 0; m.die(); }
    this.onDefeat?.();
  }

  info(mult: number, extra: Partial<DamageInfo> = {}): DamageInfo {
    return { amount: Math.round(this.def.dmg * mult / 10 * this.dmgScale), from: this.pos.clone(), team: 'enemy', source: 'enemy', element: this.def.element, ...extra };
  }

  private targetPos() {
    const p = ctx.player;
    return p.pos.clone();
  }

  update(dt: number) {
    if (this.growTo > 0) {
      const s = this.scale + (this.growTo - this.scale) * Math.min(1, dt * 1.5);
      this.scale = s;
      this.rig.root.scale.setScalar(s);
      this.radius = 0.55 * s + 0.4;
      this.height = 1.8 * s;
    }
    if (!this.alive) { this.physics(dt, V()); this.animate(dt); return; }
    if (this.vortexT > 0) this.updateVortex(dt);
    if (!this.fighting || this.cutscene) {
      this.physics(dt, V());
      if (this.fighting === false) this.faceTowards(ctx.player.pos, dt, 2);
      this.tickAction(dt);
      this.animate(dt);
      return;
    }
    // Keep the player inside the arena barrier.
    const pl = ctx.player;
    const a = this.arena;
    for (const f of [pl, ctx.companion] as Fighter[]) {
      const dx = f.pos.x - a.pos.x, dz = f.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > a.radius + 0.5) { f.pos.x = a.pos.x + dx / d * (a.radius + 0.5); f.pos.z = a.pos.z + dz / d * (a.radius + 0.5); }
    }
    this.attackCd = Math.max(0, this.attackCd - dt * (this.phase >= 3 ? 1.5 : this.phase === 2 ? 1.25 : 1));
    const tp = this.targetPos();
    const dist = Math.hypot(tp.x - this.pos.x, tp.z - this.pos.z);
    const wish = V();
    if (!this.action) {
      this.faceTowards(tp, dt, 6);
      const melee = 3 + this.scale * 1.6;
      if (this.attackCd <= 0) this.chooseAttack(dist, melee);
      else if (dist > melee * 0.9) wish.copy(tp).sub(this.pos).setY(0).normalize().multiplyScalar(this.def.speed * (this.phase >= 2 ? 1.2 : 1));
    }
    this.physics(dt, wish);
    // Stay in the arena.
    const dx = this.pos.x - a.pos.x, dz = this.pos.z - a.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > a.radius - 2) { this.pos.x = a.pos.x + dx / d * (a.radius - 2); this.pos.z = a.pos.z + dz / d * (a.radius - 2); }
    this.tickAction(dt);
    this.animate(dt);
    for (let i = this.minions.length - 1; i >= 0; i--) {
      const m = this.minions[i];
      m.update(dt);
      if (!m.alive && m.removeTimer > 4) { m.dispose(); this.minions.splice(i, 1); }
    }
  }

  private chooseAttack(dist: number, melee: number) {
    const list = this.phase >= 3 && this.def.phase3 ? this.def.phase3 : this.phase >= 2 ? this.def.phase2 : this.def.attacks;
    const valid = list.filter((a) => {
      if (a === this.lastAtk && list.length > 2) return false;
      if (a === 'smash' || a === 'sweep') return dist < melee * 1.3;
      if (a === 'summon') return this.minions.filter((m) => m.alive).length < 2;
      if (a === 'charge' || a === 'throw' || a === 'beam') return dist > 6;
      return true;
    });
    const atk = valid.length ? pick(valid) : (dist < melee * 1.3 ? 'smash' : 'charge');
    this.lastAtk = atk;
    this.attackCd = rand(1.2, 2.2);
    this.doAttack(atk);
  }

  private ground(p: THREE.Vector3) {
    p.y = Math.max(ctx.world.terrainHeight(p.x, p.z), this.arena.pos.y - 3);
    return p;
  }

  doAttack(atk: Atk) {
    const s = this.scale;
    const c = this.def.color;
    const fast = this.phase >= 3 ? 0.75 : this.phase === 2 ? 0.88 : 1;
    switch (atk) {
      case 'smash': {
        const at = this.ground(this.pos.clone().addScaledVector(this.facing(), 2 + s * 1.1));
        const r = 2.5 + s * 1.3;
        const tg = ctx.fx.telegraphCircle(at, r, 0.9 * fast);
        this.play('atk', 'slashDown', 1.5 * fast, [[0.6, () => {
          ctx.fx.removeTelegraph(tg);
          ctx.combat.sphere(at.clone().add(V(0, 1, 0)), r, this.info(10, { knockback: 12, launch: 8, stun: 0.4 }));
          ctx.fx.shockwave(at.clone().add(V(0, 0.3, 0)), r * 1.5, c, 0.5);
          ctx.particles.burst(at, 30, { speed: 9, up: 4, life: 1, size: 0.8, sizeEnd: 0.1, color: 0x8a7a68, gravity: 14 });
          if (this.def.element === 'fire') ctx.particles.burst(at, 24, { speed: 8, up: 6, life: 0.8, size: 1.2, sizeEnd: 0.1, color: 0xffc040, colorEnd: 0xff2000, additive: true });
          if (this.def.element === 'thunder') for (let i = 0; i < 3; i++) ctx.fx.lightning(at, at.clone().add(V(rand(-r, r), rand(0, 4), rand(-r, r))), c, 0.15, 0.3);
          ctx.audio.sfx('quake', at, 1); ctx.audio.sfx('explosion', at, 0.4);
          ctx.fx.shake(0.9);
        }]]);
        break;
      }
      case 'sweep': {
        const r = 3 + s * 1.6;
        const tg = ctx.fx.telegraphCircle(this.pos.clone(), r, 0.85 * fast);
        this.play('atk', 'spin', 1.3 * fast, [[0.5, () => {
          ctx.fx.removeTelegraph(tg);
          ctx.combat.sphere(this.pos.clone().add(V(0, 1, 0)), r, this.info(8, { knockback: 16 }));
          ctx.fx.slash(this.pos.clone().add(V(0, 1.2 * s * 0.5, 0)), this.yaw, c, r, 0, 0.35, Math.PI * 2);
          ctx.audio.sfx('slash', this.pos, 1.2); ctx.audio.sfx('whoosh', this.pos, 1);
          ctx.fx.shake(0.5);
        }]]);
        break;
      }
      case 'charge': {
        const tp = this.targetPos();
        const dir = tp.clone().sub(this.pos).setY(0).normalize();
        const len = clamp(this.pos.distanceTo(tp) + 8, 12, this.arena.radius * 1.6);
        const yaw = Math.atan2(dir.x, dir.z);
        this.yaw = yaw;
        const tg = ctx.fx.telegraphRect(this.pos.clone(), yaw, len, 2.5 + s, 0.8 * fast);
        const hitSet = new Set<any>();
        this.play('atkCharge', 'dash', 0.8 * fast + 0.55, [[0.8 * fast / (0.8 * fast + 0.55), () => {
          ctx.fx.removeTelegraph(tg);
          const from = this.pos.clone();
          const to = from.clone().addScaledVector(dir, len);
          let t = 0;
          const step = () => {
            t += 1 / 30;
            const k = Math.min(1, t / 0.5);
            this.pos.lerpVectors(from, to, k);
            ctx.combat.sphere(this.pos.clone().add(V(0, 1, 0)), 1.2 + s * 0.5, this.info(9, { knockback: 18, launch: 6 }), hitSet);
            if (Math.random() < 0.7) ctx.particles.emit({ pos: this.pos.clone().add(V(0, 0.3, 0)), vel: V(rand(-2, 2), 2, rand(-2, 2)), life: 0.7, size: 1.2, sizeEnd: 2.5, color: 0xa89a88, alpha: 0.5 });
            if (k < 1 && this.alive) setTimeout(step, 1000 / 30);
          };
          step();
          ctx.audio.sfx('dash', this.pos, 1.3); ctx.audio.sfx('roar', this.pos, 0.4);
        }]]);
        break;
      }
      case 'throw': {
        const tp = this.ground(this.targetPos().add(V(rand(-1.5, 1.5), 0, rand(-1.5, 1.5))));
        const tg = ctx.fx.telegraphCircle(tp, 4.2, 1.6 * fast);
        this.play('atk', 'throw', 1.0 * fast, [[0.5, () => {
          const from = this.rig.worldPos('haR').add(V(0, 1, 0));
          const T = 1.1 * fast;
          const g = 20;
          const vel = tp.clone().sub(from).divideScalar(T);
          vel.y = (tp.y - from.y) / T + 0.5 * g * T;
          const kind = this.def.projectile === 'cannon' ? 'rock' : this.def.projectile;
          ctx.projectiles.spawn({ kind: kind as any, pos: from, vel, gravity: g, radius: 1.2, scale: 1.2 + s * 0.2, aoe: 4.2, color: c, info: this.info(9, { knockback: 10, burn: this.def.element === 'fire' ? 3 : 0, freeze: this.def.element === 'ice' ? 1.2 : 0 }), onHit: () => ctx.fx.removeTelegraph(tg) });
          ctx.audio.sfx('whoosh', from, 1);
        }]]);
        break;
      }
      case 'rain': {
        const n = this.phase >= 2 ? 9 : 6;
        this.play('atk', 'castUp', 1.2 * fast, [[0.3, () => {
          ctx.audio.sfx(this.def.element === 'fire' ? 'fire' : 'power', this.pos, 0.8);
          for (let i = 0; i < n; i++) {
            const base = i < 2 ? this.targetPos() : this.arena.pos.clone().add(V(rand(-1, 1) * this.arena.radius * 0.8, 0, rand(-1, 1) * this.arena.radius * 0.8));
            const at = this.ground(base.add(V(rand(-2, 2), 0, rand(-2, 2))));
            const delay = 0.9 + i * 0.12;
            const tg = ctx.fx.telegraphCircle(at, 3.5, delay);
            setTimeout(() => {
              ctx.fx.removeTelegraph(tg);
              if (!this.alive) return;
              const top = at.clone().add(V(rand(-4, 4), 34, rand(-4, 4)));
              if (this.def.element === 'thunder' || this.def.element === 'dark') ctx.fx.lightning(top, at, c, 0.3, 0.3, 2);
              else if (this.def.element === 'ice') this.icicle(at);
              else ctx.fx.beam(top, at, 0.7, c, 0.25);
              ctx.fx.explosion(at, 0.8, c);
              ctx.combat.sphere(at.clone().add(V(0, 1, 0)), 3.5, this.info(7, { knockback: 6, burn: this.def.element === 'fire' ? 2 : 0, freeze: this.def.element === 'ice' ? 0.8 : 0 }));
              ctx.audio.sfx(this.def.element === 'thunder' ? 'thunder' : 'explosion', at, 0.5);
            }, delay * 1000);
          }
        }]]);
        break;
      }
      case 'lightning': {
        this.play('atk', 'castUp', 1.0 * fast, [[0.3, () => {
          for (let w = 0; w < 3; w++) setTimeout(() => {
            if (!this.alive) return;
            const at = this.ground(this.targetPos().add(V(rand(-1, 1), 0, rand(-1, 1))));
            const tg = ctx.fx.telegraphCircle(at, 4, 0.7, c);
            setTimeout(() => {
              ctx.fx.removeTelegraph(tg);
              ctx.fx.lightning(at.clone().add(V(0, 50, 0)), at, c, 0.6, 0.35, 2.5);
              ctx.fx.sphere(at, 4, c, 0.3, 0.6);
              ctx.combat.sphere(at.clone().add(V(0, 1, 0)), 4, this.info(9, { stun: 0.6 }));
              ctx.audio.sfx('thunder', at, 0.8);
            }, 700);
          }, w * 450);
        }]]);
        break;
      }
      case 'shockwave': {
        this.play('atk', 'slam', 1.4 * fast, [[0.58, () => {
          const origin = this.pos.clone();
          ctx.audio.sfx('quake', origin, 1.4);
          ctx.fx.shake(1);
          const maxR = this.arena.radius * 1.1;
          const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
          ring.rotation.x = -Math.PI / 2;
          ring.position.copy(origin).add(V(0, 0.6, 0));
          const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1.4, 64, 1, true), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.45, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
          wall.position.copy(origin).add(V(0, 0.7, 0));
          const g = new THREE.Group(); g.add(ring, wall);
          let hitDone = false;
          ctx.fx.custom(g, 1.3, (t) => {
            const r = 1 + t * maxR;
            ring.scale.setScalar(r);
            wall.scale.set(r, 1, r);
            ring.position.copy(origin).add(V(0, 0.6, 0));
            const pl = ctx.player;
            const d = Math.hypot(pl.pos.x - origin.x, pl.pos.z - origin.z);
            if (!hitDone && Math.abs(d - r) < 1.4 && pl.pos.y - pl.lastGroundH < 0.8) {
              hitDone = true;
              ctx.combat.apply(pl, this.info(8, { knockback: 10, launch: 7, from: origin }));
            }
            (ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
            (wall.material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - t);
          });
          ctx.particles.burst(origin, 40, { speed: 14, up: 2, life: 0.8, size: 1, sizeEnd: 0.2, color: 0xa89a88, gravity: 10 });
        }]]);
        ctx.ui.toast('JUMP over the shockwave!', 1.2);
        break;
      }
      case 'beam': {
        const tp = this.targetPos();
        const dir = tp.clone().sub(this.pos).setY(0).normalize();
        const yaw = Math.atan2(dir.x, dir.z);
        this.yaw = yaw;
        const len = this.arena.radius * 2;
        const w = 3 + this.scale * 0.6;
        const tg = ctx.fx.telegraphRect(this.pos.clone(), yaw, len, w, 1.1 * fast, c);
        this.play('atkBeam', 'roar', 2.2 * fast, [[0.5, () => {
          ctx.fx.removeTelegraph(tg);
          const from = this.rig.worldPos('head').add(dir.clone().multiplyScalar(0.5 * this.scale));
          const to = this.pos.clone().addScaledVector(dir, len).setY(this.pos.y + 0.5);
          ctx.fx.beam(from, to, w * 0.5, c, 0.9);
          ctx.fx.beam(from, to, w * 0.25, 0xffffff, 0.9);
          ctx.audio.sfx(this.def.element === 'thunder' ? 'thunder' : this.def.element === 'ice' ? 'ice' : 'fire', from, 1.5);
          ctx.audio.sfx('power', from, 0.8);
          ctx.fx.shake(0.8);
          const hitSet = new Set<any>();
          const a = this.pos.clone().add(V(0, 1, 0)), b = to.clone().add(V(0, 0.5, 0));
          for (let k = 0; k < 4; k++) setTimeout(() => { hitSet.clear(); ctx.combat.line(a, b, w * 0.55, this.info(5, { knockback: 6, freeze: this.def.element === 'ice' ? 1 : 0, burn: this.def.element === 'fire' ? 2 : 0 }), hitSet); }, k * 200);
          ctx.fx.explosion(to, 1.5, c);
        }]]);
        break;
      }
      case 'orbs': {
        const n = this.phase >= 2 ? 18 : 12;
        this.play('atk', 'cast', 1.0 * fast, [[0.45, () => {
          const from = this.pos.clone().add(V(0, 1.2 * this.scale * 0.7, 0));
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + rand(0, 0.2);
            const vel = V(Math.cos(a), 0, Math.sin(a)).multiplyScalar(16);
            ctx.projectiles.spawn({ kind: this.def.projectile === 'light' ? 'light' : 'orb', pos: from.clone(), vel, radius: 0.9, scale: 1, life: 3.5, color: i % 2 ? c : this.def.color2, aoe: 2, info: this.info(5, { knockback: 4 }), homing: i % 3 === 0 ? ctx.player : null, homingStrength: 0.8 });
          }
          ctx.audio.sfx('power', from, 0.8);
        }]]);
        break;
      }
      case 'teleport': {
        const behind = ctx.player.pos.clone().addScaledVector(ctx.player.facing(), -3.5);
        this.ground(behind);
        ctx.fx.sphere(this.pos.clone().add(V(0, 1.5, 0)), 3, c, 0.3, 0.6);
        ctx.particles.burst(this.pos.clone().add(V(0, 1, 0)), 30, { speed: 6, life: 0.6, size: 0.8, sizeEnd: 0.1, color: c, additive: true });
        this.setVisible(false);
        this.untargetable = true;
        ctx.audio.sfx('whoosh', this.pos, 1);
        setTimeout(() => {
          if (!this.alive) return;
          this.pos.copy(behind);
          this.setVisible(true);
          this.untargetable = false;
          this.faceTowards(ctx.player.pos, 0);
          ctx.fx.sphere(this.pos.clone().add(V(0, 1.5, 0)), 3, c, 0.3, 0.6);
          const tg = ctx.fx.telegraphCircle(this.pos.clone().addScaledVector(this.facing(), 2), 3.5, 0.45 * fast);
          this.play('atk', 'slashR', 0.9 * fast, [[0.55, () => {
            ctx.fx.removeTelegraph(tg);
            const o = this.pos.clone().add(V(0, 1, 0));
            ctx.combat.cone(o, this.facing(), 4.5, 1.1, this.info(8, { knockback: 8 }));
            ctx.fx.slash(o, this.yaw, c, 4, -0.3, 0.2);
            ctx.audio.sfx('slash', o, 1.2);
          }]]);
        }, 450);
        this.play('vanish', 'dash', 0.5, []);
        break;
      }
      case 'vortex': {
        this.vortexAt = this.ground(this.targetPos());
        this.vortexT = 3;
        const tg = ctx.fx.telegraphCircle(this.vortexAt, 9, 3, c);
        (tg as any).vortex = true;
        this.play('atk', 'castUp', 1.0, []);
        ctx.audio.sfx('whoosh', this.vortexAt, 1.5);
        ctx.ui.toast('Quicksand! Run against the pull!', 1.5);
        break;
      }
      case 'summon': {
        this.play('atk', 'roar', 1.2, [[0.3, () => {
          ctx.audio.sfx('roar', this.pos, 0.8);
          for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2 + rand(0, 1);
            const p = this.ground(this.arena.pos.clone().add(V(Math.cos(a) * this.arena.radius * 0.6, 0, Math.sin(a) * this.arena.radius * 0.6)));
            const type = i === 2 ? 'gunner' : 'brute';
            const e = new Enemy(factionLook(this.def.style as any, type), type, this.level, p);
            e.aggro = true;
            e.leashed = false;
            this.minions.push(e);
            ctx.fx.sphere(p.clone().add(V(0, 1, 0)), 2.5, c, 0.4, 0.6);
          }
        }]]);
        break;
      }
    }
  }

  private icicle(at: THREE.Vector3) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.9, 5, 6), new THREE.MeshStandardMaterial({ color: 0xcff4ff, emissive: 0x3a9ad8, emissiveIntensity: 0.4, transparent: true, opacity: 0.9 }));
    m.rotation.x = Math.PI;
    ctx.fx.custom(m, 1.6, (t) => {
      const fall = Math.min(1, t * 6);
      m.position.copy(at).add(V(0, 30 * (1 - fall) + 2.2, 0));
      m.scale.setScalar(t > 0.85 ? (1 - t) / 0.15 : 1);
    });
    ctx.audio.sfx('ice', at, 0.6);
  }

  private updateVortex(dt: number) {
    this.vortexT -= dt;
    const pl = ctx.player;
    const d = pl.pos.clone().sub(this.vortexAt).setY(0);
    const dist = d.length();
    if (dist < 10 && pl.mode === 'foot') {
      pl.pos.addScaledVector(d.normalize(), -dt * 5.5);
      if (dist < 2.2 && Math.random() < dt * 3) ctx.combat.apply(pl, this.info(4));
    }
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2, r = rand(1, 9);
      ctx.particles.emit({ pos: this.vortexAt.clone().add(V(Math.cos(a) * r, 0.3, Math.sin(a) * r)), vel: V(-Math.sin(a) * 6 - Math.cos(a) * 3, rand(0, 1), Math.cos(a) * 6 - Math.sin(a) * 3), life: 0.7, size: 0.5, sizeEnd: 0.1, color: 0xe8c47e, alpha: 0.7 });
    }
  }

  dispose() {
    super.dispose();
    ctx.scene.remove(this.barrier);
    for (const m of this.minions) m.dispose();
  }
}
