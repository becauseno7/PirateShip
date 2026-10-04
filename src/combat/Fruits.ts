// Devil fruit powers: basic-attack flavor, three abilities and an awakened
// ultimate for each of the five fruits.
import * as THREE from 'three';
import { ctx } from '../game/ctx';
import { FRUITS, FruitId } from '../game/data';
import type { Player } from '../entities/Player';
import { ModelRig } from '../entities/ModelRig';
import type { DamageInfo, Target } from './Combat';
import { rand, smoothstep, easeOutCubic, easeInCubic } from '../core/math';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function info(p: Player, amount: number, extra: Partial<DamageInfo> = {}): DamageInfo {
  return { amount: Math.round(amount * p.damageMult * rand(0.92, 1.08)), from: p.pos.clone(), team: 'player', source: 'player', shipDamageMult: 0.85, ...extra };
}

/** Basic attack hit effect + damage, called at the impact frame of each combo hit. */
export function basicHit(p: Player, comboIdx: number) {
  const f = p.fruit;
  const fwd = p.facing();
  const origin = p.pos.clone().add(V(0, 1.1 * p.scale, 0)).addScaledVector(fwd, 0.6 * p.scale);
  const def = FRUITS[f];
  const awake = p.awakened;
  const col = awake ? def.awakenColor : def.color;
  const titan = p.titan > 0;
  let range = (f === 'stretch' ? 4.8 : 2.6) * (titan ? 3 : 1);
  const dmg = (comboIdx === 2 ? 30 : 20) * (titan ? 4 : 1);
  const extra: Partial<DamageInfo> = { knockback: comboIdx === 2 ? 7 : 2.5, stun: 0.25 };
  switch (f) {
    case 'blaze': extra.element = 'fire'; extra.burn = comboIdx === 2 ? 2 : 0; break;
    case 'thunder': extra.element = 'thunder'; break;
    case 'frost': extra.element = 'ice'; if (comboIdx === 2) extra.freeze = 0.8; break;
    case 'quake': extra.element = 'quake'; extra.knockback = comboIdx === 2 ? 14 : 4; range += 1; break;
    case 'stretch': extra.element = 'stretch'; break;
  }
  if (comboIdx === 2) extra.launch = 6;
  const hits = ctx.combat.cone(origin, fwd, range, titan ? 1.2 : 0.95, info(p, dmg, extra));
  // Visuals.
  const hitPos = origin.clone().addScaledVector(fwd, range * 0.7);
  ctx.fx.slash(origin.clone().addScaledVector(fwd, 0.3), p.yaw, col, range * 0.9, comboIdx === 1 ? 0.4 : -0.3, 0.18, Math.PI * 0.7);
  switch (f) {
    case 'blaze': ctx.particles.burst(hitPos, 14, { speed: 5, life: 0.4, size: 0.9, sizeEnd: 0.1, color: 0xffd070, colorEnd: 0xff3000, additive: true, drag: 3 }); break;
    case 'thunder':
      ctx.fx.lightning(origin, hitPos.clone().add(V(rand(-1, 1), rand(-0.5, 0.5), rand(-1, 1))), col, 0.06, 0.15);
      if (hits[0]) chainLightning(p, hits[0], 1, 10, 12, new Set(hits));
      break;
    case 'frost': ctx.particles.burst(hitPos, 10, { speed: 4, life: 0.5, size: 0.4, sizeEnd: 0.05, color: 0xdff8ff, additive: true, gravity: 4 }); break;
    case 'quake':
      ctx.fx.sphere(hitPos, 1.6, 0xffffff, 0.2, 0.5);
      if (comboIdx === 2) { ctx.fx.shockwave(hitPos, 4, 0xffffff, 0.35, 1, false); ctx.audio.sfx('glass', hitPos, 0.5); }
      break;
    case 'stretch':
      stretchArm(p, hitPos, 0.18, p.awakened ? 0xffffff : undefined);
      break;
  }
  if (titan) { ctx.fx.shockwave(p.pos.clone().addScaledVector(fwd, 5).setY(p.pos.y + 0.3), 8, 0xffffff, 0.4); ctx.fx.shake(0.5); }
  ctx.audio.sfx(hits.length ? 'punch' : 'whoosh', origin, hits.length ? 1 : 0.6);
  if (hits.length) ctx.fx.hitstop = Math.max(ctx.fx.hitstop, comboIdx === 2 ? 0.07 : 0.035);
}

