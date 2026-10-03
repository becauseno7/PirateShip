// Open-sea encounter director: spawns pirate/navy ships, Sea Kings and
// flotsam along the current leg of the voyage, scales them to progress and
// pays out bounty when they go down.
import * as THREE from 'three';
import { ctx } from './ctx';
import { EnemyShip } from '../entities/EnemyShip';
import { SeaMonster, SeaSerpent, Kraken } from '../entities/SeaMonster';
import { FloatingLoot, type Reward } from './Loot';
import { ISLANDS } from './data';
import { chance, pick, rand, randInt } from '../core/math';

const PALETTES: ('green' | 'purple' | 'ice' | 'gold')[] = ['green', 'green', 'purple', 'ice', 'purple', 'gold', 'gold'];

export class Encounters {
  ships: EnemyShip[] = [];
  monsters: SeaMonster[] = [];
  floats: FloatingLoot[] = [];
  enabled = true;
  private timer = 25;
  private floatTimer = 8;
  private scriptedFirst = false;
  private battleMusic = false;
  private calmT = 0;

  /** Leg index = the island we are heading towards. */
  get level() { return Math.max(1, Math.min(6, ctx.progress.nextIsland)); }

  update(dt: number) {
    const ship = ctx.ship;
    const atSea = !ship.docked && !ctx.world.islandAt(ship.pos.x, ship.pos.z, 120);
    if (this.enabled && atSea && !ctx.progress.finished) {
      // The very first voyage gets a guaranteed pirate ambush as a tutorial.
      if (!this.scriptedFirst && ctx.progress.nextIsland === 1 && ctx.progress.shipsSunk === 0) {
        const home = ISLANDS[0];
        const d = Math.hypot(ship.pos.x - home.pos[0], ship.pos.z - home.pos[1]);
        if (d > 520) {
          this.scriptedFirst = true;
          this.spawnShip('pirate', 1);
          ctx.ui.say('Kaito', 'Sails on the horizon! Pirates, flying a black flag. Get to the cannons, Captain!');
          ctx.ui.toast('Steer so the enemy is off your side, then click to fire a broadside.', 6);
          this.timer = 70;
        }
      }
      if (this.hostiles() === 0) {
        this.timer -= dt * (ship.speed > 4 ? 1 : 0.35);
        if (this.timer <= 0) { this.spawnRandom(); this.timer = rand(55, 85) - this.level * 3; }
      }
      this.floatTimer -= dt;
      if (this.floatTimer <= 0) { this.floatTimer = rand(14, 26); if (this.floats.length < 6) this.spawnFlotsam(); }
    }

    for (let i = this.ships.length - 1; i >= 0; i--) {
      const es = this.ships[i];
      es.update(dt);
      const s = es.ship;
      if (s.wreck) {
        // Wrecks drift for a while; once looted (or abandoned) they go under.
        const looted = es.chest?.opened && es.survivors.every((e) => !e.alive);
        s.wreckTimer += dt * (looted ? 3 : 1);
        if (s.wreckTimer > 150 && ctx.player.groundShip !== s) { s.wreck = false; s.sinking = Math.max(s.sinking, 4.01); }
      }
      const far = s.pos.distanceTo(ship.pos) > 1500;
      if ((s.sinking > 14 && !s.wreck) || (far && (!es.aggro || !s.alive))) {
        if (ctx.player.groundShip === s) continue;
        es.dispose();
        this.ships.splice(i, 1);
      }
    }
    for (let i = this.monsters.length - 1; i >= 0; i--) {
      const m = this.monsters[i];
      m.update(dt);
      const c = m.center(new THREE.Vector3());
      if ((!m.alive && m.dead > 8) || c.distanceTo(ship.pos) > 1600) { m.dispose(); this.monsters.splice(i, 1); }
    }
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.update(dt);
      if (f.collected || f.pos.distanceTo(ship.pos) > 1200) { f.dispose(); this.floats.splice(i, 1); }
    }

