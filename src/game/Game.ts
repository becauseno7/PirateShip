// The game: boot, state machine, main loop, island activation, docking and
// boarding, boss fights, the awakening, rewards, saving and the ending.
import * as THREE from 'three';
import { loadBodyParts } from '../entities/bodyModel';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ctx } from './ctx';
import { Input } from '../core/input';
import { Audio } from '../core/audio';
import { Particles } from '../fx/Particles';
import { Effects } from '../fx/Effects';
import { Projectiles } from '../combat/Projectiles';
import { Combat } from '../combat/Combat';
import { Environment } from '../world/Environment';
import { Ocean } from '../world/Ocean';
import { World } from '../world/World';
import { Grass } from '../world/Grass';
import type { Island, NpcSpot } from '../world/Island';
import { sharedUniforms } from '../world/materials';
import { Player } from '../entities/Player';
import { Companion } from '../entities/Companion';
import { Ship } from '../entities/Ship';
import { Enemy, factionLook, EnemyType } from '../entities/Enemy';
import { Boss, BOSSES } from '../entities/Boss';
import { Humanoid, RigLook } from '../entities/Humanoid';
import type { EnemyShip } from '../entities/EnemyShip';
import { Encounters } from './Encounters';
import { CameraRig } from './CameraRig';
import { Chest, Reward } from './Loot';
import { makeFruit } from './FruitModel';
import { UI } from '../ui/UI';
import { Menus } from '../ui/Menus';
import { AWAKEN_ISLAND, COMPANION, FINAL_ISLAND, FRUITS, FRUIT_ORDER, FruitId, ISLANDS, STORY, UPGRADES } from './data';
import { Look, Progress, clearProgress, loadProgress, loadSettings, maxHpFor, newProgress, saveProgress, xpForLevel } from './state';
import { clamp, pick, rand, randInt } from '../core/math';

type State = 'loading' | 'title' | 'create' | 'fruit' | 'play' | 'paused' | 'map' | 'shop' | 'dead' | 'ending';
type TrackName = 'title' | 'sail' | 'explore' | 'battle' | 'boss' | 'awaken' | 'ending' | 'none';