/** The rubbery stretching arm: a tube from shoulder to target and back. */
export function stretchArm(p: Player, to: THREE.Vector3, dur = 0.35, color?: number) {
  const rig = p.rig;
  if (rig instanceof ModelRig) {
    // The captain model stretches its own arm: shoot out to the target and snap back.
    const s0 = new THREE.Vector3();
    ctx.fx.custom(new THREE.Group(), dur, (t) => {
      const s = rig.worldPos('shR', s0);
      const k = t < 0.5 ? easeOutCubic(t * 2) : 1 - easeInCubic((t - 0.5) * 2);
      rig.stretchTo(k > 0.02 ? s.clone().lerp(to, k) : null);
    }, () => rig.stretchTo(null));
    return;
  }
  const skin = color ?? new THREE.Color(p.look.skin as any).getHex();
  const g = new THREE.Group();
  const armMat = new THREE.MeshToonMaterial({ color: skin });
  const sleeveMat = new THREE.MeshToonMaterial({ color: new THREE.Color(p.look.shirt as any) });
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * p.scale, 0.07 * p.scale, 1, 8).translate(0, 0.5, 0).rotateX(Math.PI / 2), armMat);
  const fist = new THREE.Mesh(new THREE.SphereGeometry(0.16 * p.scale, 12, 10), armMat);
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.09 * p.scale, 0.09 * p.scale, 0.3 * p.scale, 8).rotateX(Math.PI / 2), sleeveMat);
  g.add(tube, fist, sleeve);
  p.rig.armR.visible = false;
  const start = () => p.rig.worldPos('shR');
  ctx.fx.custom(g, dur, (t) => {
    const s = start();
    const k = t < 0.5 ? easeOutCubic(t * 2) : 1 - easeInCubic((t - 0.5) * 2);
    const end = s.clone().lerp(to, k);
    const len = Math.max(0.01, s.distanceTo(end));
    tube.position.copy(s);
    tube.lookAt(end);
    tube.scale.set(1, 1, len);
    sleeve.position.copy(s);
    sleeve.lookAt(end);
    fist.position.copy(end);
  }, () => { p.rig.armR.visible = true; armMat.dispose(); sleeveMat.dispose(); });
}

function chainLightning(p: Player, first: Target, jumps: number, range: number, dmg: number, hit: Set<Target>) {
  let cur = first;
  for (let i = 0; i < jumps; i++) {
    const c = cur.center(V());
    const next = ctx.combat.nearest('player', c, range, undefined, Math.PI, (t) => !hit.has(t));
    if (!next) break;
    hit.add(next);
    const n = next.center(V());
    ctx.fx.lightning(c, n, FRUITS.thunder.color, 0.1, 0.25);
    ctx.combat.apply(next, info(p, dmg, { element: 'thunder', stun: 0.4 }));
    cur = next;
  }
}

function strikeBolt(p: Player, at: THREE.Vector3, dmg: number, radius: number, color: number, height = 40) {
  const top = at.clone().add(V(rand(-3, 3), height, rand(-3, 3)));
  ctx.fx.lightning(top, at, color, 0.22, 0.3, 2);
  ctx.fx.sphere(at, radius, color, 0.25, 0.6);
  ctx.fx.light(at, color, 60, 0.2, 30);
  ctx.particles.burst(at, 12, { speed: 8, life: 0.4, size: 0.4, sizeEnd: 0.05, color: 0xffffff, colorEnd: color, additive: true });
  ctx.combat.sphere(at, radius, info(p, dmg, { element: 'thunder', stun: 0.6, knockback: 3 }));
  ctx.audio.sfx('thunder', at, 0.6);
}

