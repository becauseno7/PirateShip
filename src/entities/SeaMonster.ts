// Sea Kings: a towering sea serpent and a ship-grappling kraken.
import * as THREE from 'three';
import { ctx } from '../game/ctx';
import type { DamageInfo, Target, Team } from '../combat/Combat';
import { toonGradient, outlineMat } from '../world/materials';
import { clamp, damp, lerp, rand, smoothstep } from '../core/math';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const toonMat = (c: number, e = 0) => new THREE.MeshToonMaterial({ color: c, gradientMap: toonGradient(), emissive: e });

export abstract class SeaMonster implements Target {
  team: Team = 'enemy';
  kind = 'monster' as const;
  alive = true;
  radius = 4;
  hp: number;
  hpMax: number;
  group = new THREE.Group();
  dead = 0;
  name = 'Sea King';
  level: number;
  untargetable = false;
  onDeath: (() => void) | null = null;
  lastHitBy: DamageInfo['source'];
  protected flashT = 0;
  protected mats: THREE.MeshToonMaterial[] = [];
  constructor(hp: number, level: number) {
    this.hp = this.hpMax = hp;
    this.level = level;
    ctx.scene.add(this.group);
    ctx.combat.register(this);
  }
  abstract center(out: THREE.Vector3): THREE.Vector3;
  abstract hitTest(p: THREE.Vector3, r: number): boolean;
  abstract update(dt: number): void;
  takeDamage(info: DamageInfo) {
    if (!this.alive || this.untargetable) return;
    this.hp -= info.amount;
    this.lastHitBy = info.source;
    this.flashT = 0.1;
    if (this.hp <= 0) { this.hp = 0; this.alive = false; this.onDeath?.(); ctx.audio.sfx('roar', this.center(V()), 1.4); }
  }
  protected tickFlash(dt: number) {
    if (this.flashT > 0) {
      this.flashT -= dt;
      for (const m of this.mats) m.emissive.setRGB(this.flashT > 0 ? 0.8 : 0, this.flashT > 0 ? 0.8 : 0, this.flashT > 0 ? 0.8 : 0);
    }
  }
  dispose() {
    ctx.scene.remove(this.group);
    ctx.combat.unregister(this);
    this.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
    for (const m of this.mats) m.dispose();
  }
}

export class SeaSerpent extends SeaMonster {
  segs: THREE.Mesh[] = [];
  pts: THREE.Vector3[] = [];
  head: THREE.Group;
  jaw: THREE.Mesh;
  headPos = V();
  state: 'approach' | 'emerge' | 'attack' | 'dive' | 'dead' = 'approach';
  stateT = 0;
  side = 1;
  private spacing: number;
  private attackKind: 'bite' | 'spit' | 'slam' = 'bite';
  private biteTarget = V();
  private hitDone = false;
  private size: number;
  private tg: any = null;