interface Cutscene { t: number; dur: number; steps: { at: number; fn: () => void; done?: boolean }[]; tick?: (t: number, dt: number) => void; end?: () => void }
interface Npc { h: Humanoid; spot: NpcSpot; line: number; actT: number; action: string | null; yaw: number }

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export class Game {
  state: State = 'loading';
  renderer!: THREE.WebGLRenderer;
  grass!: Grass;
  composer: EffectComposer | null = null;
  bloom: UnrealBloomPass | null = null;
  menus!: Menus;
  clock = new THREE.Timer();
  kaitoSteering = false;
  boss: Boss | null = null;
  activeIsland: Island | null = null;
  enemies: Enemy[] = [];
  chests: Chest[] = [];
  npcs: Npc[] = [];
  tmpV = new THREE.Vector3();
  settingsFromTitle = false;
  private cut: Cutscene | null = null;
  private fruitDisplay: { group: THREE.Group; fruits: Map<FruitId, THREE.Group>; sel: FruitId } | null = null;
  private expectUnlock = false;
  private musicT = 0;
  private saveT = 0;
  private repairCd = 0;
  private sailTipIdx = 0;
  private sailTipT = 20;
  private arrivedSaid = new Set<number>();
  private islandBannerShown = new Set<number>();
  private titleT = 0;
  private previewDir = new THREE.Vector3(0, 0, 1);
  private awakening = false;
  private bossDefeated = false;
  private deathPending = false;

  // ---- Boot -------------------------------------------------------------------
  async init() {
    const app = document.getElementById('app')!;
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setSize(window.innerWidth, window.innerHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    // Neutral tone mapping keeps the saturated, anime-like palette that ACES washes out.
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 0.92;
    r.outputColorSpace = THREE.SRGBColorSpace;
    app.appendChild(r.domElement);
    this.renderer = r;

    ctx.game = this;
    ctx.renderer = r;
    ctx.scene = new THREE.Scene();
    ctx.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 9000);
    ctx.camera.position.set(0, 30, 700);
    ctx.time = 0; ctx.dt = 0; ctx.timeScale = 1;
    ctx.settings = loadSettings();
    ctx.progress = loadProgress() ?? newProgress();
    ctx.input = new Input(r.domElement);
    ctx.audio = new Audio();
    ctx.ui = new UI();
    ctx.ui.setScreen('loading');
    ctx.ui.loading(0.02, 'Mixing the seven seas...');
    await this.frame();

    ctx.fx = new Effects(ctx.scene);
    ctx.particles = new Particles(ctx.scene);
    ctx.projectiles = new Projectiles(ctx.scene);
    ctx.combat = new Combat();
    ctx.ocean = new Ocean();
    ctx.scene.add(ctx.ocean.mesh);
    ctx.env = new Environment(ctx.scene);
    ctx.world = new World(ctx.scene);
    this.grass = new Grass(ctx.scene);
    ctx.cam = new CameraRig(ctx.camera);
    await loadBodyParts(import.meta.env.BASE_URL + 'models/characters.glb');
    await ctx.world.generate((f, label) => ctx.ui.loading(0.05 + f * 0.8, label));
    ctx.ui.loading(0.88, 'Painting the sea charts...');
    await this.frame();
    ctx.ui.map.build();

    ctx.ui.loading(0.94, 'Recruiting a swordsman...');
    await this.frame();
    const pr = ctx.progress;
    ctx.player = new Player(pr.look, pr.fruit ?? 'blaze');
    ctx.companion = new Companion();
    this.setupPlayerShip();
    ctx.encounters = new Encounters();
    this.menus = new Menus();
    this.setupComposer();
    this.applySettings();

    ctx.input.onLockChange = (locked) => {
      if (!locked && this.state === 'play') {
        if (this.expectUnlock) { this.expectUnlock = false; return; }
        this.pause();
      }
    };
    r.domElement.addEventListener('click', () => { if (this.state === 'play' && !ctx.input.locked) ctx.input.requestLock(); });
    const unlockAudio = () => {
      ctx.audio.init();
      ctx.audio.applyVolumes();
      if (this.state === 'title') ctx.audio.playMusic('title', 1);
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
    window.addEventListener('resize', () => this.resize());
    this.resize();

    ctx.ui.loading(1, 'Ready to set sail!');
    await this.frame();
    this.toTitle();
    this.loop();
  }

  private frame() { return new Promise<void>((res) => requestAnimationFrame(() => res())); }

  private setupComposer() {
    const comp = new EffectComposer(this.renderer);
    comp.addPass(new RenderPass(ctx.scene, ctx.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.42, 0.55, 0.93);
    comp.addPass(this.bloom);
    comp.addPass(new OutputPass());
    this.composer = comp;
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    ctx.camera.aspect = w / h;
    ctx.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    ctx.particles.setViewport(h * this.renderer.getPixelRatio());
    if (ctx.ui.map.bigOpen) ctx.ui.map.resizeBig();
  }

  applySettings() {
    const s = ctx.settings;
    ctx.audio.volumes = { master: s.master, music: s.music, sfx: s.sfx };
    ctx.audio.applyVolumes();
    ctx.input.sensitivity = s.sensitivity;
    ctx.input.invertY = s.invertY;
    const pr = s.quality === 'low' ? 0.75 : s.quality === 'medium' ? 1 : Math.min(window.devicePixelRatio, 1.75);
    this.renderer.setPixelRatio(pr);
    this.renderer.shadowMap.enabled = s.quality !== 'low';
    ctx.env.setQuality(s.quality);
    this.grass?.setQuality(s.quality);
    this.resize();
  }

  // ---- Player ship --------------------------------------------------------------
  setupPlayerShip() {
    const old = ctx.ship as Ship | undefined;
    const pos = old ? old.pos.clone() : null;
    const heading = old?.heading ?? 0;
    const docked = old?.docked ?? true;
    if (old) {
      ctx.combat.unregister(old);
      ctx.world.ships = ctx.world.ships.filter((s) => s !== old);
      old.dispose();
    }
    const pr = ctx.progress;
    const s = new Ship('player', { L: 26, W: 8.4, deckY: 2.4, qd: 5.6, fc: 4.8 }, { name: pr.shipName, look: { hat: pr.look.hat, hatColor: pr.look.hatColor } });
    ctx.ship = s;
    ctx.world.ships.push(s);
    ctx.combat.register(s);
    this.applyUpgrades();
    s.hp = s.hpMax;
    s.onSunk = () => this.onShipSunk();
    if (pos) { s.pos.copy(pos); s.heading = heading; s.docked = docked; }
    else this.mooredAt(ctx.world.islands[0]);
  }

  applyUpgrades() {
    const s = ctx.ship;
    const u = ctx.progress.upgrades;
    const frac = s.hp / s.hpMax;
    s.hpMax = 400 + [0, 150, 300, 500][u.hull];
    s.hp = Math.min(s.hpMax, Math.max(1, frac * s.hpMax));
    s.setCannonCount([2, 3, 4, 5][u.cannons]);
    s.cannonDamage = 55;
    s.maxSpeed = 30 * [1, 1.15, 1.3, 1.45][u.sails];
    s.reloadTime = [2.6, 2.4, 2.2, 2.0][u.cannons];
  }

  private mooredAt(isl: Island) {
    const s = ctx.ship;
    s.pos.set(isl.shipPark.x, 0, isl.shipPark.z);
    s.heading = isl.shipParkHeading;
    s.docked = true;
    s.sail = 0;
    s.speed = 0;
    s.anchored = false;
    s.update(0);
  }

  // ---- State transitions ----------------------------------------------------------
  hasSave() { return !!loadProgress(); }
  peekSave(): Progress | null { return loadProgress(); }

  toTitle() {
    this.state = 'title';
    this.resetWorldState();
    const home = ctx.world.islands[0];
    this.mooredAt(home);
    ctx.player.setVisible(true);
    ctx.player.teleport(this.pierPoint(home, 10));
    ctx.companion.placeOnShip('bow');
    ctx.env.timeOfDay = 0.6;
    ctx.ui.setScreen('title');
    this.menus.refreshTitle();
    ctx.ui.letterbox(false);
    ctx.audio.playMusic('title', 1.5);
    this.titleT = 0;
  }

  private resetWorldState() {
    this.endCutscene(false);
    this.clearIsland();
    ctx.encounters.clearAll();
    this.kaitoSteering = false;
    this.boss = null;
    ctx.ui.bossBar(null);
    ctx.ui.clearSay();
    ctx.ui.prompt(null);
    ctx.env.darken = 0;
    ctx.env.forceStorm = -1;
    ctx.timeScale = 1;
    if (ctx.player.mode === 'helm') ctx.player.leaveHelm();
    ctx.player.mode = 'foot';
    ctx.cam.setShot(null);
    ctx.cam.setMode('follow');
    this.removeFruitDisplay();
  }

  startNewGame() {
    clearProgress();
    ctx.progress = newProgress();
    this.menus.look = { ...ctx.progress.look };
    this.menus.syncCreate();
    ctx.ui.map.loadFog('');
    ctx.player.rebuildLook(ctx.progress.look);
    ctx.player.setAwakened(false);
    ctx.player.awakened = false;
    this.arrivedSaid.clear();
    this.islandBannerShown.clear();
    this.state = 'create';
    this.titleT = 0;
    ctx.env.timeOfDay = 0.3;
    const home = ctx.world.islands[0];
    const spot = this.previewSpot(home);
    ctx.player.teleport(spot.pos);
    this.previewDir.copy(spot.dir);
    ctx.player.yaw = Math.atan2(spot.dir.x, spot.dir.z);
    ctx.ui.setScreen('create');
    ctx.audio.playMusic('explore', 1);
  }

  /** An open patch of village ground with a clear view toward the sea, for menu close-ups. */
  private previewSpot(isl: Island) {
    const out = V(Math.cos(isl.dockDir), 0, Math.sin(isl.dockDir));
    const side = V(-out.z, 0, out.x);
    let best = { pos: this.pierPoint(isl, 14), dir: out.clone(), score: -Infinity };
    const clear = (x: number, z: number, pad: number) => isl.collidersNear(x, z).every((c) => Math.hypot(x - c.x, z - c.z) > c.r + pad);
    for (let d = 10; d <= 70; d += 3) for (let s = -45; s <= 45; s += 4) {
      const p = isl.pierStart.clone().addScaledVector(out, -d).addScaledVector(side, s);
      const h = isl.heightAt(p.x, p.z);
      if (h < 1.4 || h > 16) continue;
      if (isl.pierHeight(p.x, p.z) > 0) continue;
      const c = p.clone().addScaledVector(out, 7);
      const hc = isl.heightAt(c.x, c.z);
      if (hc < 0.3 || Math.abs(hc - h) > 2.2 || isl.pierHeight(c.x, c.z) > 0) continue;
      let ok = clear(p.x, p.z, 3.5);
      for (let k = 1; k <= 8 && ok; k++) { const q = p.clone().lerp(c, k / 8); ok = clear(q.x, q.z, 2.2) && isl.pierHeight(q.x, q.z) < 0; }
      if (!ok) continue;
      const slope = Math.abs(isl.heightAt(p.x + 2, p.z) - isl.heightAt(p.x - 2, p.z)) + Math.abs(isl.heightAt(p.x, p.z + 2) - isl.heightAt(p.x, p.z - 2));
      const score = -Math.abs(s) * 0.25 - d * 0.35 - slope * 4;
      if (score > best.score) best = { pos: V(p.x, h + 0.2, p.z), dir: out.clone(), score };
    }
    return best;
  }

  previewLook(look: Look) {
    ctx.player.rebuildLook(look);
    ctx.player.play('preview', Math.random() < 0.5 ? 'wave' : 'victory', 1.2, [], true);
  }
  rotatePreview(d: number) { ctx.player.yaw += d; }

  finishCreator(name: string, shipName: string, look: Look) {
    const pr = ctx.progress;
    pr.name = name; pr.shipName = shipName; pr.look = look;
    ctx.player.rebuildLook(look);
    this.setupPlayerShip();
    this.mooredAt(ctx.world.islands[0]);
    this.showFruitDisplay();
    this.state = 'fruit';
    ctx.ui.setScreen('fruit');
    this.menus.selectFruit('blaze');
    this.titleT = 0;
  }

  private showFruitDisplay() {
    this.removeFruitDisplay();
    const p = ctx.player;
    const group = new THREE.Group();
    p.yaw = Math.atan2(this.previewDir.x, this.previewDir.z);
    const f = this.previewDir;
    const center = p.pos.clone().addScaledVector(f, 3.2);
    center.y = ctx.world.terrainHeight(center.x, center.z);
    group.position.copy(center);
    group.rotation.y = p.yaw;
    const fruits = new Map<FruitId, THREE.Group>();
    // A treasure chest pedestal with the five fruits floating in an arc.
    const chest = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 1.1), new THREE.MeshStandardMaterial({ color: 0x7a4a22, roughness: 0.7 }));
    chest.position.y = 0.45;
    chest.castShadow = true;
    group.add(chest);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.14, 1.2), new THREE.MeshStandardMaterial({ color: 0xd8b04a, metalness: 0.6, roughness: 0.3 }));
    trim.position.y = 0.85;
    group.add(trim);
    FRUIT_ORDER.forEach((id, i) => {
      const m = makeFruit(id);
      const a = (i - 2) * 0.32;
      m.position.set(Math.sin(a) * 2.2, 1.6, Math.cos(a) * 2.2 - 2.2 + 0.2);
      m.scale.setScalar(0.55);
      group.add(m);
      fruits.set(id, m);
    });
    ctx.scene.add(group);
    this.fruitDisplay = { group, fruits, sel: 'blaze' };
  }

  private removeFruitDisplay() {
    if (!this.fruitDisplay) return;
    ctx.scene.remove(this.fruitDisplay.group);
    this.fruitDisplay = null;
  }

  previewFruit(id: FruitId) {
    if (!this.fruitDisplay) return;
    this.fruitDisplay.sel = id;
    const m = this.fruitDisplay.fruits.get(id)!;
    const wp = m.getWorldPosition(V());
    ctx.particles.burst(wp, 20, { speed: 2, up: 1, life: 0.8, size: 0.15, sizeEnd: 0.01, color: FRUITS[id].color2, additive: true, gravity: -1 });
    ctx.audio.sfx('power', wp, 0.25);
  }

  chooseFruit(id: FruitId) {
    const pr = ctx.progress;
    pr.fruit = id;
    const p = ctx.player;
    p.fruit = id;
    ctx.ui.setScreen('hud');
    ctx.ui.hudVisible(false);
    ctx.ui.letterbox(true);
    this.state = 'play';
    const def = FRUITS[id];
    const fd = this.fruitDisplay!;
    const fruit = fd.fruits.get(id)!;
    p.mode = 'locked';
    const face = () => p.pos.clone().add(V(0, 1.55, 0));
    this.runCutscene(7.5, [
      [0, () => {
        ctx.scene.attach(fruit);
        fd.group.visible = false;
        fruit.scale.setScalar(0.32);
        const f = p.facing();
        const right = V(f.z, 0, -f.x);
        ctx.cam.setShot({ pos: face().addScaledVector(f, 2.2).addScaledVector(right, -1.3).add(V(0, 0.05, 0)), look: face().add(V(0, -0.15, 0)), fov: 40 }, true);
        p.play('eat', 'eat', 2.2, [], true);
        ctx.audio.sfx('eat', p.pos, 1);
      }],
      [0.5, () => ctx.audio.sfx('eat', p.pos, 1)],
      [1.0, () => { ctx.audio.sfx('eat', p.pos, 1); fruit.visible = false; }],
      [2.2, () => { ctx.ui.say(pr.name, 'Blegh! It tastes like... like old socks dipped in seawater!'); p.play('hit', 'hit', 0.6, [], true); }],
      [3.4, () => {
        ctx.audio.sfx('heartbeat', p.pos, 1);
        ctx.fx.flash('#' + def.color.toString(16).padStart(6, '0'), 0.7, 1.2);
        p.play('powerup', 'powerup', 2.6, [], true);
        ctx.cam.setShot({ pos: p.pos.clone().addScaledVector(p.facing(), 5.5).add(V(0, 0.8, 0)), look: p.pos.clone().add(V(0, 1.1, 0)), fov: 48 });
      }],
      [4.2, () => {
        ctx.audio.sfx('power', p.pos, 1.2);
        ctx.fx.shockwave(p.pos.clone().add(V(0, 0.2, 0)), 9, def.color, 1.0, 1.2);
        ctx.fx.sphere(p.pos.clone().add(V(0, 1, 0)), 2.6, def.color, 0.5, 0.3);
        ctx.fx.light(p.pos.clone().add(V(0, 3, 0)), def.color, 10, 1.2, 18);
        ctx.particles.burst(p.pos.clone().add(V(0, 1, 0)), 120, { speed: 10, up: 4, life: 1.4, size: 0.4, sizeEnd: 0.02, color: def.color, colorEnd: def.color2, additive: true, gravity: 2 });
        ctx.fx.shake(0.8);
        ctx.ui.banner(def.name.toUpperCase(), `You gained the power of the ${def.english}!`, 3, 'ult');
      }],
      [6.2, () => { ctx.ui.say(COMPANION.name, STORY.intro[0].replace('Kaito: ', '')); }],
    ], (t) => {
      if (fruit.visible) {
        const hand = p.rig.worldPos('haR');
        fruit.position.copy(hand).add(V(0, 0.08, 0));
        fruit.scale.setScalar(0.32 * (t < 0.5 ? 1 : t < 1 ? 0.75 : 0.5));
      }
    }, () => {
      ctx.scene.remove(fruit);
      this.removeFruitDisplay();
      p.mode = 'foot';
      this.startVoyage(true);
    });
  }

  private startVoyage(fresh: boolean) {
    const pr = ctx.progress;
    ctx.player.fruit = pr.fruit!;
    ctx.player.awakened = pr.awakened;
    ctx.player.setAwakened(pr.awakened);
    ctx.player.hpMax = maxHpFor(pr.level);
    ctx.player.hp = ctx.player.hpMax;
    ctx.player.ult = pr.awakened ? 100 : 0;
    ctx.player.alive = true;
    this.state = 'play';
    ctx.ui.setScreen('hud');
    ctx.ui.letterbox(false);
    ctx.cam.setShot(null);
    ctx.cam.setMode('follow');
    ctx.input.requestLock();
    if (fresh) {
      ctx.player.yaw = ctx.world.islands[0].shipParkHeading + Math.PI;
      ctx.cam.yaw = ctx.player.yaw + Math.PI;
      STORY.intro.slice(1).forEach((l) => ctx.ui.say(COMPANION.name, l.replace('Kaito: ', '')));
      ctx.ui.toast('Click to control the camera. Walk to your ship and press E to board.', 6);
    }
    this.save();
    this.restoreMusic();
  }

  continueGame() {
    const pr = loadProgress();
    if (!pr) return;
    ctx.progress = pr;
    ctx.ui.map.loadFog(pr.fog);
    ctx.player.rebuildLook(pr.look);
    this.setupPlayerShip();
    const isl = ctx.world.islands[clamp(pr.lastDock, 0, ISLANDS.length - 1)];
    this.mooredAt(isl);
    ctx.player.teleport(this.pierPoint(isl, 10));
    ctx.player.yaw = isl.shipParkHeading + Math.PI;
    ctx.cam.yaw = ctx.player.yaw + Math.PI;
    ctx.companion.placeNear(ctx.player.pos);
    ctx.env.timeOfDay = 0.32;
    this.arrivedSaid.clear();
    this.islandBannerShown.clear();
    for (let i = 0; i < ISLANDS.length; i++) if (pr.cleared[i]) this.arrivedSaid.add(i);
    this.startVoyage(false);
    ctx.ui.banner(isl.def.name, isl.def.title, 3, 'island');
    this.islandBannerShown.add(isl.def.id);
  }

  freeRoam() {
    ctx.ui.setScreen('hud');
    this.state = 'play';
    ctx.input.requestLock();
    ctx.env.darken = 0;
    this.restoreMusic();
  }

  pause() {
    if (this.state !== 'play') return;
    this.state = 'paused';
    this.settingsFromTitle = false;
    this.menus.openPause('main');
    ctx.ui.setScreen('pause');
    ctx.audio.sfx('uiback');
  }

  resume() {
    if (this.settingsFromTitle) { this.settingsFromTitle = false; ctx.ui.setScreen('title'); return; }
    this.state = 'play';
    ctx.ui.setScreen('hud');
    ctx.input.requestLock();
  }

  openMap() {
    if (this.state !== 'play' && this.state !== 'paused') return;
    this.state = 'map';
    this.unlock();
    ctx.ui.setScreen('map');
    ctx.audio.sfx('ui');
  }

  private closeMap() {
    this.state = 'play';
    ctx.ui.setScreen('hud');
    ctx.input.requestLock();
  }

  private unlock() {
    if (ctx.input.locked) { this.expectUnlock = true; ctx.input.exitLock(); }
  }

  quitToTitle() {
    if (ctx.progress.fruit) this.save();
    this.toTitle();
  }

  openShop() {
    this.state = 'shop';
    this.unlock();
    this.menus.refreshShop();
    ctx.ui.setScreen('shop');
  }
  closeShop() {
    this.state = 'play';
    ctx.ui.setScreen('hud');
    ctx.input.requestLock();
    this.save();
  }

  repairCost() {
    const missing = Math.max(0, ctx.ship.hpMax - ctx.ship.hp);
    return { gold: Math.ceil(missing * 0.6), wood: Math.ceil(missing / 25), iron: Math.ceil(missing / 120) };
  }
  shopRepair() {
    const c = this.repairCost();
    const pr = ctx.progress;
    if (pr.gold < c.gold || pr.wood < c.wood || pr.iron < c.iron) return;
    pr.gold -= c.gold; pr.wood -= c.wood; pr.iron -= c.iron;
    ctx.ship.repair(ctx.ship.hpMax);
    ctx.audio.sfx('heal');
  }
  buyUpgrade(k: 'hull' | 'cannons' | 'sails') {
    const pr = ctx.progress;
    const lv = pr.upgrades[k];
    const c = UPGRADES[k].costs[lv];
    if (!c || pr.gold < c.gold || pr.wood < c.wood || pr.iron < c.iron) return;
    pr.gold -= c.gold; pr.wood -= c.wood; pr.iron -= c.iron;
    pr.upgrades[k]++;
    this.applyUpgrades();
    if (k === 'hull') ctx.ship.repair(ctx.ship.hpMax);
    ctx.audio.sfx('levelup');
    ctx.ui.toast(`${UPGRADES[k].name} upgraded: ${UPGRADES[k].desc[pr.upgrades[k]]}`, 4);
  }

  save() {
    const pr = ctx.progress;
    if (!pr.fruit) return;
    pr.fog = ctx.ui.map.saveFog();
    saveProgress(pr);
  }

  // ---- Cutscenes ------------------------------------------------------------------
  runCutscene(dur: number, steps: [number, () => void][], tick?: (t: number, dt: number) => void, end?: () => void) {
    this.cut = { t: 0, dur, steps: steps.map(([at, fn]) => ({ at, fn })), tick, end };
    ctx.ui.prompt(null);
  }

  private updateCutscene(dt: number) {
    const c = this.cut;
    if (!c) return;
    c.t += dt;
    for (const s of c.steps) if (!s.done && c.t >= s.at) { s.done = true; s.fn(); }
    c.tick?.(c.t, dt);
    if (c.t >= c.dur) this.endCutscene(true);
  }

  private endCutscene(runEnd: boolean) {
    const c = this.cut;
    if (!c) return;
    this.cut = null;
    if (runEnd) c.end?.();
  }

  get inCutscene() { return !!this.cut; }

  // ---- Main loop ------------------------------------------------------------------
  private loop = () => {
    requestAnimationFrame(this.loop);
    this.clock.update();
    const real = Math.min(0.05, this.clock.getDelta());
    let ts = ctx.timeScale;
    if (ctx.fx.hitstop > 0) { ctx.fx.hitstop -= real; ts *= 0.06; }
    const dt = real * ts;
    ctx.dt = dt;
    ctx.time += dt;
    sharedUniforms.uTime.value = ctx.time;
    try {
      this.update(dt, real);
    } catch (e) {
      console.error(e);
    }
    ctx.input.endFrame();
    if (this.debugCam) { ctx.camera.position.copy(this.debugCam.pos); ctx.camera.lookAt(this.debugCam.look); ctx.camera.fov = this.debugCam.fov; ctx.camera.updateProjectionMatrix(); }
    const cp = ctx.camera.position;
    this.grass.update(ctx.camera, ctx.world.islandAt(cp.x, cp.z, 80));
    if (this.composer && ctx.settings.quality !== 'low') this.composer.render(real);
    else this.renderer.render(ctx.scene, ctx.camera);
  };

  /** Test hook: pin the camera for screenshots. */
  debugCam: { pos: THREE.Vector3; look: THREE.Vector3; fov: number } | null = null;

  /** Test hook: advance the simulation without rendering. */
  debugAdvance(sec: number, step = 1 / 30) {
    const n = Math.round(sec / step);
    for (let i = 0; i < n; i++) {
      const dt = step * ctx.timeScale;
      ctx.dt = dt;
      ctx.time += dt;
      sharedUniforms.uTime.value = ctx.time;
      this.update(dt, step);
      ctx.input.endFrame();
    }
  }

  private update(dt: number, real: number) {
    const inp = ctx.input;
    const s = this.state;
    if (s === 'title' || s === 'create' || s === 'fruit') this.updateMenuScene(dt, real);
    else if (s === 'play') this.updatePlay(dt, real);
    else if (s === 'map') {
      if (inp.pressed('KeyM') || inp.pressed('Escape')) this.closeMap();
      this.updateAmbient(0, real);
    } else if (s === 'paused' || s === 'shop' || s === 'dead' || s === 'ending') {
      if (s === 'paused' && inp.pressed('Escape')) this.resume();
      if (s === 'shop' && inp.pressed('Escape')) this.closeShop();
      this.updateAmbient(s === 'ending' || s === 'dead' ? dt : 0, real);
    }
    ctx.ui.update(real);
    // Audio listener follows the camera.
    ctx.audio.listener.copy(ctx.camera.position);
    ctx.audio.listenerRight.set(1, 0, 0).applyQuaternion(ctx.camera.quaternion);
  }

  private updateAmbient(dt: number, real: number) {
    ctx.env.update(Math.max(dt, real * 0.2), ctx.camera.position, ctx.camera);
    ctx.ocean.update(real, ctx.camera);
    ctx.world.update(real, ctx.time, ctx.camera.position);
    ctx.particles.update(dt);
    ctx.fx.update(dt);
    if (dt > 0) ctx.cam.update(real, { dx: 0, dy: 0 }, 0, ctx.player.pos);
  }

  private updateMenuScene(dt: number, real: number) {
    this.titleT += real;
    const p = ctx.player;
    const ship = ctx.ship;
    ship.update(dt);
    if (this.state === 'title') {
      const home = ctx.world.islands[0];
      const out = V(Math.cos(home.dockDir), 0, Math.sin(home.dockDir));
      const side = V(-out.z, 0, out.x);
      const t = this.titleT * 0.06;
      const pos = ship.pos.clone().addScaledVector(out, 38 + Math.sin(t) * 8).addScaledVector(side, 30 + Math.sin(t * 1.3) * 12).add(V(0, 5 + Math.sin(t * 0.7) * 1.5, 0));
      ctx.cam.setShot({ pos, look: ship.pos.clone().add(V(0, 13, 0)).addScaledVector(out, -40).addScaledVector(side, 8), fov: 55 }, this.titleT < 0.1);
      ctx.env.timeOfDay = 0.6 + Math.sin(this.titleT * 0.01) * 0.01;
    } else if (this.state === 'create') {
      const f = this.previewDir;
      const right = V(f.z, 0, -f.x);
      const face = p.pos.clone().add(V(0, 1.15, 0));
      ctx.cam.setShot({ pos: face.clone().addScaledVector(f, 4.4).addScaledVector(right, -1.3).add(V(0, 0.4, 0)), look: face.clone().addScaledVector(right, -1.1), fov: 42 }, this.titleT < 0.1);
    } else if (this.state === 'fruit' && this.fruitDisplay) {
      const fd = this.fruitDisplay;
      const sel = fd.fruits.get(fd.sel)!;
      fd.fruits.forEach((m, id) => {
        const on = id === fd.sel;
        const target = on ? 1.0 : 0.55;
        m.scale.setScalar(m.scale.x + (target - m.scale.x) * Math.min(1, real * 6));
        m.rotation.y += real * (on ? 1.6 : 0.4);
        m.position.y = 1.6 + Math.sin(this.titleT * 2 + FRUIT_ORDER.indexOf(id)) * 0.08 + (on ? 0.25 : 0);
        const aura = m.getObjectByName('aura') as THREE.Mesh;
        (aura.material as THREE.MeshBasicMaterial).opacity = on ? 0.22 + Math.sin(this.titleT * 5) * 0.06 : 0.06;
      });
      const wp = sel.getWorldPosition(V());
      if (Math.random() < real * 30) ctx.particles.emit({ pos: wp.clone().add(V(rand(-0.5, 0.5), rand(-0.4, 0.4), rand(-0.5, 0.5))), vel: V(0, rand(0.4, 1.2), 0), life: 0.9, size: 0.12, sizeEnd: 0.01, color: FRUITS[fd.sel].color2, additive: true });
      const c0 = fd.group.position;
      const f = this.previewDir;
      const right = V(f.z, 0, -f.x);
      const camPos = c0.clone().addScaledVector(f, 4.6).add(V(0, 2.5, 0)).addScaledVector(right, Math.sin(this.titleT * 0.3) * 0.4);
      const look = c0.clone().add(V(0, 1.15, 0)).addScaledVector(f, -0.6).lerp(wp, 0.25);
      ctx.cam.setShot({ pos: camPos, look, fov: 46 }, this.titleT < 0.1);
    }
    p.physics(dt, V());
    p.tickAction(dt);
    p.animate(dt);
    // Kaito waits aboard during the menus so he never photobombs the close-ups.
    if (this.state === 'title' || ctx.companion.groundShip !== ship) ctx.companion.placeOnShip('bow');
    ctx.companion.physics(dt, V());
    ctx.companion.animate(dt);
    ctx.cam.update(real, { dx: 0, dy: 0 }, 0, p.pos);
    ctx.env.update(dt, ctx.camera.position, ctx.camera);
    ctx.ocean.update(dt, ctx.camera);
    ctx.world.update(dt, ctx.time, ctx.camera.position);
    ctx.particles.update(dt);
    ctx.fx.update(dt);
    ctx.audio.setAmbience(0.8, 0.3, 0);
  }

  private updatePlay(dt: number, real: number) {
    const inp = ctx.input;
    const p = ctx.player;
    const ship = ctx.ship;
    const pr = ctx.progress;
    pr.playTime += real;

    if (!this.cut) {
      if (inp.pressed('Escape')) { this.pause(); return; }
      if (inp.pressed('KeyM')) { this.openMap(); return; }
      if (p.alive && p.mode !== 'locked') this.handleInteractions();
    }
    this.updateCutscene(dt);

    // Simulation.
    p.update(dt);
    ctx.companion.update(dt);
    ship.update(dt);
    ctx.encounters.update(dt);
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.update(dt);
      if (!e.alive && e.removeTimer > 5) { e.dispose(); this.enemies.splice(i, 1); }
    }
    if (this.boss) { this.boss.update(dt); this.checkBossTrigger(); }
    for (const c of this.chests) c.update(dt, ctx.camera.position);
    this.updateNpcs(dt);
    ctx.projectiles.update(dt);
    ctx.particles.update(dt);
    ctx.fx.update(dt);
    this.updateIslandActivation();

    // Camera.
    const mouse = inp.locked && !this.cut ? inp.consumeMouse() : (inp.consumeMouse(), { dx: 0, dy: 0 });
    const focus = p.mode === 'helm' ? ship.pos : p.pos;
    ctx.cam.update(real, mouse, this.cut ? 0 : inp.wheel, focus);
    ctx.env.update(dt, focus, ctx.camera);
    ctx.ocean.update(dt, ctx.camera);
    ctx.world.update(dt, ctx.time, ctx.camera.position);

    // Beacons on the Log Pose island.
    ctx.world.islands.forEach((isl, i) => { isl.beacon.visible = i === pr.nextIsland && !pr.cleared[i] && !pr.finished; });

    // Ambience + music.
    const onLand = !!ctx.world.islandAt(focus.x, focus.z, -20) && p.groundShip !== ship && p.mode !== 'helm';
    ctx.audio.setAmbience(onLand ? 0.35 : 1, 0.25 + ctx.env.storm * 0.6 + Math.min(0.4, Math.abs(ship.speed) / 60), ctx.env.storm);
    this.musicT -= real;
    if (this.musicT <= 0) { this.musicT = 1; if (this.canChangeMusic() && !ctx.encounters.engaged()) this.restoreMusic(); }

    // Sailing tips and arrival lines.
    this.updateVoyageChatter(real);
    this.updateObjective();
    this.repairCd = Math.max(0, this.repairCd - dt);
    this.saveT += real;
    if (this.saveT > 60 && !this.boss?.fighting) { this.saveT = 0; this.save(); }
  }

  // ---- Music ------------------------------------------------------------------------
  canChangeMusic() { return this.state === 'play' && !this.cut && !this.boss?.fighting; }

  private baseTrack(): TrackName {
    if (this.boss?.fighting) return ctx.player.awakened && this.boss.def.id === 'gorrath' ? 'awaken' : 'boss';
    const p = ctx.player;
    const onShip = p.groundShip === ctx.ship || p.mode === 'helm';
    if (!onShip && ctx.world.islandAt(p.pos.x, p.pos.z, 30)) return 'explore';
    return 'sail';
  }

  restoreMusic() {
    const t = this.baseTrack();
    if (ctx.audio.currentTrack !== t) ctx.audio.playMusic(t, 2);
  }

  // ---- Interactions ---------------------------------------------------------------
  private handleInteractions() {
    const inp = ctx.input;
    const p = ctx.player;
    const ship = ctx.ship;
    const pr = ctx.progress;
    let prompt: string | null = null;
    let action: (() => void) | null = null;

    if (inp.pressed('KeyF')) {
      if (p.mode === 'helm') p.leaveHelm();
      else if (p.groundShip === ship && ship.alive) { p.enterHelm(); if (this.kaitoSteering) { this.kaitoSteering = false; ctx.companion.placeOnShip('bow'); } }
    }
    if (inp.pressed('KeyT') && (p.groundShip === ship || p.mode === 'helm') && ship.alive) {
      if (p.mode === 'helm') p.leaveHelm();
      this.kaitoSteering = !this.kaitoSteering;
      if (this.kaitoSteering) {
        if (ship.docked) this.undock();
        const dest = ISLANDS[Math.min(pr.nextIsland, ISLANDS.length - 1)];
        ctx.ui.say(COMPANION.name, pr.finished ? 'Where to, Captain? ...Fine, I\'ll just sail us around.' : pick([`Leave it to me. Next stop, ${dest.name}!`, `Heading for ${dest.name}. Try not to fall overboard.`, 'I\'ve got the helm. Go do captain things.']));
      } else ctx.ui.say(COMPANION.name, 'She\'s all yours, Captain.');
    }
    if (inp.pressed('KeyR') && (p.groundShip === ship || p.mode === 'helm')) this.fieldRepair();

    if (p.mode === 'helm') {
      // Moor at any island's pier.
      if (!ship.docked) {
        const isl = this.nearestBerth(ship.pos, 48);
        if (isl && Math.abs(ship.speed) < 16) { prompt = `[E] Moor at ${isl.def.name}`; action = () => this.dock(isl); }
        const wreck = ctx.encounters.wreckNear(ship.pos, 42);
        if (wreck && !prompt) { prompt = `[E] Board the ${wreck.ship.name}`; action = () => { p.leaveHelm(); this.boardWreck(wreck); }; }
      } else { prompt = '[E] Go ashore'; action = () => { p.leaveHelm(); this.goAshore(); }; }
    } else if (p.mode === 'foot' && p.grounded) {
      // Chests.
      const allChests = [...this.chests, ...ctx.encounters.ships.map((e) => e.chest).filter((c): c is Chest => !!c)];
      for (const c of allChests) {
        if (c.opened) continue;
        if (c.worldPos().distanceTo(p.pos) < 2.6) { prompt = '[E] Open the chest'; action = () => this.openChest(c); break; }
      }
      // NPCs.
      if (!prompt) for (const n of this.npcs) {
        if (n.h.root.position.distanceTo(p.pos) < 3.2) {
          const isl = this.activeIsland!;
          if (n.spot.role === 'captive' && !pr.cleared[isl.def.id]) { prompt = `[E] Talk to ${n.spot.name}`; action = () => this.talk(n); }
          else if (n.spot.role === 'shipwright') { prompt = `[E] Trade with ${n.spot.name}`; action = () => { this.talk(n); this.openShop(); }; }
          else { prompt = `[E] Talk to ${n.spot.name}`; action = () => this.talk(n); }
          break;
        }
      }
      if (!prompt) {
        if (p.groundShip === ship) {
          if (ship.docked) { prompt = '[E] Go ashore'; action = () => this.goAshore(); }
          else {
            const wreck = ctx.encounters.wreckNear(ship.pos, 46);
            if (wreck) { prompt = `[E] Board the ${wreck.ship.name}`; action = () => this.boardWreck(wreck); }
          }
        } else if (p.groundShip && p.groundShip !== ship) {
          const es = ctx.encounters.ships.find((e) => e.ship === p.groundShip);
          if (es && es.survivors.every((e) => !e.alive)) { prompt = `[E] Return to the ${pr.shipName}`; action = () => this.returnToShip(); }
        } else if (ship.docked && ship.pos.distanceTo(p.pos) < 20) {
          prompt = `[E] Board the ${pr.shipName}`; action = () => this.boardOwnShip();
        }
      }
    }
    ctx.ui.prompt(prompt);
    if (action && inp.pressed('KeyE')) { action(); ctx.ui.prompt(null); }
  }

  private nearestBerth(pos: THREE.Vector3, range: number) {
    for (const isl of ctx.world.islands) if (Math.hypot(isl.shipPark.x - pos.x, isl.shipPark.z - pos.z) < range) return isl;
    return null;
  }

  private pierPoint(isl: Island, back = 6) {
    const dir = isl.pierStart.clone().sub(isl.pierEnd).setY(0).normalize();
    const p = isl.pierEnd.clone().addScaledVector(dir, back);
    p.y = ctx.world.groundAt(p.x, p.z, 20).h;
    return p;
  }

  private shipDeckCenter(s: Ship, lz = 0) {
    const p = s.toWorld(V(0, 0, lz));
    p.y = s.deckHeightAtWorld(p.x, p.z) ?? s.pos.y + s.dims.deckY;
    return p;
  }

  dock(isl: Island) {
    const ship = ctx.ship;
    if (ship.docked) return;
    this.kaitoSteering = false;
    ship.docked = true;
    ship.sail = 0;
    ship.speed = 0;
    // Glide into the berth.
    const from = ship.pos.clone(), fromH = ship.heading;
    const to = isl.shipPark.clone();
    const toH = isl.shipParkHeading;
    let t = 0;
    const glide = () => {
      t = Math.min(1, t + ctx.dt * 0.7);
      const k = t * t * (3 - 2 * t);
      ship.pos.x = from.x + (to.x - from.x) * k;
      ship.pos.z = from.z + (to.z - from.z) * k;
      let dh = toH - fromH;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      ship.heading = fromH + dh * k;
      if (t < 1 && ship.docked) requestAnimationFrame(glide);
    };
    glide();
    ctx.progress.lastDock = isl.def.id;
    ctx.audio.sfx('bell');
    ctx.audio.sfx('creak');
    ctx.ui.toast(`Moored at ${isl.def.name}. Press E on deck to go ashore.`, 4);
    if (ctx.player.mode !== 'helm' && ctx.player.groundShip === ship) ctx.ui.say(COMPANION.name, pick(['Lines secured. Let\'s stretch our legs.', 'We\'re tied up. After you, Captain.', 'Moored. Try not to start a war... or do. Your call.']));
    this.save();
  }

  undock() {
    const ship = ctx.ship;
    if (!ship.docked) return;
    ship.docked = false;
    ship.sail = 1;
    ship.anchored = false;
    ctx.audio.sfx('creak');
  }

  private leap(to: THREE.Vector3, after?: () => void) {
    const p = ctx.player;
    const d = p.pos.distanceTo(to);
    p.play('leap', 'dash', 0.3, [], false);
    ctx.audio.sfx('jump', p.pos);
    p.leapTo(p.pos, to, 3 + d * 0.15, 0.55 + d * 0.012, () => { ctx.audio.sfx('land', p.pos); after?.(); });
  }

  private goAshore() {
    const isl = this.nearestBerth(ctx.ship.pos, 60);
    if (!isl) return;
    this.leap(this.pierPoint(isl, 4), () => {
      ctx.companion.placeNear(ctx.player.pos);
      const id = isl.def.id;
      if (!this.arrivedSaid.has(id) && isl.def.boss && !ctx.progress.cleared[id]) {
        this.arrivedSaid.add(id);
        ctx.ui.say(COMPANION.name, STORY.arrive[1].replace('Kaito: ', ''));
      }
    });
  }

  private boardOwnShip() {
    this.leap(this.shipDeckCenter(ctx.ship, -2), () => ctx.companion.placeOnShip('bow'));
  }

  private boardWreck(es: EnemyShip) {
    const target = this.shipDeckCenter(es.ship, 0);
    this.leap(target, () => {
      es.board();
      if (es.survivors.length) ctx.ui.say(COMPANION.name, 'Survivors! Clear the deck, Captain!');
      ctx.companion.placeNear(ctx.player.pos);
    });
  }

  private returnToShip() {
    this.leap(this.shipDeckCenter(ctx.ship, -2), () => ctx.companion.placeOnShip('bow'));
  }

  private fieldRepair() {
    const ship = ctx.ship;
    const pr = ctx.progress;
    if (this.repairCd > 0) return;
    if (ship.hp >= ship.hpMax) { ctx.ui.toast('The hull is in perfect shape.'); return; }
    if (pr.wood < 10 || pr.iron < 2) { ctx.ui.toast('Need 10 timber and 2 iron to patch the hull.'); ctx.audio.sfx('uiback'); return; }
    pr.wood -= 10; pr.iron -= 2;
    ship.repair(ship.hpMax * 0.3);
    this.repairCd = 5;
    ctx.audio.sfx('creak');
    ctx.audio.sfx('heal');
    const c = ship.center(V());
    ctx.particles.burst(c, 30, { speed: 5, up: 4, life: 1, size: 0.3, sizeEnd: 0.05, color: 0xffe0a0, gravity: 8 });
    ctx.ui.toast('Patched the hull! (+30%)');
    ctx.ui.say(COMPANION.name, pick(['Hammer, nails, prayer. Good as new.', 'That\'ll hold. Probably.']));
  }

  private openChest(c: Chest) {
    const isl = this.activeIsland;
    const L = Math.max(1, isl?.def.level ?? ctx.encounters.level);
    const tier = c.tier;
    const reward: Reward = tier >= 3
      ? { gold: randInt(260, 380) * L, iron: 4 + L, wood: 12, cola: 1, xp: 90 * L }
      : tier === 2 ? { gold: randInt(130, 200) * L, iron: 2 + Math.floor(L / 2), wood: 10, xp: 45 * L }
        : { gold: randInt(60, 100) * L, wood: randInt(5, 10), xp: 20 * L };
    c.open(reward);
    if (c.id !== 'wreck') ctx.progress.chests.push(c.id);
  }

  private talk(n: Npc) {
    const isl = this.activeIsland!;
    const cleared = ctx.progress.cleared[isl.def.id];
    let lines = n.spot.lines;
    if (n.spot.role === 'captive' && cleared) lines = ['You did it! We\'re free!', 'The whole island is singing your name, Captain!'];
    const line = lines[n.line % lines.length];
    n.line++;
    ctx.ui.say(n.spot.name, line);
    n.action = 'wave';
    n.actT = 0;
    ctx.audio.sfx('ui');
  }

  activeChests() { return this.chests.filter((c) => !c.opened).map((c) => c.pos); }
  activeEnemies() { return this.enemies.filter((e) => e.alive); }

  // ---- Island activation ------------------------------------------------------------
  private updateIslandActivation() {
    const p = ctx.player;
    const focus = p.mode === 'helm' ? ctx.ship.pos : p.pos;
    let isl = ctx.world.islandAt(focus.x, focus.z, 320);
    if (this.boss?.fighting) isl = this.activeIsland;
    if (isl === this.activeIsland) return;
    if (!isl && this.activeIsland && this.activeIsland.contains(focus.x, focus.z, 420)) return; // hysteresis
    this.clearIsland();
    if (isl) this.activateIsland(isl);
  }

  private clearIsland() {
    for (const e of this.enemies) e.dispose();
    this.enemies = [];
    for (const c of this.chests) c.dispose();
    this.chests = [];
    for (const n of this.npcs) { ctx.scene.remove(n.h.root); n.h.dispose(); }
    this.npcs = [];
    if (this.boss) { this.boss.dispose(); this.boss = null; ctx.ui.bossBar(null); }
    this.activeIsland = null;
  }

  private activateIsland(isl: Island) {
    this.activeIsland = isl;
    const pr = ctx.progress;
    const id = isl.def.id;
    const cleared = pr.cleared[id];
    for (const c of isl.chests) {
      const ch = new Chest(c.id, c.pos, c.rotY, c.tier);
      if (pr.chests.includes(c.id)) ch.setOpened();
      this.chests.push(ch);
    }
    if (!cleared && isl.def.boss) {
      const lv = isl.def.level;
      for (const g of isl.spawns) {
        for (let i = 0; i < g.count; i++) {
          const a = rand(0, Math.PI * 2), r = rand(0, g.radius);
          const x = g.pos.x + Math.cos(a) * r, z = g.pos.z + Math.sin(a) * r;
          const type: EnemyType = i === 0 && g.kind === 'camp' && lv >= 2 ? 'heavy' : Math.random() < 0.3 ? 'gunner' : 'brute';
          const e = new Enemy(factionLook(isl.def.style, type), type, lv, V(x, ctx.world.terrainHeight(x, z) + 0.2, z));
          e.onDeath = (en) => this.onEnemyKilled(en);
          this.enemies.push(e);
        }
      }
      if (isl.arena) {
        const b = new Boss(BOSSES[isl.def.boss], isl.arena, lv);
        b.onDefeat = () => this.onBossDefeated(b);
        b.onPhase = (ph) => this.onBossPhase(b, ph);
        if (isl.def.boss === 'gorrath') b.scriptedHook = (bb) => this.gorrathHook(bb);
        this.boss = b;
        this.bossDefeated = false;
      }
    }
    for (const spot of isl.npcs) {
      const h = new Humanoid(this.npcLook(spot, isl));
      h.root.position.copy(spot.pos);
      h.root.position.y = ctx.world.terrainHeight(spot.pos.x, spot.pos.z);
      h.root.rotation.y = spot.rotY;
      ctx.scene.add(h.root);
      this.npcs.push({ h, spot, line: 0, actT: 0, action: spot.role === 'captive' && !cleared ? 'kneel' : null, yaw: spot.rotY });
    }
    if (!this.islandBannerShown.has(id)) {
      this.islandBannerShown.add(id);
      ctx.ui.banner(isl.def.name, isl.def.title, 3.2, 'island');
      ctx.audio.sfx('bell');
      if (isl.def.boss && !cleared && id === pr.nextIsland && !this.arrivedSaid.has(id + 100)) {
        this.arrivedSaid.add(id + 100);
        ctx.ui.say(COMPANION.name, STORY.arrive[0].replace('Kaito: ', ''));
        ctx.ui.say(COMPANION.name, isl.def.lore[1]);
      }
    }
  }

  private npcLook(spot: NpcSpot, isl: Island): RigLook {
    const r = (a: string[]) => a[(spot.seed >>> 0) % a.length];
    const r2 = (a: string[]) => a[((spot.seed * 7) >>> 0) % a.length];
    const skins = ['#f6d3b3', '#f1c59b', '#d9a066', '#b07443', '#7a4a2a'];
    if (spot.role === 'shipwright') return { skin: '#d9a066', hair: '#c83a2a', hairStyle: 'topknot', shirt: '#e8e0c8', pants: '#5a4a3a', hat: 'bandana', hatColor: '#2f5fa8', vest: true, sash: '#8a5a2a', build: 1.15, outline: true, weapon: 'hammer' as RigLook['weapon'] };
    if (spot.role === 'elder') return { skin: r(skins), hair: '#e8e4dc', hairStyle: 'bald', shirt: '#6a5a8a', pants: '#3a3040', hat: 'none', beard: '#e8e4dc', build: 0.9, height: 0.92, outline: true };
    const cols = ['#c8282b', '#2f5fa8', '#e8e4d8', '#3f8a4a', '#e8a030', '#7a3ab0', '#3ab0b8', '#d8b04a'];
    const styleHat: Record<string, RigLook['hat']> = { tropical: 'straw', desert: 'bandana', snow: 'none', home: 'straw' };
    return {
      skin: r(skins), hair: r2(['#1d1a1a', '#5a3218', '#c8a060', '#e8e0d0', '#3a2a1a']), hairStyle: r2(['messy', 'long', 'topknot', 'spiky']) as RigLook['hairStyle'],
      shirt: r(cols), pants: r2(['#3a3040', '#5a4a3a', '#2f3f5a', '#e8e0c8']), hat: spot.role === 'captive' ? 'none' : (styleHat[isl.def.style] ?? 'none'), hatColor: '#e9c46a',
      outline: true, build: 0.9 + ((spot.seed % 5) / 10), height: 0.92 + ((spot.seed % 3) / 20),
    };
  }

  private updateNpcs(dt: number) {
    const p = ctx.player;
    for (const n of this.npcs) {
      const d = n.h.root.position.distanceTo(p.pos);
      if (d < 7) {
        const want = Math.atan2(p.pos.x - n.h.root.position.x, p.pos.z - n.h.root.position.z);
        let diff = want - n.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        n.yaw += diff * Math.min(1, dt * 4);
      }
      n.h.root.rotation.y = n.yaw;
      if (n.action === 'kneel') {
        n.h.update(dt, { speed: 0, grounded: true, vy: 0, action: 'kneel', actionT: 0.5 });
        continue;
      }
      if (n.action) {
        n.actT += dt / 1.6;
        if (n.actT >= 1) n.action = null;
      } else if (d < 9 && Math.random() < dt * 0.15) { n.action = 'wave'; n.actT = 0; }
      n.h.update(dt, { speed: 0, grounded: true, vy: 0, action: n.action, actionT: n.actT });
    }
  }

  // ---- Combat outcomes --------------------------------------------------------------
  onEnemyKilled(en: Enemy) {
    if (en.rewarded) return;
    en.rewarded = true;
    const L = Math.max(1, en.level);
    const pr = ctx.progress;
    pr.bounty += (en.type === 'heavy' ? 900_000 : 300_000) * L;
    this.addXP(Math.round((en.type === 'heavy' ? 70 : 28) * (1 + L * 0.5)));
    const gold = randInt(8, 18) * L * (en.type === 'heavy' ? 3 : 1);
    pr.gold += gold;
    if (Math.random() < 0.3) pr.iron += 1;
    ctx.ui.damageNumber(en.pos.clone().add(V(0, 2.4, 0)), gold, '#ffd34a', false, false);
    ctx.audio.sfx('coin', en.pos, 0.5);
  }

  giveLoot(r: Reward, pos: THREE.Vector3) {
    const pr = ctx.progress;
    const parts: string[] = [];
    if (r.gold) { pr.gold += r.gold; parts.push(`+${r.gold.toLocaleString()} ฿`); }
    if (r.wood) { pr.wood += r.wood; parts.push(`+${r.wood} timber`); }
    if (r.iron) { pr.iron += r.iron; parts.push(`+${r.iron} iron`); }
    if (r.cola) { pr.cola += r.cola; parts.push(`+${r.cola} Burst Cola`); }
    if (r.xp) { this.addXP(r.xp); parts.push(`+${r.xp} XP`); }
    if (parts.length) ctx.ui.toast(parts.join('  ·  '), 3);
    ctx.audio.sfx('coin', pos, 1);
  }

  addXP(n: number) {
    const pr = ctx.progress;
    pr.xp += Math.round(n);
    let leveled = false;
    while (pr.xp >= xpForLevel(pr.level) && pr.level < 40) {
      pr.xp -= xpForLevel(pr.level);
      pr.level++;
      leveled = true;
    }
    if (leveled) {
      const p = ctx.player;
      p.hpMax = maxHpFor(pr.level);
      p.hp = p.hpMax;
      p.energy = p.energyMax;
      ctx.ui.banner('LEVEL UP!', `Level ${pr.level} · Max HP ${p.hpMax} · Power +7%`, 2.4, 'win');
      ctx.audio.sfx('levelup');
      ctx.fx.shockwave(p.pos.clone().add(V(0, 0.2, 0)), 4, 0xffe070, 0.6, 0.5);
      ctx.particles.burst(p.pos.clone().add(V(0, 1, 0)), 50, { speed: 4, up: 6, life: 1.2, size: 0.25, sizeEnd: 0.02, color: 0xffe070, additive: true, gravity: -2 });
    }
  }

  onPlayerLethal(): boolean {
    if (this.cut || this.awakening) return true;
    const b = this.boss;
    if (b && b.fighting && b.def.id === 'gorrath' && !ctx.player.awakened) { this.triggerAwakening(b); return true; }
    return false;
  }

  onPlayerDeath() {
    if (this.deathPending) return;
    this.deathPending = true;
    ctx.timeScale = 0.4;
    ctx.ui.clearSay();
    setTimeout(() => {
      ctx.timeScale = 1;
      this.deathPending = false;
      if (this.state !== 'play') return;
      this.state = 'dead';
      this.unlock();
      const b = this.boss;
      this.menus.showDead(b?.fighting ? `${b.def.name}: "${pick(['Is that all?', 'Come back when you\'re stronger.', 'Pathetic.'])}"` : 'Kaito drags you back to safety...');
      ctx.ui.setScreen('dead');
      ctx.audio.playMusic('none', 1);
    }, 2200);
  }

  respawn() {
    const p = ctx.player;
    const pr = ctx.progress;
    const lost = Math.floor(pr.gold * 0.1);
    pr.gold -= lost;
    const b = this.boss;
    if (b && b.fighting) {
      b.endFight();
      b.hp = b.hpMax;
      b.phase = 1;
      b.pos.copy(b.arena.pos);
      for (const m of b.minions) if (m.alive) { m.hp = 0; m.die(); }
      ctx.ui.bossBar(null);
      ctx.env.darken = 0;
    }
    p.alive = true;
    p.hp = p.hpMax;
    p.energy = p.energyMax;
    p.action = null;
    p.deathTime = 0;
    p.mode = 'foot';
    const ship = ctx.ship;
    const isl = this.activeIsland;
    if (isl && ship.docked && this.nearestBerth(ship.pos, 60) === isl) p.teleport(this.pierPoint(isl, 10));
    else { p.teleport(this.shipDeckCenter(ship, -2)); p.groundShip = ship; }
    ctx.companion.placeNear(p.pos);
    this.state = 'play';
    ctx.ui.setScreen('hud');
    ctx.input.requestLock();
    if (lost > 0) ctx.ui.toast(`You dropped ${lost} ฿ while unconscious.`, 3);
    this.restoreMusic();
  }

  rescuePlayer() {
    const p = ctx.player;
    const ship = ctx.ship;
    const isl = this.activeIsland;
    if (ship.pos.distanceTo(p.pos) < 140 || !isl) {
      p.teleport(this.shipDeckCenter(ship, -2));
      p.groundShip = ship;
    } else {
      // Pull them up onto the nearest dry ground, toward the island's heart.
      const dir = V(isl.cx - p.pos.x, 0, isl.cz - p.pos.z).normalize();
      const q = p.pos.clone();
      for (let i = 0; i < 80; i++) {
        q.addScaledVector(dir, 3);
        if (ctx.world.terrainHeight(q.x, q.z) > 1.2) { q.addScaledVector(dir, 3); break; }
      }
      q.y = ctx.world.terrainHeight(q.x, q.z) + 0.5;
      p.teleport(q);
    }
    ctx.companion.placeNear(p.pos);
    ctx.audio.sfx('splash', p.pos, 0.8);
  }

  private onShipSunk() {
    const ship = ctx.ship;
    ctx.ui.banner('SHIP DOWN!', `The ${ctx.progress.shipName} is sinking!`, 3, 'boss');
    ctx.ui.say(COMPANION.name, 'We\'re taking on water! Abandon ship!');
    this.kaitoSteering = false;
    setTimeout(async () => {
      await ctx.ui.fade(true, 0.8);
      const pr = ctx.progress;
      const isl = ctx.world.islands[clamp(pr.lastDock, 0, ISLANDS.length - 1)];
      ctx.encounters.clearAll();
      ship.alive = true;
      ship.sinking = 0;
      ship.wreck = false;
      ship.hp = ship.hpMax * 0.5;
      ship.smoke = 0;
      if (ctx.player.mode === 'helm') ctx.player.leaveHelm();
      this.mooredAt(isl);
      const p = ctx.player;
      p.alive = true; p.hp = p.hpMax; p.mode = 'foot';
      p.teleport(this.pierPoint(isl, 10));
      ctx.companion.placeNear(p.pos);
      const lost = Math.floor(pr.gold * 0.15);
      pr.gold -= lost;
      ctx.ui.toast(`Towed back to ${isl.def.name}. Repairs cost ${lost} ฿.`, 5);
      await ctx.ui.fade(false, 0.8);
    }, 3500);
  }

  // ---- Boss fights --------------------------------------------------------------------
  private checkBossTrigger() {
    const b = this.boss!;
    if (b.fighting || !b.alive || this.cut || this.bossDefeated) return;
    const p = ctx.player;
    if (p.pos.distanceTo(b.arena.pos) < b.arena.radius - 3 && p.grounded) this.startBossIntro(b);
  }

  private startBossIntro(b: Boss) {
    const p = ctx.player;
    p.mode = 'locked';
    p.action = null;
    ctx.ui.letterbox(true);
    ctx.audio.playMusic('none', 0.6);
    const toP = p.pos.clone().sub(b.pos).setY(0).normalize();
    b.yaw = Math.atan2(toP.x, toP.z);
    const head = () => b.pos.clone().add(V(0, b.height * 0.85, 0));
    const finalStyle = b.def.id === 'vexis';
    if (finalStyle) { ctx.env.darken = 0.35; }
    this.runCutscene(5.2, [
      [0, () => {
        const side = V(-toP.z, 0, toP.x);
        ctx.cam.setShot({ pos: head().addScaledVector(toP, 6 + b.scale * 3).addScaledVector(side, 3).add(V(0, -0.4 * b.scale, 0)), look: head(), fov: 42 }, true);
        b.cutscene = true;
      }],
      [0.6, () => { b.play('roar', 'roar', 1.6); ctx.audio.sfx('roar', b.pos, 1.4); ctx.fx.shake(0.8); ctx.fx.shockwave(b.pos.clone().add(V(0, 0.3, 0)), 14, b.def.color, 1, 1.2); }],
      [0.8, () => { ctx.ui.banner(b.def.name.toUpperCase(), b.def.title, 3.4, 'boss'); ctx.audio.sfx('gong'); }],
      [1.6, () => ctx.ui.say(b.def.name, b.def.intro)],
      [3.6, () => {
        ctx.cam.setShot({ pos: p.pos.clone().addScaledVector(toP, 4).add(V(0, 2.2, 0)).addScaledVector(V(-toP.z, 0, toP.x), -2), look: b.pos.clone().add(V(0, b.height * 0.5, 0)), fov: 50 });
        p.play('powerup', 'powerup', 1.4, [], true);
        ctx.ui.say(ctx.progress.name, pick(['I\'m going to be the one who reaches the Last Dawn. Move.', 'Get out of my way.', 'Big talk. Let\'s see you back it up!']));
      }],
    ], undefined, () => {
      b.cutscene = false;
      b.startFight();
      p.mode = 'foot';
      ctx.ui.letterbox(false);
      ctx.cam.setShot(null);
      ctx.ui.bossBar(b);
      ctx.audio.playMusic('boss', 0.5);
      if (ctx.companion.pos.distanceTo(p.pos) > 20) ctx.companion.placeNear(p.pos);
      ctx.ui.toast('Dodge with Q. Watch for the red warnings!', 3);
    });
  }

  private onBossPhase(b: Boss, ph: number) {
    const lines: Record<string, string[]> = {
      barnacle: ['', '', 'Crew! Get out here and earn your rum!'],
      kazan: ['', '', 'You want to see real fire? I\'ll melt this whole mountain!'],
      borr: ['', '', 'The storm wakes. The cold... deepens.'],
      gorrath: ['', '', 'Now THIS is a fight! Don\'t you dare die on me yet!', 'HAHAHA! LEGION! Join the feast!'],
      zahra: ['', '', 'Enough games. Let the desert swallow you whole.'],
      vexis: ['', '', 'Kneel before the Eternal Night!', 'I AM THE ECLIPSE. I AM FOREVER.'],
    };
    const l = lines[b.def.id]?.[ph];
    if (l) ctx.ui.say(b.def.name, l);
    ctx.ui.banner(ph >= 3 ? 'FINAL PHASE' : 'PHASE ' + ph, b.def.name + ' is enraged!', 2, 'boss');
    if (b.def.id === 'vexis' && ph === 2) ctx.env.forceStorm = 0.6;
  }

  private gorrathHook(b: Boss): boolean {
    if (ctx.player.awakened || this.awakening) return false;
    if (b.hp / b.hpMax <= 0.55) { b.hp = b.hpMax * 0.55; this.triggerAwakening(b); return true; }
    return false;
  }

  /** The turning point: at death's door against Gorrath, the fruit awakens. */
  private triggerAwakening(b: Boss) {
    if (this.awakening || ctx.player.awakened) return;
    this.awakening = true;
    const p = ctx.player;
    const pr = ctx.progress;
    const def = FRUITS[p.fruit];
    const col = def.awakenColor;
    const colCss = '#' + col.toString(16).padStart(6, '0');
    p.mode = 'locked';
    p.action = null;
    p.hp = Math.max(1, p.hp);
    b.cutscene = true;
    b.action = null;
    ctx.projectiles.update(10); // clear in-flight shots
    ctx.ui.letterbox(true);
    ctx.ui.bossBar(null);
    ctx.audio.playMusic('none', 0.3);
    const toB = b.pos.clone().sub(p.pos).setY(0).normalize();
    p.yaw = Math.atan2(toB.x, toB.z);
    const side = V(-toB.z, 0, toB.x);
    const pHead = () => p.pos.clone().add(V(0, 1.2, 0));
    let gather = false;
    this.runCutscene(12, [
      [0, () => {
        ctx.timeScale = 0.25;
        ctx.fx.flash('#ffffff', 0.8, 0.5);
        ctx.audio.sfx('hit', p.pos, 1.4);
        p.play('down', 'kneel', 6.6, [], true);
        ctx.env.darken = 0.75;
        ctx.env.forceStorm = 1;
        ctx.cam.setShot({ pos: pHead().addScaledVector(toB, -3.6).addScaledVector(side, 2.2).add(V(0, 1.0, 0)), look: b.pos.clone().add(V(0, b.height * 0.7, 0)), fov: 48 }, true);
      }],
      [0.6, () => { ctx.timeScale = 1; ctx.ui.say(b.def.name, 'Is that it? Is THAT all the Dawn has to offer? How boring.'); }],
      [2.0, () => { ctx.audio.sfx('heartbeat', p.pos, 1.5); ctx.cam.setShot({ pos: p.pos.clone().addScaledVector(toB, 3.0).addScaledVector(side, 0.8).add(V(0, 0.55, 0)), look: p.pos.clone().add(V(0, 0.95, 0)), fov: 38 }); }],
      [3.0, () => ctx.audio.sfx('heartbeat', p.pos, 1.7)],
      [3.6, () => { ctx.ui.say(COMPANION.name, `${pr.name}! GET UP!`); ctx.audio.sfx('heartbeat', p.pos, 2); }],
      [4.4, () => { ctx.audio.sfx('heartbeat', p.pos, 2.2); ctx.audio.sfx('drum', p.pos, 1); }],
      [5.0, () => {
        ctx.audio.sfx('heartbeat', p.pos, 2.4); ctx.audio.sfx('drum', p.pos, 1.2);
        ctx.ui.say(pr.name, '...I can hear it. The drums... of liberation.');
        gather = true;
        ctx.cam.setShot({ pos: pHead().addScaledVector(toB, 5).addScaledVector(side, -2.4).add(V(0, -0.6, 0)), look: pHead().add(V(0, 0.4, 0)), fov: 44 });
      }],
      [6.0, () => { ctx.audio.sfx('drum', p.pos, 1.4); ctx.audio.sfx('power', p.pos, 0.8); }],
      [6.6, () => { ctx.audio.sfx('drum', p.pos, 1.6); p.play('rise', 'powerup', 3.2, [], true); }],
      [7.4, () => {
        gather = false;
        ctx.audio.playMusic('awaken', 0.1);
        ctx.audio.sfx('thunder', p.pos, 1.5);
        ctx.audio.sfx('power', p.pos, 1.5);
        ctx.fx.flash(colCss, 1, 1.6);
        ctx.fx.shake(2);
        p.setAwakened(true);
        p.awakened = true;
        pr.awakened = true;
        p.hp = p.hpMax;
        p.energy = p.energyMax;
        p.ult = 100;
        const c = p.pos.clone().add(V(0, 1, 0));
        ctx.fx.shockwave(p.pos.clone().add(V(0, 0.3, 0)), 40, col, 1.6, 3);
        ctx.fx.shockwave(p.pos.clone().add(V(0, 0.3, 0)), 24, def.color, 1.2, 2);
        ctx.fx.sphere(c, 6, col, 1.0, 0.8);
        ctx.fx.light(c, col, 200, 3, 80);
        for (let i = 0; i < 6; i++) {
          const a = i / 6 * Math.PI * 2;
          ctx.fx.lightning(p.pos.clone().add(V(Math.cos(a) * 6, 40, Math.sin(a) * 6)), p.pos.clone().add(V(Math.cos(a) * 3, 0, Math.sin(a) * 3)), col, 0.5, 0.6, 3);
        }
        ctx.particles.burst(c, 260, { speed: 22, up: 8, life: 2, size: 0.6, sizeEnd: 0.02, color: col, colorEnd: def.color, additive: true, gravity: 1 });
        ctx.ui.banner('AWAKENING', def.awakenedName.toUpperCase(), 4, 'awaken');
        ctx.cam.setShot({ pos: pHead().addScaledVector(side, 6.5).addScaledVector(toB, 1.2).add(V(0, 0.6, 0)), look: pHead().add(V(0, 0.4, 0)), fov: 50 }, true);
        ctx.env.darken = 0.3;
        b.knock.copy(toB).multiplyScalar(20);
        b.play('hit', 'hit', 0.8);
      }],
      [9.0, () => ctx.ui.say(b.def.name, 'HAHAHA! THAT\'S IT! THAT\'S THE POWER I WANTED TO FIGHT!')],
      [10.4, () => {
        ctx.ui.say(COMPANION.name, `Captain... your power... it's changed!`);
        ctx.cam.setShot({ pos: b.pos.clone().addScaledVector(toB, -10).add(V(0, 6, 0)).addScaledVector(side, 6), look: b.pos.clone().add(V(0, 3, 0)), fov: 55 });
      }],
    ], (t, dt) => {
      if (gather && Math.random() < 0.9) {
        const a = rand(0, Math.PI * 2), r = rand(6, 14);
        const from = p.pos.clone().add(V(Math.cos(a) * r, rand(0, 6), Math.sin(a) * r));
        const vel = p.pos.clone().add(V(0, 1, 0)).sub(from).multiplyScalar(1.4);
        ctx.particles.emit({ pos: from, vel, life: 0.7, size: 0.35, sizeEnd: 0.05, color: col, additive: true });
      }
      void t; void dt;
    }, () => {
      this.awakening = false;
      b.cutscene = false;
      if (b.phase < 2) b.enterPhase(2);
      p.mode = 'foot';
      p.action = null;
      ctx.ui.letterbox(false);
      ctx.cam.setShot(null);
      ctx.ui.bossBar(b);
      ctx.env.forceStorm = -1;
      ctx.env.darken = 0;
      ctx.ui.toast('Your fruit has AWAKENED! Press 4 to unleash your ultimate. Abilities recharge faster.', 6);
      this.save();
    });
  }

  private onBossDefeated(b: Boss) {
    if (this.bossDefeated) return;
    this.bossDefeated = true;
    const p = ctx.player;
    const pr = ctx.progress;
    const isl = this.activeIsland!;
    const id = isl.def.id;
    const isFinal = id === FINAL_ISLAND;
    ctx.ui.bossBar(null);
    p.mode = 'locked';
    p.action = null;
    ctx.ui.letterbox(true);
    ctx.audio.playMusic('none', 0.4);
    for (const e of this.enemies) if (e.alive && e.pos.distanceTo(b.pos) < 80) { e.hp = 0; e.die(); }
    const head = () => b.pos.clone().add(V(0, b.height * 0.6, 0));
    const toP = p.pos.clone().sub(b.pos).setY(0).normalize();
    this.runCutscene(isFinal ? 9 : 6.5, [
      [0, () => {
        ctx.timeScale = 0.2;
        ctx.fx.flash('#ffffff', 0.9, 0.8);
        ctx.fx.shockwave(b.pos.clone().add(V(0, 0.4, 0)), 30, b.def.color, 1.4, 2.5);
        ctx.fx.explosion(head(), 2.5, b.def.color);
        ctx.audio.sfx('explosion', b.pos, 1.5);
        ctx.cam.setShot({ pos: head().addScaledVector(toP, 7 + b.scale * 2).add(V(0, 1.5, 0)).addScaledVector(V(-toP.z, 0, toP.x), 4), look: head(), fov: 45 }, true);
      }],
      [0.5, () => { ctx.timeScale = 1; }],
      [1.2, () => ctx.ui.say(b.def.name, b.def.defeat)],
      [2.6, () => {
        ctx.ui.banner(isFinal ? 'THE DAWN RETURNS' : 'VICTORY!', `${b.def.name} has fallen!`, 3.5, 'win');
        ctx.audio.sfx('gong');
        ctx.audio.playMusic(isFinal ? 'ending' : 'explore', 1);
        p.play('victory', 'victory', 2.2, [], true);
        ctx.cam.setShot({ pos: p.pos.clone().addScaledVector(p.facing(), 4.5).add(V(0, 1.6, 0)), look: p.pos.clone().add(V(0, 1.3, 0)), fov: 46 });
        if (isFinal) { ctx.env.darken = 0; ctx.env.forceStorm = 0; }
      }],
      [4.4, () => ctx.ui.say(COMPANION.name, isFinal ? 'We... we actually did it. The Last Dawn.' : pick(['Not bad, Captain. Not bad at all.', 'Another one for the bounty poster.', 'Hah. I barely broke a sweat.']))],
    ], (t) => { if (isFinal && t > 2.6) ctx.env.timeOfDay += (0.27 - ctx.env.timeOfDay) * 0.01; }, () => {
      p.mode = 'foot';
      ctx.ui.letterbox(false);
      ctx.cam.setShot(null);
      // Rewards and progression.
      pr.cleared[id] = true;
      pr.bounty += b.def.bounty;
      this.addXP(600 * isl.def.level);
      this.giveLoot({ gold: 900 * isl.def.level, iron: 8 * isl.def.level, wood: 30, cola: 2 }, p.pos);
      if (id === pr.nextIsland) pr.nextIsland = Math.min(ISLANDS.length, pr.nextIsland + 1);
      for (const n of this.npcs) if (n.action === 'kneel') { n.action = 'wave'; n.actT = 0; }
      ctx.ui.poster(pr.name, pr.bounty, pr.look, pr.fruit, 6.5);
      if (b.def.id === 'gorrath') ctx.ui.toast('The Calamity has fallen! The whole Grand Meridian will hear of this.', 5);
      this.save();
      if (isFinal) { pr.finished = true; this.save(); setTimeout(() => this.playEnding(), 6500); }
      else {
        const next = ISLANDS[pr.nextIsland];
        setTimeout(() => ctx.ui.say(COMPANION.name, `The Log Pose is swinging... it's pointing toward ${next.name}. Let's get back to the ship.`), 4000);
        if (id === AWAKEN_ISLAND - 1 && !pr.awakened) setTimeout(() => ctx.ui.say(COMPANION.name, 'Thunderhold is next. They say the Calamity has never lost. Rest up. Upgrade the ship.'), 9000);
      }
    });
  }

  private async playEnding() {
    await ctx.ui.fade(true, 1.5);
    this.state = 'ending';
    this.unlock();
    ctx.ui.setScreen('ending');
    this.menus.rollCredits();
    ctx.env.timeOfDay = 0.27;
    await ctx.ui.fade(false, 1.5);
  }

  // ---- Voyage chatter and objectives ----------------------------------------------------
  private updateVoyageChatter(real: number) {
    const pr = ctx.progress;
    const ship = ctx.ship;
    const p = ctx.player;
    const onShip = p.groundShip === ship || p.mode === 'helm';
    if (onShip && !ship.docked && this.sailTipIdx < STORY.sailTips.length) {
      this.sailTipT -= real;
      if (this.sailTipT <= 0 && !ctx.ui.speaking) {
        this.sailTipT = 22;
        ctx.ui.say(COMPANION.name, STORY.sailTips[this.sailTipIdx++].replace('Kaito: ', ''));
      }
    }
    // Shout when the Log Pose island comes into view.
    const nid = pr.nextIsland;
    if (nid < ISLANDS.length && !this.arrivedSaid.has(nid + 200)) {
      const isl = ctx.world.islands[nid];
      if (Math.hypot(isl.cx - ship.pos.x, isl.cz - ship.pos.z) < isl.R + 700) {
        this.arrivedSaid.add(nid + 200);
        ctx.ui.say(COMPANION.name, `Land ho! That must be ${isl.def.name}. ${isl.def.lore[0]}`);
        if (nid === AWAKEN_ISLAND) ctx.ui.say(COMPANION.name, 'That banner... it\'s Gorrath. The Calamity. Captain, whatever happens in there... don\'t you dare die.');
        if (nid === FINAL_ISLAND) ctx.ui.say(COMPANION.name, 'Solhaven. The end of the Grand Meridian. This is it.');
      }
    }
  }

  private updateObjective() {
    const pr = ctx.progress;
    const p = ctx.player;
    const ship = ctx.ship;
    if (pr.finished) { ctx.ui.objective('The seas are yours. Sail wherever you like.'); return; }
    const next = ctx.world.islands[Math.min(pr.nextIsland, ISLANDS.length - 1)];
    const b = this.boss;
    if (b?.fighting) { ctx.ui.objective(`Defeat ${b.def.name}`); return; }
    const onShip = p.groundShip === ship || p.mode === 'helm';
    if (this.activeIsland === next) {
      if (onShip && ship.docked) ctx.ui.objective('Go ashore and find the island\'s boss');
      else if (!onShip) ctx.ui.objective(`Find and defeat ${BOSSES[next.def.boss!].name}, follow the Log Pose`);
      else ctx.ui.objective(`Moor at the ${next.def.name} pier (glowing beacon)`);
      return;
    }
    if (!onShip && ship.docked) { ctx.ui.objective(`Return to the ${pr.shipName} and set sail`); return; }
    if (onShip && ship.docked) { ctx.ui.objective(`Set sail for ${next.def.name}: take the helm [F] or let Kaito steer [T]`); return; }
    ctx.ui.objective(`Sail to ${next.def.name}`);
  }
}

// Debug hooks for testing in the browser console.
declare global { interface Window { __game: Game; __ctx: typeof ctx; __mods: Record<string, unknown> } }
export function exposeDebug(g: Game) {
  window.__game = g;
  window.__ctx = ctx;
  window.__mods = { THREE, Humanoid, factionLook, BOSSES };
}
