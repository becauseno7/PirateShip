// Hostile vessels (pirates and the Navy): broadside-circling AI, wrecks that
// stay afloat for boarding, with survivors and a captain's chest aboard.
import * as THREE from 'three';
import { ctx } from '../game/ctx';
import { Ship } from './Ship';
import { Humanoid } from './Humanoid';
import { Enemy, factionLook } from './Enemy';
import { Chest } from '../game/Loot';
import { angleDiff, clamp, pick, rand } from '../core/math';
import { deckHeight } from './shipModel';

const PIRATE_NAMES = ['Black Gull', 'Rusty Kraken', 'Widow\'s Grin', 'Salt Jackal', 'Crimson Eel', 'Mad Petrel', 'Drowned Crown'];
const NAVY_NAMES = ['MNS Resolute', 'MNS Vigilance', 'MNS Iron Tide', 'MNS Dawnwatch', 'MNS Sentinel'];

export class EnemyShip {
  ship: Ship;
  level: number;
  faction: 'pirate' | 'navy';
  orbitDir = Math.random() < 0.5 ? 1 : -1;
  crew: Humanoid[] = [];
  survivors: Enemy[] = [];
  boarded = false;
  chest: Chest | null = null;
  rewarded = false;
  removed = false;
  aggro = false;

  constructor(pos: THREE.Vector3, heading: number, faction: 'pirate' | 'navy', level: number) {
    this.faction = faction;
    this.level = level;
    const big = faction === 'navy';
    this.ship = new Ship(faction === 'navy' ? 'navy' : 'pirate', big ? { L: 28, W: 9, deckY: 2.6, qd: 6, fc: 5 } : { L: rand(19, 23), W: 7, deckY: 2.2, qd: 4.6, fc: 4 }, { name: faction === 'navy' ? pick(NAVY_NAMES) : pick(PIRATE_NAMES) });
    const s = this.ship;
    s.pos.copy(pos);
    s.heading = heading;
    s.hpMax = s.hp = Math.round((big ? 520 : 340) * (1 + level * 0.55));
    s.maxSpeed = (big ? 24 : 27) + level * 0.8;
    s.cannonDamage = Math.round((big ? 20 : 16) * (1 + level * 0.4));
    s.reloadTime = big ? 3.4 : 3.8;
    s.setCannonCount(clamp(2 + Math.floor(level / 2) + (big ? 1 : 0), 2, 5));
    s.sail = 2;
    ctx.world.ships.push(s);
    ctx.combat.register(s);
    s.update(0);
    // Deck crew (decorative until boarding).
    for (let i = 0; i < 3; i++) {
      const h = new Humanoid({ ...factionLook(faction, i === 2 ? 'gunner' : 'brute'), outline: false });
      const lz = -s.dims.L * 0.15 + i * s.dims.L * 0.2;
      h.root.position.set(rand(-1.5, 1.5), deckHeight(s.dims, lz), lz);
      h.root.rotation.y = rand(0, 6);
      s.group.add(h.root);
      this.crew.push(h);
    }
  }

  update(dt: number) {
    const s = this.ship;
    if (s.alive) this.ai();
    s.update(dt);
    for (const h of this.crew) h.update(dt, { speed: 0, grounded: true, vy: 0, action: s.alive && Math.random() < 0.002 ? 'wave' : null, actionT: 0 });
    for (let i = this.survivors.length - 1; i >= 0; i--) {
      const e = this.survivors[i];
      e.update(dt);
      if (!e.alive && e.removeTimer > 4) { e.dispose(); this.survivors.splice(i, 1); }
    }
    this.chest?.update(dt, ctx.camera.position);
  }

  private ai() {
    const s = this.ship;
    const ps = ctx.ship;
    const dx = ps.pos.x - s.pos.x, dz = ps.pos.z - s.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 520) this.aggro = true;
    if (!this.aggro || !ps.alive || ps.docked) { s.rudderInput = Math.sin(ctx.time * 0.1) * 0.2; s.sail = 1; return; }
    const toPlayer = Math.atan2(dx, dz);
    const orbit = Math.PI / 2 - clamp((dist - 120) / 160, -0.7, 0.7);
    let desired = toPlayer + this.orbitDir * orbit;
    // Avoid land.
    const ahead = s.pos.clone().addScaledVector(s.forward, 90);
    if (ctx.world.terrainHeight(ahead.x, ahead.z) > -3) { desired = s.heading + this.orbitDir * 1.2; }
    s.rudderInput = clamp(-angleDiff(s.heading, desired) * 2, -1, 1);
    s.sail = dist > 300 ? 3 : 2;
    // Fire when the player's ship is off one of our beams.
    const { lx, lz } = s.toLocalFlat(ps.pos.x, ps.pos.z);
    if (dist < 250 && Math.abs(lx) > Math.abs(lz) * 1.1) {
      const side: 1 | -1 = lx > 0 ? 1 : -1;
      const lead = ps.pos.clone().addScaledVector(ps.forward, ps.speed * dist / 85);
      lead.y = ps.pos.y + 2;
      s.fireBroadside(side, lead, 'enemy');
    }
  }

  /** Called when the wreck is first boarded by the player. */
  board() {
    if (this.boarded) return;
    this.boarded = true;
    const s = this.ship;
    for (const h of this.crew) s.group.remove(h.root);
    this.crew = [];
    const n = 2 + Math.min(2, Math.floor(this.level / 2));
    for (let i = 0; i < n; i++) {
      const lz = -s.dims.L * 0.25 + i * (s.dims.L * 0.45 / n);
      const p = s.toWorld(new THREE.Vector3(rand(-1.2, 1.2), deckHeight(s.dims, lz), lz));
      const type = i === n - 1 && this.level > 1 ? 'gunner' : 'brute';
      const e = new Enemy(factionLook(this.faction, type), type, this.level, p);
      e.aggro = true;
      e.leashed = false;
      e.groundShip = s;
      e.grounded = true;
      e.onDeath = (en) => ctx.game.onEnemyKilled(en);
      this.survivors.push(e);
    }
  }

  ensureChest() {
    if (this.chest) return;
    const s = this.ship;
    const lz = -s.dims.L / 2 + s.dims.qd * 0.5;
    this.chest = new Chest('wreck', new THREE.Vector3(0, deckHeight(s.dims, lz), lz), Math.PI, 3, s.group);
  }

  dispose() {
    this.removed = true;
    const s = this.ship;
    ctx.combat.unregister(s);
    ctx.world.ships = ctx.world.ships.filter((x) => x !== s);
    for (const e of this.survivors) e.dispose();
    this.chest?.dispose();
    s.dispose();
  }
}