  constructor(pos: THREE.Vector3, level: number, palette: 'green' | 'purple' | 'ice' | 'gold' = 'green') {
    super(Math.round(900 + level * 650), level);
    this.name = { green: 'Sea King', purple: 'Abyssal Sea King', ice: 'Glacier Wyrm', gold: 'Sunscale Leviathan' }[palette];
    const cols = { green: [0x2f8a5a, 0xd8e88a, 0xff4a2a], purple: [0x6a3a9a, 0xe8c8ff, 0xffd040], ice: [0x5aa8c8, 0xf0faff, 0x2a6aff], gold: [0xd8a83a, 0xfff0c0, 0xff2a2a] }[palette];
    this.size = 1 + level * 0.08;
    const S = this.size;
    this.spacing = 1.8 * S;
    this.radius = 3 * S;
    const body = toonMat(cols[0]), belly = toonMat(cols[1]);
    this.mats.push(body, belly);
    const N = 28;
    for (let i = 0; i < N; i++) {
      const r = (1.7 - (i / N) * 1.3) * S;
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), i % 2 ? body : belly);
      m.castShadow = true;
      const o = new THREE.Mesh(m.geometry, outlineMat);
      o.scale.setScalar(1.06);
      m.add(o);
      if (i % 2 === 0 && i < N - 4) {
        const fin = new THREE.Mesh(new THREE.ConeGeometry(0.5 * r, 1.6 * r, 4), toonMat(cols[2]));
        fin.position.y = r * 0.9;
        fin.rotation.x = -0.4;
        m.add(fin);
      }
      this.group.add(m);
      this.segs.push(m);
      this.pts.push(pos.clone().add(V(0, -6, -i * this.spacing)));
    }
    // Head with jaw, eyes, frills and horns.
    this.head = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.SphereGeometry(2.0 * S, 16, 12), body);
    skull.scale.set(1, 0.85, 1.6);
    const snout = new THREE.Mesh(new THREE.SphereGeometry(1.4 * S, 14, 10), body);
    snout.scale.set(1, 0.6, 1.4);
    snout.position.set(0, -0.2 * S, 2.4 * S);
    this.jaw = new THREE.Mesh(new THREE.SphereGeometry(1.3 * S, 14, 10), belly);
    this.jaw.scale.set(0.9, 0.4, 1.5);
    this.jaw.position.set(0, -1.0 * S, 1.6 * S);
    const eyeM = new THREE.MeshBasicMaterial({ color: cols[2] });
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.42 * S, 10, 8), eyeM);
      eye.position.set(s * 1.3 * S, 0.6 * S, 1.6 * S);
      this.head.add(eye);
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.4 * S, 2.6 * S, 6), toonMat(0xeae0c8));
      horn.position.set(s * 0.9 * S, 1.4 * S, -0.6 * S);
      horn.rotation.set(-0.9, 0, s * -0.3);
      this.head.add(horn);
      for (let k = 0; k < 3; k++) {
        const fr = new THREE.Mesh(new THREE.ConeGeometry(0.35 * S, 2.0 * S, 4), toonMat(cols[2]));
        fr.position.set(s * 1.7 * S, 0.2 * S - k * 0.5 * S, -0.4 * S - k * 0.4);
        fr.rotation.set(-0.5, 0, s * (1.2 + k * 0.2));
        this.head.add(fr);
      }
    }
    for (let k = 0; k < 6; k++) {
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.15 * S, 0.6 * S, 4), toonMat(0xffffff));
      tooth.position.set((k - 2.5) * 0.35 * S, -0.75 * S, 3.4 * S);
      tooth.rotation.x = Math.PI;
      this.head.add(tooth);
    }
    for (const m of [skull, snout, this.jaw]) {
      m.castShadow = true;
      const o = new THREE.Mesh(m.geometry, outlineMat);
      o.scale.setScalar(1.05);
      m.add(o);
      this.head.add(m);
    }
    this.group.add(this.head);
    this.headPos.copy(pos).add(V(0, -6, 0));
  }

  center(out: THREE.Vector3) { return out.copy(this.headPos); }

  hitTest(p: THREE.Vector3, r: number) {
    if (!this.alive || this.untargetable) return false;
    if (p.distanceTo(this.headPos) < r + 3 * this.size) return true;
    for (let i = 0; i < this.pts.length; i += 2) {
      const q = this.pts[i];
      if (q.y > -1.5 && p.distanceTo(q) < r + 1.5 * this.size) return true;
    }
    return false;
  }

  update(dt: number) {
    this.tickFlash(dt);
    const ship = ctx.ship;
    const sp = ship.pos;
    this.stateT += dt;
    const target = V();
    const t = ctx.time;
    if (!this.alive) {
      this.dead += dt;
      target.copy(this.headPos).add(V(0, -dt * 4, 0));
      this.headPos.copy(target);
      if (this.dead < 0.1) { ctx.fx.splash(this.headPos, 3); }
    } else switch (this.state) {
      case 'approach': {
        this.untargetable = true;
        const side = ship.right.multiplyScalar(this.side * 32);
        target.copy(sp).add(side).add(ship.forward.multiplyScalar(10));
        target.y = -3.5;
        const dir = target.clone().sub(this.headPos);
        if (dir.length() > 1) this.headPos.addScaledVector(dir.normalize(), Math.min(dir.length(), dt * (32 + ship.speed)));
        this.headPos.y = damp(this.headPos.y, -3.5, 2, dt);
        if (Math.random() < 0.6) ctx.particles.emit({ pos: V(this.headPos.x, 0.3, this.headPos.z), vel: V(rand(-1, 1), 1, rand(-1, 1)), life: 1.2, size: 1.2, sizeEnd: 3, color: 0xffffff, alpha: 0.6 });
        if (this.headPos.distanceTo(target) < 6 || this.stateT > 14) this.setState('emerge');
        break;
      }
      case 'emerge': {
        this.untargetable = false;
        const side = ship.right.multiplyScalar(this.side * 26);
        target.copy(sp).add(side).add(ship.forward.multiplyScalar(4 + Math.sin(t * 0.7) * 6));
        target.y = 15 * this.size + Math.sin(t * 1.6) * 1.5;
        this.headPos.lerp(target, 1 - Math.exp(-2.5 * dt));
        if (this.stateT < 0.05) { ctx.fx.splash(this.headPos.clone().setY(0), 3.5); ctx.audio.sfx('splash', this.headPos, 1.5); ctx.audio.sfx('roar', this.headPos, 1.2); ctx.ui.toast(`A ${this.name} rises from the deep!`, 2); }
        if (this.stateT > 2.2) {
          this.attackKind = Math.random() < 0.4 ? 'bite' : Math.random() < 0.6 ? 'spit' : 'slam';
          this.setState('attack');
        }
        break;
      }
      case 'attack': {
        const k = this.stateT;
        if (this.attackKind === 'bite') {
          if (k < 0.05) { this.biteTarget.copy(ship.toWorld(V(rand(-1.5, 1.5), ship.dims.deckY + 1, rand(-6, 6)))); this.tg = ctx.fx.telegraphCircle(this.biteTarget.clone().setY(this.biteTarget.y - 0.8), 4.5, 1.0); this.hitDone = false; }
          const rest = sp.clone().add(ship.right.multiplyScalar(this.side * 26)).setY(17 * this.size);
          if (k < 1.0) { this.headPos.lerp(rest.add(V(0, 4, 0)), 1 - Math.exp(-3 * dt)); this.jaw.rotation.x = smoothstep(0, 1, k) * 0.6; }
          else if (k < 1.35) { this.headPos.lerp(this.biteTarget, 1 - Math.exp(-14 * dt)); }
          else if (!this.hitDone) {
            this.hitDone = true;
            ctx.fx.removeTelegraph(this.tg);
            this.jaw.rotation.x = 0;
            ctx.combat.sphere(this.biteTarget, 4.5, { amount: Math.round(26 + this.level * 9), from: this.headPos.clone(), team: 'enemy', source: 'enemy', knockback: 10 });
            if (ship.hitTest(this.biteTarget, 3)) ctx.combat.apply(ship, { amount: Math.round(40 + this.level * 14), from: this.headPos.clone(), team: 'enemy', source: 'enemy' });
            ctx.fx.splash(this.biteTarget.clone().setY(0), 2);
            ctx.audio.sfx('explosion', this.biteTarget, 0.6);
            ctx.fx.shake(1);
          } else if (k > 2.2) this.setState(Math.random() < 0.35 ? 'dive' : 'emerge');
        } else if (this.attackKind === 'spit') {
          const rest = sp.clone().add(ship.right.multiplyScalar(this.side * 30)).setY(16 * this.size);
          this.headPos.lerp(rest, 1 - Math.exp(-2 * dt));
          this.jaw.rotation.x = smoothstep(0.3, 0.8, k) * 0.7 * (k < 1 ? 1 : 0);
          if (k > 0.9 && !this.hitDone) {
            this.hitDone = true;
            const tgt = (ctx.player.groundShip === ship ? ctx.player.pos.clone() : ship.pos.clone()).add(V(rand(-2, 2), 1, rand(-2, 2)));
            const T = 1.0, g = 18;
            const from = this.headPos.clone();
            const vel = tgt.clone().sub(from).divideScalar(T); vel.y = (tgt.y - from.y) / T + 0.5 * g * T;
            const tg = ctx.fx.telegraphCircle(tgt.clone().setY(tgt.y - 1), 4, T);
            ctx.projectiles.spawn({ kind: 'water', pos: from, vel, gravity: g, radius: 1.8, scale: 1.6, aoe: 4.5, info: { amount: Math.round(22 + this.level * 8), from, team: 'enemy', source: 'enemy', element: 'water', knockback: 8, shipDamageMult: 1.4 }, onHit: () => ctx.fx.removeTelegraph(tg) });
            ctx.audio.sfx('splash', from, 1);
          }
          if (k > 2.0) this.setState(Math.random() < 0.4 ? 'dive' : 'emerge');
        } else {
          // Tail slam: a telegraphed crash beside the ship.
          if (k < 0.05) {
            this.biteTarget.copy(ship.toWorld(V(this.side * -2, 0, rand(-8, 4))));
            this.tg = ctx.fx.telegraphCircle(this.biteTarget.clone().setY(ship.pos.y + ship.dims.deckY), 7, 1.3);
            this.hitDone = false;
          }
          this.headPos.lerp(sp.clone().add(ship.right.multiplyScalar(this.side * 28)).setY(10), 1 - Math.exp(-2 * dt));
          if (k > 1.3 && !this.hitDone) {
            this.hitDone = true;
            ctx.fx.removeTelegraph(this.tg);
            const tail = this.pts[this.pts.length - 1];
            tail.copy(this.biteTarget).add(V(0, 4, 0));
            ctx.combat.sphere(this.biteTarget.clone().setY(ship.pos.y + ship.dims.deckY + 1), 7, { amount: Math.round(30 + this.level * 9), from: this.biteTarget.clone(), team: 'enemy', source: 'enemy', knockback: 12, launch: 6 });
            if (ship.hitTest(this.biteTarget.clone().setY(ship.pos.y + 2), 5)) ctx.combat.apply(ship, { amount: Math.round(50 + this.level * 15), from: this.biteTarget.clone(), team: 'enemy', source: 'enemy' });
            ctx.fx.splash(this.biteTarget.clone().setY(0), 3);
            ctx.audio.sfx('explosion', this.biteTarget, 0.8);
            ctx.fx.shake(1.2);
          }
          if (k > 2.4) this.setState('emerge');
        }
        break;
      }
      case 'dive': {
        this.untargetable = this.headPos.y < 0;
        this.headPos.y -= dt * 10;
        this.headPos.addScaledVector(ship.forward, dt * 10);
        if (this.stateT > 2.5) { this.side *= -1; this.setState('approach'); }
        break;
      }
    }
    // Body follows the head.
    this.pts[0].copy(this.headPos).add(this.head.getWorldDirection(V()).multiplyScalar(-2 * this.size));
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1], b = this.pts[i];
      const d = b.clone().sub(a);
      const len = d.length() || 1;
      b.copy(a).addScaledVector(d.divideScalar(len), this.spacing);
      if (i > 5) b.y = lerp(b.y, -4.5, Math.min(1, dt * (0.6 + i * 0.02)));
      b.x += Math.sin(t * 2 + i * 0.5) * dt * 0.8;
    }
    this.segs.forEach((s, i) => s.position.copy(this.pts[i]));
    // Head orientation: look toward the ship.
    this.head.position.copy(this.headPos);
    const look = this.alive ? sp.clone().setY(this.headPos.y - 6) : this.headPos.clone().add(V(0, -10, 1));
    this.head.lookAt(look);
    // Splashes where the body pierces the surface.
    for (let i = 0; i < this.pts.length; i += 3) {
      const p = this.pts[i];
      if (Math.abs(p.y) < 1.2 && Math.random() < dt * 4) ctx.particles.emit({ pos: V(p.x, 0.3, p.z), vel: V(rand(-2, 2), rand(2, 4), rand(-2, 2)), life: 0.8, size: 0.9, sizeEnd: 0.2, color: 0xffffff, gravity: 9, alpha: 0.8 });
    }
  }

  private setState(s: SeaSerpent['state']) { this.state = s; this.stateT = 0; }
}

