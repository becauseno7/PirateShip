// Ballistic and energy projectiles: cannonballs, musket shots, fireballs, ice
// lances, boss rocks, water blasts. Collides with targets, terrain and sea.
import * as THREE from 'three';
import { ctx } from '../game/ctx';
import type { DamageInfo, Target } from './Combat';
import { rand } from '../core/math';

export type ProjKind = 'cannon' | 'musket' | 'fireball' | 'ice' | 'rock' | 'water' | 'orb' | 'slash' | 'fist' | 'meteor' | 'light';

export interface ProjOpts {
  kind: ProjKind;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  gravity?: number;
  radius?: number;
  info: DamageInfo;
  life?: number;
  homing?: Target | null;
  homingStrength?: number;
  pierce?: boolean;
  scale?: number;
  aoe?: number;
  color?: number;
  onHit?: (pos: THREE.Vector3, target: Target | null) => void;
}

interface Proj extends ProjOpts {
  mesh: THREE.Object3D;
  age: number;
  hitSet: Set<Target>;
  dead: boolean;
}

const geos = {
  ball: new THREE.SphereGeometry(1, 12, 10),
  cone: new THREE.ConeGeometry(0.35, 2.2, 6).rotateX(Math.PI / 2),
  slash: new THREE.TorusGeometry(1.6, 0.18, 4, 24, Math.PI),
};
const mats = {
  cannon: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.6, roughness: 0.4 }),
  rock: new THREE.MeshStandardMaterial({ color: 0x5a5048, roughness: 1, flatShading: true }),
};

export class Projectiles {
  list: Proj[] = [];
  constructor(private scene: THREE.Scene) {}