export function castAbility(p: Player, slot: 0 | 1 | 2 | 3): boolean {
  const f: FruitId = p.fruit;
  const def = FRUITS[f];
  const col = p.awakened ? def.awakenColor : def.color;
  const col2 = def.color2;
  const target = p.autoTarget(45);
  const aimDir = p.aimDirection(target);
  const handPos = () => p.rig.worldPos('haR');
  const groundAt = (maxD: number) => {
    if (target) { const c = target.center(V()); c.y = Math.max(ctx.world.terrainHeight(c.x, c.z), ctx.ocean.heightAt(c.x, c.z)); if (target.kind === 'ship') c.y = target.center(V()).y - 1; return c; }
    return ctx.cam.aimPoint(maxD, p.pos);
  };
  p.faceDir(aimDir);

  if (slot === 3) return castUltimate(p, f, col);

  switch (f) {
    // -------------------------------------------------------------- BLAZE
    case 'blaze':
      if (slot === 0) {
        p.play('atkFireball', 'castR', 0.55, [[0.45, () => {
          const from = handPos().addScaledVector(aimDir, 0.5);
          const dir = target ? target.center(V()).sub(from).normalize() : aimDir.clone().setY(aimDir.y * 0.6).normalize();
          ctx.projectiles.spawn({ kind: 'fireball', pos: from, vel: dir.multiplyScalar(48), radius: 1.6, scale: p.awakened ? 1.8 : 1.2, aoe: p.awakened ? 7 : 5, color: col, info: info(p, 70, { element: 'fire', burn: 3, knockback: 6 }) });
          ctx.audio.sfx('fire', from, 1);
        }]]);
      } else if (slot === 1) {
        const at = groundAt(32);
        p.play('atkPillar', 'castUp', 0.8, [[0.35, () => {
          const r = p.awakened ? 8 : 6;
          const pillar = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r, 1, 20, 1, true).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
          pillar.position.copy(at);
          ctx.fx.custom(pillar, 1.0, (t) => { pillar.scale.set(1 - t * 0.5, 22 * Math.sin(Math.min(1, t * 2.5) * Math.PI / 2), 1 - t * 0.5); (pillar.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - t); });
          for (let i = 0; i < 60; i++) ctx.particles.emit({ pos: at.clone().add(V(rand(-r, r) * 0.6, rand(0, 2), rand(-r, r) * 0.6)), vel: V(rand(-1, 1), rand(10, 28), rand(-1, 1)), life: rand(0.6, 1.2), size: rand(1, 2.2), sizeEnd: 0.2, color: 0xffe080, colorEnd: 0xff2000, additive: true, drag: 1 });
          ctx.fx.shockwave(at.clone().add(V(0, 0.3, 0)), r * 1.4, col, 0.5);
          ctx.fx.light(at.clone().add(V(0, 4, 0)), 0xff7020, 120, 0.8, 50);
          ctx.combat.sphere(at.clone().add(V(0, 2, 0)), r, info(p, 95, { element: 'fire', burn: 4, launch: 14 }));
          ctx.audio.sfx('fire', at, 1.4); ctx.audio.sfx('explosion', at, 0.5);
          ctx.fx.shake(0.6);
        }], [0.65, () => { ctx.combat.sphere(at.clone().add(V(0, 3, 0)), 6, info(p, 40, { element: 'fire', burn: 2 })); }]]);
      } else {
        dashAttack(p, aimDir, 15, 0.28, col, (from, to) => {
          for (let i = 0; i < 24; i++) {
            const q = from.clone().lerp(to, i / 24).add(V(rand(-0.5, 0.5), rand(0, 1.5), rand(-0.5, 0.5)));
            ctx.particles.emit({ pos: q, vel: V(0, rand(1, 3), 0), life: rand(0.5, 1.1), size: rand(0.8, 1.6), sizeEnd: 0.1, color: 0xffd060, colorEnd: 0xff2000, additive: true });
          }
          ctx.combat.line(from, to, 2.2, info(p, 45, { element: 'fire', burn: 3, knockback: 5 }));
          ctx.audio.sfx('fire', to, 0.9);
        });
      }
      return true;

    // ------------------------------------------------------------ STRETCH
    case 'stretch':
      if (slot === 0) {
        p.play('atkPistol', 'stretch', 0.55, [[0.2, () => {
          const reach = p.awakened ? 32 : 24;
          const from = p.rig.worldPos('shR');
          const end = target ? target.center(V()) : from.clone().addScaledVector(aimDir, reach);
          if (from.distanceTo(end) > reach) end.copy(from).addScaledVector(end.clone().sub(from).normalize(), reach);
          stretchArm(p, end, 0.4, p.awakened ? 0xffffff : undefined);
          ctx.audio.sfx('stretch', from, 1);
          setTimeout(() => {
            ctx.combat.line(from, end, 1.6, info(p, 62, { element: 'stretch', knockback: 9, stun: 0.5 }));
            ctx.fx.sphere(end, 2.5, col, 0.25, 0.6);
            ctx.fx.shockwave(end, 3, 0xffffff, 0.3, 1, false);
            ctx.audio.sfx('punch', end, 1.2);
            ctx.fx.hitstop = 0.05;
          }, 110);
        }]]);
      } else if (slot === 1) {
        const hitSet = new Set<Target>();
        const events: [number, () => void][] = [];
        for (let i = 0; i < 18; i++) {
          events.push([0.08 + i * 0.048, () => {
            const fwd = p.facing();
            const from = p.rig.worldPos('shR');
            const side = V(-fwd.z, 0, fwd.x);
            const to = from.clone().addScaledVector(fwd, rand(5, 9) * (p.awakened ? 1.4 : 1)).addScaledVector(side, rand(-2.2, 2.2)).add(V(0, rand(-1, 1.2), 0));
            stretchArm(p, to, 0.14, p.awakened ? 0xffffff : undefined);
            ctx.fx.sphere(to, 0.8, col, 0.12, 0.5);
            if (i % 2 === 0) { hitSet.clear(); ctx.combat.cone(p.pos.clone().add(V(0, 1, 0)), fwd, 9 * (p.awakened ? 1.4 : 1), 0.6, info(p, 14, { element: 'stretch', stun: 0.3, knockback: 1 }), hitSet); }
            if (i % 3 === 0) ctx.audio.sfx('punch', to, 0.5);
          }]);
        }
        p.play('atkGatling', 'gatling', 1.1, events);
      } else {
        const at = groundAt(28);
        rocketLeap(p, at, 0.5, () => {
          ctx.fx.shockwave(at.clone().add(V(0, 0.3, 0)), 9, col, 0.5);
          ctx.fx.sphere(at, 5, 0xffffff, 0.3, 0.4);
          ctx.particles.burst(at, 30, { speed: 10, up: 3, life: 0.8, size: 0.7, sizeEnd: 0.1, color: 0xd8c8a8, gravity: 10 });
          ctx.combat.sphere(at.clone().add(V(0, 1, 0)), 7, info(p, 72, { element: 'stretch', launch: 10, knockback: 8 }));
          ctx.audio.sfx('boing', at, 1); ctx.audio.sfx('quake', at, 0.5);
          ctx.fx.shake(0.7);
        });
      }
      return true;

    // ------------------------------------------------------------ THUNDER
    case 'thunder':
      if (slot === 0) {
        p.play('atkSpear', 'castR', 0.42, [[0.35, () => {
          const from = handPos();
          let end: THREE.Vector3;
          const hit = new Set<Target>();
          if (target) {
            end = target.center(V());
            hit.add(target);
            ctx.combat.apply(target, info(p, 78, { element: 'thunder', stun: 0.8, knockback: 4 }));
            chainLightning(p, target, p.awakened ? 4 : 2, 14, 48, hit);
          } else {
            end = from.clone().addScaledVector(aimDir, 40);
            ctx.combat.line(from, end, 1.5, info(p, 78, { element: 'thunder', stun: 0.8 }));
          }
          ctx.fx.lightning(from, end, col, 0.18, 0.3, 1.2);
          ctx.fx.lightning(from, end, col2, 0.08, 0.2, 2);
          ctx.fx.light(from, col, 50, 0.2, 25);
          ctx.audio.sfx('zap', from, 1); ctx.audio.sfx('thunder', end, 0.4);
        }]]);
      } else if (slot === 1) {
        const at = groundAt(34);
        const r = p.awakened ? 14 : 10;
        const tg = ctx.fx.telegraphCircle(at, r, 3.2, col);
        p.play('atkStorm', 'castUp', 0.6, [[0.4, () => {
          let n = 0;
          const iv = setInterval(() => {
            if (n++ > (p.awakened ? 22 : 15) || !p.alive) { clearInterval(iv); ctx.fx.removeTelegraph(tg); return; }
            const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
            const q = at.clone().add(V(Math.cos(a) * d, 0, Math.sin(a) * d));
            q.y = Math.max(ctx.world.terrainHeight(q.x, q.z), ctx.ocean.heightAt(q.x, q.z));
            const near = ctx.combat.nearest('player', q, 4);
            if (near) near.center(q);
            strikeBolt(p, q, 32, 3.2, col);
          }, 180);
        }]]);
      } else {
        const from = p.pos.clone();
        const dist = p.awakened ? 22 : 16;
        const to = from.clone().addScaledVector(aimDir.clone().setY(0).normalize(), dist);
        const g = ctx.world.groundAt(to.x, to.z, to.y + 5);
        to.y = Math.max(g.h, from.y);
        ctx.fx.lightning(from.clone().add(V(0, 1, 0)), to.clone().add(V(0, 1, 0)), col, 0.35, 0.35, 0.6);
        ctx.combat.line(from.clone().add(V(0, 1, 0)), to.clone().add(V(0, 1, 0)), 2, info(p, 42, { element: 'thunder', stun: 0.7 }));
        p.teleport(to);
        p.invuln = 0.3;
        ctx.fx.sphere(to.clone().add(V(0, 1, 0)), 2.5, col, 0.25, 0.7);
        ctx.audio.sfx('zap', to, 1.2);
        p.play('atkFlash', 'dash', 0.25, []);
      }
      return true;

    // -------------------------------------------------------------- FROST
    case 'frost':
      if (slot === 0) {
        p.play('atkIce', 'castR', 0.45, [[0.35, () => {
          const from = handPos();
          const base = target ? target.center(V()).sub(from).normalize() : aimDir.clone();
          const n = p.awakened ? 5 : 3;
          for (let i = 0; i < n; i++) {
            const a = (i - (n - 1) / 2) * 0.12;
            const d = base.clone().applyAxisAngle(V(0, 1, 0), a);
            ctx.projectiles.spawn({ kind: 'ice', pos: from.clone(), vel: d.multiplyScalar(60), radius: 0.9, scale: 1.1, info: info(p, 36, { element: 'ice', freeze: 0.5, knockback: 2 }) });
          }
          ctx.audio.sfx('ice', from, 1);
        }]]);
      } else if (slot === 1) {
        p.play('atkIceAge', 'cast', 0.75, [[0.35, () => {
          const fwd = aimDir.clone().setY(0).normalize();
          const range = p.awakened ? 26 : 18;
          ctx.combat.cone(p.pos.clone().add(V(0, 1, 0)), fwd, range, 0.62, info(p, 60, { element: 'ice', freeze: 3.2 }));
          iceSpikes(p.pos, fwd, range, 0.62);
          ctx.audio.sfx('ice', p.pos, 1.5); ctx.audio.sfx('shatter', p.pos, 0.5);
          ctx.fx.shake(0.4);
        }]]);
      } else {
        dashAttack(p, aimDir, 17, 0.35, col, (from, to) => {
          const d = to.clone().sub(from); d.y = 0;
          const n = Math.floor(d.length() / 1.5);
          for (let i = 0; i < n; i++) {
            const q = from.clone().lerp(to, i / n);
            q.y = Math.max(ctx.world.terrainHeight(q.x, q.z), ctx.ocean.heightAt(q.x, q.z)) + 0.05;
            iceSlab(q, 1.6, 3.5);
          }
          ctx.combat.line(from, to, 2.4, info(p, 36, { element: 'ice', freeze: 1.2 }));
          ctx.audio.sfx('ice', to, 1);
        });
      }
      return true;

    // -------------------------------------------------------------- QUAKE
    case 'quake':
      if (slot === 0) {
        p.play('atkQuake', 'castR', 0.55, [[0.4, () => {
          const fwd = aimDir.clone().setY(0).normalize();
          const from = handPos();
          const range = p.awakened ? 20 : 14;
          ctx.combat.cone(p.pos.clone().add(V(0, 1, 0)), fwd, range, 0.55, info(p, 82, { element: 'quake', knockback: 20, stun: 0.6, launch: 5 }));
          airCrack(from.clone().addScaledVector(fwd, 1), fwd, 3.5);
          for (let i = 0; i < 4; i++) ctx.fx.sphere(from.clone().addScaledVector(fwd, 2 + i * range / 4), 1.2 + i, 0xffffff, 0.3 + i * 0.05, 0.35);
          ctx.particles.burst(from.clone().addScaledVector(fwd, range / 2), 30, { speed: 9, life: 0.6, size: 0.5, sizeEnd: 0.05, color: 0xffffff, additive: true, spread: 4 });
          ctx.audio.sfx('glass', from, 1); ctx.audio.sfx('quake', from, 0.7);
          ctx.fx.shake(0.8);
        }]]);
      } else if (slot === 1) {
        p.play('atkSeaquake', 'slam', 0.8, [[0.55, () => {
          const r = p.awakened ? 22 : 16;
          const at = p.pos.clone();
          ctx.fx.shockwave(at.clone().add(V(0, 0.3, 0)), r, 0xffffff, 0.7);
          ctx.fx.shockwave(at.clone().add(V(0, 0.6, 0)), r * 0.7, col2, 0.5);
          groundCracks(at, r);
          ctx.combat.sphere(at.clone().add(V(0, 1, 0)), r, info(p, 90, { element: 'quake', launch: 11, knockback: 10 }));
          // At sea: the quake raises a tsunami that batters nearby ships.
          if (p.groundShip || at.y < 6) {
            for (const s of ctx.world.ships) {
              if (s.team === 'enemy' && s.alive && s.pos.distanceTo(at) < 75) {
                ctx.fx.splash(s.pos.clone(), 3);
                ctx.combat.apply(s, info(p, 150, { element: 'water' }));
              }
            }
            ctx.fx.shockwave(V(at.x, 0.4, at.z), 75, 0xbfe8ff, 1.4, 2);
          }
          ctx.audio.sfx('quake', at, 1.5); ctx.audio.sfx('glass', at, 0.8);
          ctx.fx.shake(1.2);
        }]]);
      } else {
        const at = groundAt(22);
        rocketLeap(p, at, 0.6, () => {
          ctx.fx.shockwave(at.clone().add(V(0, 0.3, 0)), 10, 0xffffff, 0.5);
          groundCracks(at, 8);
          ctx.combat.sphere(at.clone().add(V(0, 1, 0)), 8, info(p, 86, { element: 'quake', launch: 12, knockback: 10 }));
          ctx.audio.sfx('quake', at, 1.2); ctx.audio.sfx('glass', at, 0.6);
          ctx.fx.shake(0.9);
        }, 'slam');
      }
      return true;
  }
  return false;
}

