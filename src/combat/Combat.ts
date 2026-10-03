// Target registry and damage resolution shared by every fighter, ship and monster.
import * as THREE from 'three';
import { ctx } from '../game/ctx';

export type Team = 'player' | 'enemy';
export type Element = 'physical' | 'fire' | 'ice' | 'thunder' | 'quake' | 'stretch' | 'cannon' | 'slash' | 'water' | 'dark' | 'light';

export interface DamageInfo {
  amount: number;
  from: THREE.Vector3;
  team: Team;
  knockback?: number;
  launch?: number;
  stun?: number;
  freeze?: number;
  burn?: number;
  element?: Element;
  source?: 'player' | 'companion' | 'ship' | 'enemy' | 'env';
  crit?: boolean;
  shipDamageMult?: number;
}

export interface Target {
  team: Team;
  alive: boolean;
  kind: 'humanoid' | 'boss' | 'ship' | 'monster' | 'player' | 'ally';
  radius: number;
  center(out: THREE.Vector3): THREE.Vector3;
  hitTest(p: THREE.Vector3, r: number): boolean;
  takeDamage(info: DamageInfo): void;
  untargetable?: boolean;
  active?: boolean;
}

const ELEMENT_COLOR: Record<Element, string> = {
  physical: '#ffffff', fire: '#ffb347', ice: '#a8ecff', thunder: '#fff27a', quake: '#e8e2ff', stretch: '#f0c8ff',
  cannon: '#ffd28a', slash: '#d8fff0', water: '#8ad8ff', dark: '#c49aff', light: '#fff6c8',
};

const tmp = new THREE.Vector3();

export class Combat {
  targets = new Set<Target>();

  register(t: Target) { this.targets.add(t); }
  unregister(t: Target) { this.targets.delete(t); }

  *enemiesOf(team: Team) {
    for (const t of this.targets) if (t.team !== team && t.alive && !t.untargetable && t.active !== false) yield t;
  }

  apply(t: Target, info: DamageInfo) {
    if (!t.alive) return;
    t.takeDamage(info);
    t.center(tmp);
    if (info.amount > 0 && info.source !== 'env') {
      const enemyHitsPlayer = t.kind === 'player';
      ctx.ui.damageNumber(tmp.clone().add(new THREE.Vector3(0, t.radius * 0.6 + 0.5, 0)), info.amount, enemyHitsPlayer ? '#ff5a4a' : ELEMENT_COLOR[info.element ?? 'physical'], !!info.crit, t.kind === 'boss' || t.kind === 'ship' || t.kind === 'monster');
    }
    if (info.source === 'player' && t.team === 'enemy') ctx.player.onDealtDamage(info.amount);
  }

  /** Damage every enemy of `info.team` overlapping a sphere. */
  sphere(center: THREE.Vector3, radius: number, info: DamageInfo, hitSet?: Set<Target>) {
    const hits: Target[] = [];
    for (const t of this.enemiesOf(info.team)) {
      if (hitSet?.has(t)) continue;
      if (t.hitTest(center, radius)) {
        hits.push(t);
        hitSet?.add(t);
        this.apply(t, { ...info, from: info.from ?? center });
      }
    }
    return hits;
  }

  cone(origin: THREE.Vector3, dir: THREE.Vector3, range: number, halfAngle: number, info: DamageInfo, hitSet?: Set<Target>) {
    const hits: Target[] = [];
    const cos = Math.cos(halfAngle);
    const d = dir.clone().setY(0).normalize();
    for (const t of this.enemiesOf(info.team)) {
      if (hitSet?.has(t)) continue;
      t.center(tmp);
      const to = tmp.clone().sub(origin);
      const dy = to.y;
      to.y = 0;
      const dist = to.length();
      if (dist - t.radius > range || Math.abs(dy) > range * 0.6 + t.radius) continue;
      if (dist > t.radius && to.normalize().dot(d) < cos) continue;
      hits.push(t);
      hitSet?.add(t);
      this.apply(t, info);
    }
    return hits;
  }

  line(a: THREE.Vector3, b: THREE.Vector3, width: number, info: DamageInfo, hitSet?: Set<Target>) {
    const hits: Target[] = [];
    const ab = b.clone().sub(a);
    const len = ab.length();
    const n = Math.max(2, Math.ceil(len / Math.max(1, width)));
    for (const t of this.enemiesOf(info.team)) {
      if (hitSet?.has(t)) continue;
      for (let i = 0; i <= n; i++) {
        const p = a.clone().addScaledVector(ab, i / n);
        if (t.hitTest(p, width)) {
          hits.push(t);
          hitSet?.add(t);
          this.apply(t, { ...info, from: a });
          break;
        }
      }
    }
    return hits;
  }

  nearest(team: Team, pos: THREE.Vector3, maxDist: number, dir?: THREE.Vector3, halfAngle = Math.PI, filter?: (t: Target) => boolean) {
    let best: Target | null = null;
    let bestScore = Infinity;
    const cos = Math.cos(halfAngle);
    const d = dir ? dir.clone().setY(0).normalize() : null;
    for (const t of this.enemiesOf(team)) {
      if (filter && !filter(t)) continue;
      t.center(tmp);
      const to = tmp.clone().sub(pos);
      const dist = to.length() - t.radius;
      if (dist > maxDist) continue;
      let score = dist;
      if (d) {
        to.y = 0;
        const c = to.normalize().dot(d);
        if (c < cos && dist > 2) continue;
        score = dist * (2 - c);
      }
      if (score < bestScore) { bestScore = score; best = t; }
    }
    return best;
  }

  anyEnemyNear(team: Team, pos: THREE.Vector3, r: number) {
    for (const t of this.enemiesOf(team)) if (t.center(tmp).distanceTo(pos) < r + t.radius) return true;
    return false;
  }
}