    // Music: switch to the battle track while something is hunting us.
    const fighting = this.engaged();
    if (fighting) { this.calmT = 0; if (!this.battleMusic && ctx.game.canChangeMusic()) { this.battleMusic = true; ctx.audio.playMusic('battle', 1.5); } }
    else if (this.battleMusic) {
      this.calmT += dt;
      if (this.calmT > 4) { this.battleMusic = false; ctx.game.restoreMusic(); }
    }
  }

  hostiles() {
    return this.ships.filter((s) => s.ship.alive).length + this.monsters.filter((m) => m.alive).length;
  }

  engaged() {
    const p = ctx.ship.pos;
    for (const s of this.ships) if (s.ship.alive && s.aggro && s.ship.pos.distanceTo(p) < 600) return true;
    for (const m of this.monsters) if (m.alive && m.center(new THREE.Vector3()).distanceTo(p) < 300) return true;
    return false;
  }

  /** Nearest boardable wreck within range of a point. */
  wreckNear(pos: THREE.Vector3, range: number): EnemyShip | null {
    let best: EnemyShip | null = null, bd = range;
    for (const es of this.ships) {
      if (!es.ship.wreck) continue;
      const d = es.ship.pos.distanceTo(pos);
      if (d < bd) { bd = d; best = es; }
    }
    return best;
  }

  private spawnPoint(minD: number, maxD: number): THREE.Vector3 | null {
    const s = ctx.ship;
    // Prefer open water ahead of the bow; near coastlines fall back to any bearing, a bit further out.
    for (let tries = 0; tries < 40; tries++) {
      const wide = tries >= 16;
      const a = wide ? rand(0, Math.PI * 2) : s.heading + rand(-1.3, 1.3) + (chance(0.25) ? Math.PI : 0);
      const d = wide ? rand(minD, maxD * 1.6) : rand(minD, maxD);
      const x = s.pos.x + Math.sin(a) * d, z = s.pos.z + Math.cos(a) * d;
      if (ctx.world.terrainHeight(x, z) > -6) continue;
      if (ctx.world.islandAt(x, z, wide ? 40 : 150)) continue;
      return new THREE.Vector3(x, 0, z);
    }
    return null;
  }

  spawnRandom() {
    const lv = this.level;
    const r = Math.random();
    if (lv >= 2 && r < 0.18 + lv * 0.02) this.spawnSerpent(lv);
    else if (lv >= 3 && r < 0.34) this.spawnKraken(lv);
    else if (lv >= 3 && r < 0.55) this.spawnShip('navy', lv);
    else {
      this.spawnShip('pirate', lv);
      if (lv >= 4 && chance(0.4)) this.spawnShip(chance(0.5) ? 'navy' : 'pirate', lv);
    }
  }

  spawnShip(faction: 'pirate' | 'navy', level: number) {
    const p = this.spawnPoint(560, 720);
    if (!p) return null;
    const heading = Math.atan2(ctx.ship.pos.x - p.x, ctx.ship.pos.z - p.z) + rand(-0.6, 0.6);
    const es = new EnemyShip(p, heading, faction, level);
    es.ship.onSunk = () => this.onShipSunk(es);
    this.ships.push(es);
    if (faction === 'navy') ctx.ui.toast(`The Meridian Navy! ${es.ship.name} is hunting your bounty.`, 4);
    else ctx.ui.toast(`Pirate ship sighted: the ${es.ship.name}!`, 4);
    ctx.audio.sfx('bell');
    return es;
  }

  spawnSerpent(level: number) {
    const p = this.spawnPoint(160, 240);
    if (!p) return null;
    const m = new SeaSerpent(p, level, PALETTES[Math.min(PALETTES.length - 1, level)] ?? pick(PALETTES));
    m.onDeath = () => this.onMonsterSlain(m, { gold: 180 + level * 90, iron: 2 + level, xp: 260 + level * 140 }, 6_000_000 * level);
    this.monsters.push(m);
    ctx.ui.say('Kaito', pick(['Something big is moving under the hull...', 'The water\'s boiling! Sea King!', 'Captain, below us!']));
    return m;
  }

  spawnKraken(level: number) {
    const p = this.spawnPoint(120, 160);
    if (!p) return null;
    const m = new Kraken(p, level);
    m.onDeath = () => this.onMonsterSlain(m, { gold: 320 + level * 120, wood: 20, iron: 4 + level, xp: 420 + level * 180 }, 12_000_000 * level);
    this.monsters.push(m);
    ctx.ui.toast('The sea darkens... a KRAKEN!', 4);
    ctx.ui.say('Kaito', 'Tentacles! Cut them off before it drags us under!');
    return m;
  }

  spawnFlotsam() {
    const p = this.spawnPoint(160, 380);
    if (!p) return;
    const lv = this.level;
    const r: Reward = chance(0.5) ? { wood: randInt(4, 10) } : chance(0.5) ? { gold: randInt(20, 60) * lv } : { iron: randInt(1, 3) };
    if (chance(0.08)) r.cola = 1;
    this.floats.push(new FloatingLoot(p, r));
  }

  private onShipSunk(es: EnemyShip) {
    const lv = es.level;
    const navy = es.faction === 'navy';
    ctx.progress.shipsSunk++;
    ctx.progress.bounty += (navy ? 9_000_000 : 5_000_000) * lv;
    ctx.game.addXP((navy ? 260 : 180) + lv * 90);
    ctx.game.giveLoot({ gold: randInt(60, 110) * lv }, es.ship.center(new THREE.Vector3()));
    // Most ships settle as boardable wrecks with loot aboard.
    es.ship.wreck = true;
    es.ship.wreckTimer = 0;
    es.ensureChest();
    ctx.ui.toast(`${es.ship.name} is crippled! Pull alongside and press E to board and loot her.`, 5);
    ctx.ui.say('Kaito', pick(['She\'s going down! Anything worth taking aboard?', 'Ha! That\'s how it\'s done.', 'Their hold is still above water. Let\'s board!']));
    for (let i = 0; i < 3; i++) {
      const p = es.ship.pos.clone().add(new THREE.Vector3(rand(-14, 14), 0, rand(-14, 14)));
      this.floats.push(new FloatingLoot(p, chance(0.5) ? { wood: randInt(5, 9) } : { iron: randInt(1, 2) }));
    }
  }

  private onMonsterSlain(m: SeaMonster, reward: Reward, bounty: number) {
    ctx.progress.monstersSlain++;
    ctx.progress.bounty += bounty;
    const c = m.center(new THREE.Vector3());
    const xp = reward.xp ?? 0;
    ctx.game.addXP(xp);
    ctx.game.giveLoot({ ...reward, xp: 0 }, c);
    ctx.ui.banner(`${m.name.toUpperCase()} DEFEATED`, `+฿ ${bounty.toLocaleString()} bounty`, 2.4, 'win');
    ctx.audio.sfx('gong');
  }

  clearAll() {
    for (const s of this.ships) s.dispose();
    for (const m of this.monsters) m.dispose();
    for (const f of this.floats) f.dispose();
    this.ships = []; this.monsters = []; this.floats = [];
    this.timer = 40;
  }
}