export class Kraken extends SeaMonster {
  body: THREE.Group;
  tentacles: { segs: THREE.Mesh[]; base: THREE.Vector3; tip: THREE.Vector3; phase: number; slamT: number; slamAt: THREE.Vector3; tg: any; angle: number }[] = [];
  bodyPos = V();
  grabbing = false;
  private t = 0;
  private slamCd = 2;
  private inkCd = 6;
  submerged = 1;

  constructor(pos: THREE.Vector3, level: number) {
    super(Math.round(1500 + level * 900), level);
    this.name = 'Kraken';
    this.radius = 7;
    const skin = toonMat(0x9a2a4a), spots = toonMat(0xd86a8a), sucker = toonMat(0xf0c8c8);
    this.mats.push(skin, spots, sucker);
    this.body = new THREE.Group();
    const mantle = new THREE.Mesh(new THREE.SphereGeometry(6, 20, 16), skin);
    mantle.scale.set(1, 1.35, 1);
    mantle.position.y = 3;
    const o = new THREE.Mesh(mantle.geometry, outlineMat); o.scale.setScalar(1.04); mantle.add(o);
    this.body.add(mantle);
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 6), spots);
      const a = rand(0, Math.PI * 2), b = rand(0.2, 1.2);
      s.position.set(Math.cos(a) * 5.8 * Math.sin(b), 3 + Math.cos(b) * 7.6, Math.sin(a) * 5.8 * Math.sin(b));
      this.body.add(s);
    }
    const eyeW = new THREE.MeshBasicMaterial({ color: 0xffe080 }), pupil = new THREE.MeshBasicMaterial({ color: 0x111111 });
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 10), eyeW);
      e.position.set(s * 3.2, 0.5, 4.6);
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.4), pupil);
      p.position.set(0, 0, 1.25);
      e.add(p);
      this.body.add(e);
    }
    this.group.add(this.body);
    this.bodyPos.copy(pos).setY(-12);
    for (let k = 0; k < 6; k++) {
      const segs: THREE.Mesh[] = [];
      for (let i = 0; i < 14; i++) {
        const r = 1.2 - i * 0.075;
        const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), i % 3 === 0 ? sucker : skin);
        m.castShadow = true;
        this.group.add(m);
        segs.push(m);
      }
      this.tentacles.push({ segs, base: V(), tip: V(), phase: rand(0, 6), slamT: -1, slamAt: V(), tg: null, angle: (k / 6) * Math.PI * 2 });
    }
  }

  center(out: THREE.Vector3) { return out.copy(this.bodyPos).add(V(0, 4, 0)); }

  hitTest(p: THREE.Vector3, r: number) {
    if (!this.alive || this.submerged > 0.6) return false;
    if (p.distanceTo(this.bodyPos.clone().add(V(0, 4, 0))) < r + 7) return true;
    for (const tn of this.tentacles) for (let i = 0; i < tn.segs.length; i += 2) if (tn.segs[i].position.y > -1 && p.distanceTo(tn.segs[i].position) < r + 1.4) return true;
    return false;
  }

  update(dt: number) {
    this.t += dt;
    this.tickFlash(dt);
    const ship = ctx.ship;
    if (!this.alive) {
      this.dead += dt;
      this.bodyPos.y -= dt * 3;
      this.grabbing = false;
      for (const tn of this.tentacles) tn.tip.y -= dt * 6;
    } else {
      // Rise beside the ship and latch on.
      const anchor = ship.pos.clone().add(ship.right.multiplyScalar(18)).add(ship.forward.multiplyScalar(-4));
      const d = anchor.clone().sub(this.bodyPos).setY(0);
      const dist = d.length();
      if (dist > 2) this.bodyPos.addScaledVector(d.normalize(), Math.min(dist, dt * (dist > 60 ? 40 + ship.speed : ship.speed + 12)));
      this.grabbing = dist < 30;
      this.submerged = damp(this.submerged, this.grabbing ? 0 : 1, 1.2, dt);
      this.bodyPos.y = lerp(-1.5, -12, this.submerged) + Math.sin(this.t * 1.2) * 0.6;
      if (this.grabbing && this.submerged < 0.5 && Math.random() < dt) ctx.fx.splash(this.bodyPos.clone().setY(0), 1.5);
      if (this.grabbing) ship.speed = Math.min(ship.speed, ship.maxSpeed * 0.25);
      if (this.grabbing && this.submerged < 0.3) {
        this.slamCd -= dt;
        if (this.slamCd <= 0) {
          this.slamCd = rand(1.4, 2.4);
          const free = this.tentacles.filter((x) => x.slamT < 0);
          if (free.length) {
            const tn = free[Math.floor(Math.random() * free.length)];
            tn.slamT = 0;
            const onPlayer = Math.random() < 0.5 && ctx.player.groundShip === ship;
            tn.slamAt.copy(onPlayer ? ctx.player.pos : ship.toWorld(V(rand(-2.5, 2.5), ship.dims.deckY, rand(-9, 9))));
            tn.tg = ctx.fx.telegraphCircle(tn.slamAt.clone(), 3.6, 1.2);
          }
        }
        this.inkCd -= dt;
        if (this.inkCd <= 0) {
          this.inkCd = rand(6, 9);
          const from = this.bodyPos.clone().add(V(0, 5, 0));
          const tgt = ship.pos.clone().add(V(rand(-3, 3), ship.dims.deckY + 1, rand(-3, 3)));
          const T = 1.1, g = 18;
          const vel = tgt.clone().sub(from).divideScalar(T); vel.y = (tgt.y - from.y) / T + 0.5 * g * T;
          ctx.projectiles.spawn({ kind: 'orb', color: 0x2a1a3a, pos: from, vel, gravity: g, radius: 1.6, scale: 1.8, aoe: 5, info: { amount: Math.round(20 + this.level * 7), from, team: 'enemy', source: 'enemy', element: 'dark', stun: 0.8, shipDamageMult: 1.5 } });
        }
      }
    }
    this.body.position.copy(this.bodyPos);
    this.body.lookAt(ship.pos.clone().setY(this.bodyPos.y));
    // Tentacles: bases around the body, tips sway or slam.
    for (const tn of this.tentacles) {
      const a = tn.angle + Math.sin(this.t * 0.3) * 0.2;
      tn.base.set(this.bodyPos.x + Math.cos(a) * 7, -1.5, this.bodyPos.z + Math.sin(a) * 7);
      let tip: THREE.Vector3;
      if (tn.slamT >= 0 && this.alive) {
        tn.slamT += dt;
        const raise = smoothstep(0, 1.0, tn.slamT), slam = smoothstep(1.1, 1.3, tn.slamT);
        const high = tn.slamAt.clone().add(V(0, 14, 0)).lerp(tn.base, 0.3);
        tip = tn.base.clone().lerp(high, raise).lerp(tn.slamAt, slam);
        if (tn.slamT > 1.3 && tn.slamT - dt <= 1.3) {
          ctx.fx.removeTelegraph(tn.tg);
          ctx.combat.sphere(tn.slamAt.clone().add(V(0, 1, 0)), 3.6, { amount: Math.round(24 + this.level * 8), from: tn.slamAt.clone(), team: 'enemy', source: 'enemy', knockback: 10, launch: 5 });
          if (ship.hitTest(tn.slamAt, 2)) ctx.combat.apply(ship, { amount: Math.round(32 + this.level * 10), from: tn.slamAt.clone(), team: 'enemy', source: 'enemy' });
          ctx.audio.sfx('explosion', tn.slamAt, 0.6);
          ctx.particles.burst(tn.slamAt, 16, { speed: 6, up: 3, life: 0.6, size: 0.8, sizeEnd: 0.1, color: 0x9a7a5a, gravity: 12 });
          ctx.fx.shake(0.8);
        }
        if (tn.slamT > 2.2) tn.slamT = -1;
      } else {
        const sway = this.t * 1.3 + tn.phase;
        tip = tn.base.clone().add(V(Math.cos(a) * (4 + Math.sin(sway) * 3), (this.alive ? 10 : 2) * (1 - this.submerged) + Math.sin(sway * 1.3) * 2, Math.sin(a) * (4 + Math.cos(sway) * 3)));
      }
      tn.tip.lerp(tip, 1 - Math.exp(-10 * dt));
      const ctrl = tn.base.clone().lerp(tn.tip, 0.5).add(V(0, 6 * (1 - this.submerged), 0));
      tn.segs.forEach((s, i) => {
        const u = i / (tn.segs.length - 1);
        const p = tn.base.clone().multiplyScalar((1 - u) * (1 - u)).addScaledVector(ctrl, 2 * u * (1 - u)).addScaledVector(tn.tip, u * u);
        s.position.copy(p);
      });
    }
  }
}