function castUltimate(p: Player, f: FruitId, col: number): boolean {
  const def = FRUITS[f];
  ctx.ui.banner(def.ultimate.name.toUpperCase(), def.awakenedName, 1.6, 'ult');
  ctx.audio.sfx('power', p.pos, 1.2);
  ctx.fx.flash('#ffffff', 0.35, 0.4);
  ctx.timeScale = 0.35;
  setTimeout(() => (ctx.timeScale = 1), 500);
  const target = p.autoTarget(60);
  const at = target ? target.center(V()).setY(ctx.world.terrainHeight(target.center(V()).x, target.center(V()).z)) : ctx.cam.aimPoint(35, p.pos);
  at.y = Math.max(at.y, ctx.ocean.heightAt(at.x, at.z));
  p.invuln = 2.5;
  switch (f) {
    case 'blaze': {
      p.play('ult', 'castUp', 2.4, [[0.15, () => {
        const sun = new THREE.Group();
        const core = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), new THREE.MeshBasicMaterial({ color: 0xfff6c0 }));
        const halo = new THREE.Mesh(new THREE.SphereGeometry(1.35, 32, 24), new THREE.MeshBasicMaterial({ color: 0xff7a20, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
        sun.add(core, halo);
        const top = at.clone().add(V(0, 38, 0));
        sun.position.copy(top);
        ctx.fx.custom(sun, 2.0, (t) => {
          const grow = smoothstep(0, 0.55, t);
          sun.scale.setScalar(1 + grow * 13);
          if (t > 0.6) sun.position.lerpVectors(top, at, easeInCubic((t - 0.6) / 0.4));
          halo.scale.setScalar(1 + Math.sin(t * 40) * 0.05);
          if (Math.random() < 0.9) ctx.particles.emit({ pos: sun.position.clone().add(V(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(sun.scale.x)), vel: V(rand(-4, 4), rand(-4, 4), rand(-4, 4)), life: 0.8, size: 3, sizeEnd: 0.3, color: 0xffe080, colorEnd: 0xff3000, additive: true });
        }, () => {
          ctx.fx.explosion(at, 6, 0xff6010);
          ctx.fx.shockwave(at.clone().add(V(0, 0.5, 0)), 40, 0xffa040, 1.2, 2);
          ctx.fx.flash('#ffd080', 0.8, 0.8);
          ctx.combat.sphere(at, 24, info(p, 620, { element: 'fire', burn: 6, launch: 18, knockback: 20 }));
          ctx.audio.sfx('explosion', at, 2); ctx.audio.sfx('fire', at, 2);
          ctx.fx.shake(2.2);
        });
      }]]);
      break;
    }
    case 'stretch': {
      p.play('ult', 'powerup', 1.2, [[0.6, () => {
        p.titan = 14;
        ctx.fx.sphere(p.pos.clone().add(V(0, 3, 0)), 14, 0xffffff, 0.6, 0.8);
        ctx.fx.shockwave(p.pos.clone().add(V(0, 0.3, 0)), 18, 0xffffff, 0.8);
        ctx.combat.sphere(p.pos.clone().add(V(0, 2, 0)), 13, info(p, 220, { element: 'stretch', launch: 16, knockback: 16 }));
        ctx.audio.sfx('boing', p.pos, 1.5); ctx.audio.sfx('drum', p.pos, 1);
        ctx.fx.shake(1.2);
      }]]);
      break;
    }
    case 'thunder': {
      p.play('ult', 'castUp', 2.6, [[0.1, () => {
        let n = 0;
        const iv = setInterval(() => {
          if (n++ > 34 || !p.alive) {
            clearInterval(iv);
            const final = at.clone();
            for (let i = 0; i < 6; i++) ctx.fx.lightning(final.clone().add(V(rand(-6, 6), 70, rand(-6, 6))), final, col, 1.2, 0.6, 3);
            ctx.fx.sphere(final, 22, 0xe6f7ff, 0.6, 0.8);
            ctx.fx.shockwave(final.clone().add(V(0, 0.5, 0)), 30, col, 0.9, 2);
            ctx.combat.sphere(final, 22, info(p, 340, { element: 'thunder', stun: 2, launch: 12 }));
            ctx.fx.flash('#e6f7ff', 0.9, 0.6);
            ctx.audio.sfx('thunder', final, 2);
            ctx.fx.shake(2);
            return;
          }
          const tgt = ctx.combat.nearest('player', p.pos, 50, undefined, Math.PI, () => Math.random() < 0.6);
          const q = tgt ? tgt.center(V()) : p.pos.clone().add(V(rand(-30, 30), 0, rand(-30, 30)));
          if (!tgt) q.y = Math.max(ctx.world.terrainHeight(q.x, q.z), 0);
          strikeBolt(p, q, 70, 4, col, 60);
        }, 60);
      }]]);
      break;
    }
    case 'frost': {
      p.play('ult', 'castUp', 2.2, [[0.3, () => {
        const c = p.pos.clone();
        ctx.fx.shockwave(c.clone().add(V(0, 0.3, 0)), 28, 0xbfeaff, 1.0, 2);
        const hits = ctx.combat.sphere(c.clone().add(V(0, 2, 0)), 28, info(p, 150, { element: 'ice', freeze: 4.5 }));
        for (let i = 0; i < 40; i++) {
          const a = Math.random() * Math.PI * 2, d = rand(3, 26);
          const q = c.clone().add(V(Math.cos(a) * d, 0, Math.sin(a) * d));
          q.y = Math.max(ctx.world.terrainHeight(q.x, q.z), ctx.ocean.heightAt(q.x, q.z));
          iceSlab(q, rand(1.5, 3.5), 3.2, rand(2, 6));
        }
        ctx.env.forceStorm = 0.5;
        ctx.audio.sfx('ice', c, 2);
        ctx.fx.flash('#d6f6ff', 0.6, 0.8);
        setTimeout(() => {
          ctx.env.forceStorm = -1;
          for (const h of hits) if (h.alive) ctx.combat.apply(h, info(p, 360, { element: 'ice', knockback: 10 }));
          ctx.combat.sphere(c.clone().add(V(0, 2, 0)), 28, info(p, 120, { element: 'ice' }));
          ctx.particles.burst(c.clone().add(V(0, 2, 0)), 120, { speed: 22, life: 1.2, size: 0.6, sizeEnd: 0.05, color: 0xffffff, colorEnd: 0x9fe6ff, additive: true, spread: 30, gravity: 6 });
          ctx.audio.sfx('shatter', c, 2);
          ctx.fx.shake(1.5);
        }, 1600);
      }]]);
      break;
    }
    case 'quake': {
      p.play('ult', 'punchR', 1.6, [[0.3, () => {
        const c = p.pos.clone().add(V(0, 2, 0));
        for (let i = 0; i < 10; i++) airCrack(c.clone().add(V(0, rand(2, 16), 0)), V(Math.cos(i * 0.63), rand(-0.3, 0.3), Math.sin(i * 0.63)), 18);
        ctx.audio.sfx('glass', c, 2);
        ctx.fx.flash('#ffffff', 0.6, 0.5);
        setTimeout(() => {
          ctx.fx.shockwave(p.pos.clone().add(V(0, 0.3, 0)), 34, 0xffffff, 1.2, 2);
          ctx.fx.sphere(c, 30, 0xfff9e0, 0.7, 0.6);
          groundCracks(p.pos, 30);
          ctx.combat.sphere(c, 32, info(p, 720, { element: 'quake', launch: 18, knockback: 26 }));
          for (const s of ctx.world.ships) if (s.team === 'enemy' && s.alive && s.pos.distanceTo(p.pos) < 110) ctx.combat.apply(s, info(p, 380, { element: 'water' }));
          ctx.audio.sfx('quake', c, 2.5);
          ctx.fx.shake(2.5);
        }, 450);
      }]]);
      break;
    }
  }
  return true;
}

// ----------------------------------------------------------------- helpers
function dashAttack(p: Player, dir: THREE.Vector3, dist: number, dur: number, col: number, onDone: (from: THREE.Vector3, to: THREE.Vector3) => void) {
  const from = p.pos.clone().add(V(0, 1, 0));
  const flat = dir.clone().setY(0).normalize();
  p.invuln = dur + 0.1;
  p.dash(flat, dist / dur, dur);
  p.play('atkDash', 'dash', dur, [[0.99, () => onDone(from, p.pos.clone().add(V(0, 1, 0)))]]);
  ctx.audio.sfx('dash', p.pos, 1);
  ctx.fx.sphere(from, 1.5, col, 0.2, 0.5);
}

function rocketLeap(p: Player, at: THREE.Vector3, dur: number, onLand: () => void, anim = 'dash') {
  const from = p.pos.clone();
  const d = at.clone().sub(from);
  const peak = Math.max(6, d.length() * 0.35);
  p.leapTo(from, at, peak, dur, onLand);
  p.play('atkLeap', anim, dur + 0.1, []);
  p.invuln = dur;
  ctx.audio.sfx(p.fruit === 'stretch' ? 'stretch' : 'jump', from, 1);
}

function iceSlab(at: THREE.Vector3, size: number, life: number, height = 1.2) {
  const m = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xcff4ff, emissive: 0x3a9ad8, emissiveIntensity: 0.35, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.85 }));
  m.position.copy(at);
  m.rotation.set(rand(-0.3, 0.3), rand(0, 6), rand(-0.3, 0.3));
  ctx.fx.custom(m, life, (t) => {
    const grow = smoothstep(0, 0.08, t), fade = 1 - smoothstep(0.85, 1, t);
    m.scale.set(size * 0.6 * grow, height * grow * fade + 0.01, size * 0.6 * grow);
  }, () => (m.material as THREE.Material).dispose());
}