  spawn(o: ProjOpts) {
    const s = o.scale ?? 1;
    let mesh: THREE.Object3D;
    const glow = (color: number, r: number) => {
      const g = new THREE.Group();
      const core = new THREE.Mesh(geos.ball, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      core.scale.setScalar(r * 0.6);
      const halo = new THREE.Mesh(geos.ball, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      halo.scale.setScalar(r);
      g.add(core, halo);
      return g;
    };
    switch (o.kind) {
      case 'cannon': mesh = new THREE.Mesh(geos.ball, mats.cannon); mesh.scale.setScalar(0.35 * s); break;
      case 'rock': mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), mats.rock); mesh.scale.setScalar(1.2 * s); mesh.castShadow = true; break;
      case 'musket': mesh = glow(o.color ?? 0xffd080, 0.15); break;
      case 'fireball': mesh = glow(o.color ?? 0xff6a1a, 0.9 * s); break;
      case 'meteor': mesh = glow(o.color ?? 0xff4a0a, 1.4 * s); break;
      case 'water': mesh = glow(o.color ?? 0x5ac8ff, 1.0 * s); break;
      case 'orb': mesh = glow(o.color ?? 0xc070ff, 0.8 * s); break;
      case 'light': mesh = glow(o.color ?? 0xfff2a0, 0.7 * s); break;
      case 'fist': mesh = glow(o.color ?? 0xf0c8ff, 0.5 * s); break;
      case 'ice': {
        mesh = new THREE.Mesh(geos.cone, new THREE.MeshStandardMaterial({ color: 0xbff4ff, emissive: 0x4ab8e8, emissiveIntensity: 0.8, transparent: true, opacity: 0.9, roughness: 0.1 }));
        mesh.scale.setScalar(s);
        break;
      }
      case 'slash': {
        mesh = new THREE.Mesh(geos.slash, new THREE.MeshBasicMaterial({ color: o.color ?? 0xbfffe8, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        mesh.scale.setScalar(s);
        break;
      }
    }
    mesh.position.copy(o.pos);
    this.scene.add(mesh);
    const p: Proj = { radius: 0.5 * s, life: 6, gravity: 0, ...o, mesh, age: 0, hitSet: new Set(), dead: false };
    this.list.push(p);
    return p;
  }

  private impact(p: Proj, target: Target | null, water: boolean) {
    const pos = p.mesh.position.clone();
    p.onHit?.(pos, target);
    const s = p.scale ?? 1;
    switch (p.kind) {
      case 'cannon':
        if (water && !target) { ctx.fx.splash(pos, 0.9); ctx.audio.sfx('splash', pos, 0.8); }
        else { ctx.fx.explosion(pos, 0.8); ctx.audio.sfx('explosion', pos, 0.7); }
        if (p.aoe) ctx.combat.sphere(pos, p.aoe, { ...p.info, amount: p.info.amount * 0.5 }, p.hitSet);
        break;
      case 'fireball':
      case 'meteor':
        ctx.fx.explosion(pos, 1.3 * s, 0xff5a10);
        ctx.audio.sfx('fire', pos, 1);
        ctx.audio.sfx('explosion', pos, 0.5);
        ctx.fx.shake(0.4 * s);
        if (p.aoe) ctx.combat.sphere(pos, p.aoe, p.info, p.hitSet);
        if (water) ctx.fx.splash(pos, 0.7);
        break;
      case 'rock':
        ctx.particles.burst(pos, 25, { speed: 8, up: 4, life: 1, size: 0.6, sizeEnd: 0.1, color: 0x7a6a5a, gravity: 15, drag: 0.5 });
        ctx.fx.shockwave(pos.clone().setY(pos.y + 0.2), 5 * s, 0xd8c8a8, 0.5);
        ctx.audio.sfx('quake', pos, 0.6);
        if (p.aoe) ctx.combat.sphere(pos, p.aoe, p.info, p.hitSet);
        if (water) ctx.fx.splash(pos, 1.2);
        break;
      case 'water':
        ctx.fx.splash(pos, 1.3 * s);
        ctx.audio.sfx('splash', pos, 1);
        if (p.aoe) ctx.combat.sphere(pos, p.aoe, p.info, p.hitSet);
        break;
      case 'ice':
        ctx.particles.burst(pos, 14, { speed: 6, life: 0.6, size: 0.3, sizeEnd: 0.05, color: 0xdff8ff, additive: true, gravity: 8 });
        ctx.audio.sfx('ice', pos, 0.6);
        break;
      case 'orb':
      case 'light':
        ctx.fx.sphere(pos, 3 * s, p.kind === 'orb' ? 0xc070ff : 0xfff2a0, 0.35);
        ctx.particles.burst(pos, 16, { speed: 6, life: 0.5, size: 0.4, sizeEnd: 0.05, color: p.kind === 'orb' ? 0xd8a0ff : 0xfff6c0, additive: true });
        if (p.aoe) ctx.combat.sphere(pos, p.aoe, p.info, p.hitSet);
        ctx.audio.sfx('zap', pos, 0.6);
        break;
      case 'musket':
        ctx.particles.burst(pos, 6, { speed: 4, life: 0.3, size: 0.2, color: 0xffd080, additive: true });
        break;
      default:
        ctx.particles.burst(pos, 10, { speed: 5, life: 0.4, size: 0.3, color: p.color ?? 0xffffff, additive: true });
    }
    if (!p.pierce || !target) p.dead = true;
  }

  update(dt: number) {
    const tmp = new THREE.Vector3();
    for (const p of this.list) {
      if (p.dead) continue;
      p.age += dt;
      if (p.homing && p.homing.alive) {
        p.homing.center(tmp);
        const desired = tmp.sub(p.mesh.position).normalize().multiplyScalar(p.vel.length());
        p.vel.lerp(desired, Math.min(1, dt * (p.homingStrength ?? 3)));
      }
      p.vel.y -= (p.gravity ?? 0) * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      const pos = p.mesh.position;
      if (p.kind === 'ice' || p.kind === 'slash') p.mesh.lookAt(tmp.copy(pos).add(p.vel));
      if (p.kind === 'slash') p.mesh.rotateX(Math.PI / 2);
      if (p.kind === 'rock') { p.mesh.rotation.x += dt * 4; p.mesh.rotation.z += dt * 3; }
      // Trails.
      if (p.kind === 'cannon' && Math.random() < 0.7) ctx.particles.emit({ pos: pos.clone(), vel: new THREE.Vector3(rand(-0.3, 0.3), 0.5, rand(-0.3, 0.3)), life: 0.8, size: 0.4, sizeEnd: 1.4, color: 0xaaaaaa, colorEnd: 0x666666, alpha: 0.5 });
      if (p.kind === 'fireball' || p.kind === 'meteor') for (let i = 0; i < 2; i++) ctx.particles.emit({ pos: pos.clone().add(new THREE.Vector3(rand(-0.4, 0.4), rand(-0.4, 0.4), rand(-0.4, 0.4)).multiplyScalar(p.scale ?? 1)), vel: p.vel.clone().multiplyScalar(-0.1), life: 0.5, size: 1.2 * (p.scale ?? 1), sizeEnd: 0.1, color: 0xffc040, colorEnd: 0xff2000, additive: true });
      if ((p.kind === 'orb' || p.kind === 'light' || p.kind === 'water' || p.kind === 'fist') && Math.random() < 0.6) ctx.particles.emit({ pos: pos.clone(), life: 0.4, size: 0.6 * (p.scale ?? 1), sizeEnd: 0.05, color: p.color ?? (p.kind === 'water' ? 0x9ae0ff : 0xffffff), additive: true });
      if (p.kind === 'ice' && Math.random() < 0.5) ctx.particles.emit({ pos: pos.clone(), life: 0.4, size: 0.3, sizeEnd: 0.02, color: 0xdff8ff, additive: true });

      // Hit targets.
      for (const t of ctx.combat.enemiesOf(p.info.team)) {
        if (p.hitSet.has(t)) continue;
        if (t.hitTest(pos, p.radius!)) {
          p.hitSet.add(t);
          ctx.combat.apply(t, { ...p.info, from: pos.clone().sub(p.vel.clone().normalize()) });
          this.impact(p, t, false);
          if (p.dead) break;
        }
      }
      if (p.dead) continue;
      // Ground / sea.
      const th = ctx.world.terrainHeight(pos.x, pos.z);
      const wh = ctx.ocean.heightAt(pos.x, pos.z);
      if (pos.y < th) this.impact(p, null, false);
      else if (pos.y < wh - 0.3) this.impact(p, null, true);
      else if (p.age > p.life!) { p.dead = true; if (p.kind === 'slash' || p.kind === 'fist') this.impact(p, null, false); }
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (p.dead) {
        this.scene.remove(p.mesh);
        p.mesh.traverse((o) => { const m = o as THREE.Mesh; if (m.material && m.material !== mats.cannon && m.material !== mats.rock) (m.material as THREE.Material).dispose(); });
        if (p.kind === 'rock') (p.mesh as THREE.Mesh).geometry.dispose();
        this.list.splice(i, 1);
      }
    }
  }

  /** Initial velocity to hit `target` from `from` at the given speed (lower arc), or null. */
  static ballistic(from: THREE.Vector3, target: THREE.Vector3, speed: number, g: number): THREE.Vector3 | null {
    const d = target.clone().sub(from);
    const h = d.y;
    d.y = 0;
    const x = d.length();
    const v2 = speed * speed;
    const disc = v2 * v2 - g * (g * x * x + 2 * h * v2);
    if (disc < 0) return null;
    const angle = Math.atan((v2 - Math.sqrt(disc)) / (g * x));
    const dir = d.normalize();
    return new THREE.Vector3(dir.x * Math.cos(angle) * speed, Math.sin(angle) * speed, dir.z * Math.cos(angle) * speed);
  }
}