function iceSpikes(origin: THREE.Vector3, fwd: THREE.Vector3, range: number, half: number) {
  for (let i = 0; i < 26; i++) {
    const a = rand(-half, half), d = rand(2, range);
    const dir = fwd.clone().applyAxisAngle(V(0, 1, 0), a);
    const q = origin.clone().addScaledVector(dir, d);
    q.y = Math.max(ctx.world.terrainHeight(q.x, q.z), ctx.ocean.heightAt(q.x, q.z));
    setTimeout(() => iceSlab(q, rand(1, 2.4), 2.8, rand(1.5, 4)), d * 18);
  }
}

function airCrack(at: THREE.Vector3, dir: THREE.Vector3, len: number) {
  // Spidery white cracks hanging in the air like shattered glass.
  for (let i = 0; i < 7; i++) {
    const d = dir.clone().add(V(rand(-0.8, 0.8), rand(-0.8, 0.8), rand(-0.8, 0.8))).normalize();
    ctx.fx.lightning(at, at.clone().addScaledVector(d, len * rand(0.5, 1)), 0xffffff, 0.05, 0.6, 0.6);
  }
}

function groundCracks(at: THREE.Vector3, r: number) {
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + rand(-0.2, 0.2);
    const end = at.clone().add(V(Math.cos(a) * r, 0, Math.sin(a) * r));
    end.y = Math.max(ctx.world.terrainHeight(end.x, end.z), ctx.ocean.heightAt(end.x, end.z)) + 0.2;
    ctx.fx.lightning(at.clone().add(V(0, 0.2, 0)), end, 0xfff4d0, 0.12, 0.9, 0.4);
  }
  ctx.particles.burst(at, 50, { speed: 12, up: 6, life: 1.2, size: 0.8, sizeEnd: 0.2, color: 0x9a8a78, gravity: 16, spread: r * 0.6 });
}
