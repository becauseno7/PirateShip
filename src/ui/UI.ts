// DOM overlay: HUD (vitals, Log Pose compass, minimap, abilities, ship
// panel), speech, toasts, banners, damage numbers, boss bar and screens.
import * as THREE from 'three';
import { ctx } from '../game/ctx';
import { FRUITS, ISLANDS, FruitId } from '../game/data';
import { xpForLevel, Look } from '../game/state';
import { MapView } from './MapView';
import { angleDiff, formatBerry } from '../core/math';
import type { Boss } from '../entities/Boss';

export type Screen = 'loading' | 'title' | 'create' | 'fruit' | 'hud' | 'pause' | 'map' | 'shop' | 'dead' | 'ending' | 'none';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const hexCss = (c: number) => '#' + c.toString(16).padStart(6, '0');

export const ABILITY_GLYPHS: Record<FruitId, string[]> = {
  blaze: ['☄', '♨', '➹', '☀'],
  stretch: ['✊', '✺', '➶', '☻'],
  thunder: ['ϟ', '☈', '➽', '✷'],
  frost: ['❄', '❅', '➷', '✻'],
  quake: ['✸', '◎', '⇣', '✪'],
};

interface DmgNum { el: HTMLDivElement; pos: THREE.Vector3; life: number; max: number; vy: number; big: boolean }
interface Line { name: string; text: string; at: number }

export class UI {
  root: HTMLElement;
  screens: Record<string, HTMLElement> = {};
  screen: Screen = 'loading';
  hud: HTMLElement;
  map!: MapView;
  private els: Record<string, HTMLElement> = {};
  private dmg: DmgNum[] = [];
  private dmgPool: HTMLDivElement[] = [];
  private dmgLayer: HTMLElement;
  private toasts: HTMLElement;
  private sayBox: HTMLElement;
  private sayQueue: Line[] = [];
  private sayT = 0;
  private bannerEl: HTMLElement;
  private bannerT = 0;
  private vignetteT = 0;
  private compass!: HTMLCanvasElement;
  private abilitySlots: HTMLElement[] = [];
  private bossRef: Boss | null = null;
  private bossShownHp = 1;
  private lastFruit: FruitId | null = null;
  private tmp = new THREE.Vector3();
  promptText: string | null = null;

  constructor() {
    this.root = document.getElementById('ui')!;
    this.hud = el('div', 'hud hidden');
    this.root.appendChild(this.hud);
    this.dmgLayer = el('div', 'dmg-layer');
    this.root.appendChild(this.dmgLayer);
    this.buildHud();
    this.toasts = el('div', 'toasts');
    this.sayBox = el('div', 'say hidden', '<div class="say-name"></div><div class="say-text"></div>');
    this.bannerEl = el('div', 'banner hidden', '<div class="banner-title"></div><div class="banner-sub"></div>');
    const vignette = el('div', 'vignette');
    const letter = el('div', 'letterbox', '<div class="lb-top"></div><div class="lb-bot"></div>');
    const fade = el('div', 'fade');
    this.els.vignette = vignette;
    this.els.letterbox = letter;
    this.els.fade = fade;
    this.root.append(this.toasts, this.sayBox, this.bannerEl, vignette, letter, fade);
    const loading = el('div', 'screen loading', `
      <div class="loading-inner">
        <div class="logo"><span class="logo-top">GRAND</span><span class="logo-main">MERIDIAN</span><span class="logo-sub">Voyage to the Last Dawn</span></div>
        <div class="load-bar"><div class="load-fill"></div></div>
        <div class="load-label">Hoisting the sails...</div>
      </div>`);
    this.screens.loading = loading;
    this.root.appendChild(loading);
  }

  // ---- HUD construction -----------------------------------------------------
  private buildHud() {
    const h = this.hud;
    h.innerHTML = `
      <div class="vitals">
        <div class="portrait"><div class="portrait-fruit"></div><div class="lvl">1</div></div>
        <div class="bars">
          <div class="pname"></div>
          <div class="bar hp"><div class="bar-lag"></div><div class="bar-fill"></div><span class="bar-text"></span></div>
          <div class="bar en"><div class="bar-fill"></div></div>
          <div class="bar xp"><div class="bar-fill"></div></div>
        </div>
      </div>
      <div class="compass-wrap">
        <canvas class="compass" width="560" height="54"></canvas>
        <div class="logpose"><span class="lp-label">LOG POSE</span> <span class="lp-name"></span> <span class="lp-dist"></span></div>
        <div class="objective"></div>
      </div>
      <div class="boss hidden">
        <div class="boss-name"></div><div class="boss-title"></div>
        <div class="boss-bar"><div class="boss-lag"></div><div class="boss-fill"></div><div class="boss-tick t50"></div><div class="boss-tick t25"></div></div>
      </div>
      <div class="topright">
        <div class="mini-wrap"><canvas class="minimap" width="200" height="200"></canvas><div class="mini-n">N</div><div class="mini-hint">M · Map</div></div>
        <div class="bounty"><span class="bounty-label">BOUNTY</span><span class="bounty-val"></span></div>
        <div class="res">
          <div class="r gold" title="Berries"><i>฿</i><span></span></div>
          <div class="r wood" title="Timber"><i>▤</i><span></span></div>
          <div class="r iron" title="Iron"><i>⛓</i><span></span></div>
          <div class="r cola" title="Burst Cola"><i>✚</i><span></span></div>
        </div>
      </div>
      <div class="shippanel hidden">
        <div class="ship-name"></div>
        <div class="bar shiphp"><div class="bar-fill"></div><span class="bar-text"></span></div>
        <div class="ship-row"><div class="sails"><b></b><b></b><b></b></div><div class="knots"></div></div>
        <div class="ship-row"><div class="reload"><div class="reload-fill"></div><span>CANNONS</span></div><div class="steer"></div></div>
      </div>
      <div class="abilities"></div>
      <div class="ultmeter hidden"><div class="ult-fill"></div><span>AWAKENED</span></div>
      <div class="prompt hidden"></div>
      <div class="crosshair"></div>
      <div class="keyhints"></div>
    `;
    const q = (s: string) => h.querySelector(s) as HTMLElement;
    this.els = {
      ...this.els,
      portraitFruit: q('.portrait-fruit'), lvl: q('.lvl'), pname: q('.pname'),
      hpFill: q('.hp .bar-fill'), hpLag: q('.hp .bar-lag'), hpText: q('.hp .bar-text'),
      enFill: q('.en .bar-fill'), xpFill: q('.xp .bar-fill'),
      lpName: q('.lp-name'), lpDist: q('.lp-dist'), objective: q('.objective'),
      boss: q('.boss'), bossName: q('.boss-name'), bossTitle: q('.boss-title'), bossFill: q('.boss-fill'), bossLag: q('.boss-lag'), bossT25: q('.t25'),
      bountyVal: q('.bounty-val'), gold: q('.gold span'), wood: q('.wood span'), iron: q('.iron span'), cola: q('.cola span'),
      shippanel: q('.shippanel'), shipName: q('.ship-name'), shipFill: q('.shiphp .bar-fill'), shipText: q('.shiphp .bar-text'),
      sails: q('.sails'), knots: q('.knots'), reloadFill: q('.reload-fill'), steer: q('.steer'),
      abilities: q('.abilities'), ultmeter: q('.ultmeter'), ultFill: q('.ult-fill'), prompt: q('.prompt'), crosshair: q('.crosshair'), keyhints: q('.keyhints'),
    };
    this.compass = q('.compass') as HTMLCanvasElement;
    const mini = q('.minimap') as HTMLCanvasElement;
    const mapScreen = el('div', 'screen worldmap hidden', `
      <div class="map-frame">
        <div class="map-title">Chart of the Grand Meridian</div>
        <canvas class="bigmap"></canvas>
        <div class="map-legend">
          <span><i class="lg-star"></i>Log Pose target</span><span><i class="lg-ship"></i>Your ship</span><span><i class="lg-skull"></i>Island boss</span><span><i class="lg-x"></i>Liberated</span>
          <span class="map-keys">Drag to pan · Scroll to zoom · M / Esc to close</span>
        </div>
      </div>`);
    this.screens.map = mapScreen;
    this.root.appendChild(mapScreen);
    this.map = new MapView(mini, mapScreen.querySelector('.bigmap') as HTMLCanvasElement);
  }

  private buildAbilities(fruit: FruitId) {
    const def = FRUITS[fruit];
    const wrap = this.els.abilities;
    wrap.innerHTML = '';
    this.abilitySlots = [];
    const basic = el('div', 'slot basic', `<div class="slot-icon">✊</div><div class="slot-key">LMB</div><div class="slot-name">Combo</div>`);
    wrap.appendChild(basic);
    const slots = [...def.abilities, def.ultimate];
    slots.forEach((ab, i) => {
      const s = el('div', 'slot' + (i === 3 ? ' ult' : ''), `
        <div class="slot-icon">${ABILITY_GLYPHS[fruit][i]}</div>
        <div class="slot-cd"></div>
        <div class="slot-key">${i === 3 ? '4' : i + 1}</div>
        <div class="slot-cost">${i === 3 ? '' : ab.cost}</div>
        <div class="slot-name">${ab.name}</div>
        <div class="slot-lock">✖</div>`);
      s.style.setProperty('--c1', hexCss(def.color));
      s.style.setProperty('--c2', hexCss(def.color2));
      s.title = `${ab.name}: ${ab.desc}`;
      wrap.appendChild(s);
      this.abilitySlots.push(s);
    });
    const dodge = el('div', 'slot basic', `<div class="slot-icon">➠</div><div class="slot-key">Q</div><div class="slot-name">Dodge</div>`);
    wrap.appendChild(dodge);
    this.els.portraitFruit.style.background = `radial-gradient(circle at 35% 30%, ${hexCss(def.color2)}, ${hexCss(def.color)} 60%, #1a0a20)`;
    this.els.portraitFruit.textContent = ABILITY_GLYPHS[fruit][3];
    this.lastFruit = fruit;
  }

  // ---- Screens --------------------------------------------------------------
  addScreen(name: string, node: HTMLElement) {
    node.classList.add('screen', 'hidden');
    this.screens[name] = node;
    this.root.appendChild(node);
  }

  setScreen(s: Screen) {
    this.screen = s;
    for (const [k, node] of Object.entries(this.screens)) node.classList.toggle('hidden', k !== s);
    const hudOn = s === 'hud' || s === 'map';
    this.hud.classList.toggle('hidden', !hudOn);
    if (s === 'map') this.map.openBig(); else this.map.closeBig();
  }

  loading(f: number, label: string) {
    const ls = this.screens.loading;
    (ls.querySelector('.load-fill') as HTMLElement).style.width = `${Math.round(f * 100)}%`;
    (ls.querySelector('.load-label') as HTMLElement).textContent = label;
  }

  hudVisible(on: boolean) { this.hud.classList.toggle('cinematic', !on); }

  letterbox(on: boolean) {
    this.els.letterbox.classList.toggle('on', on);
    this.hudVisible(!on);
  }

  fade(toBlack: boolean, dur = 0.6) {
    const f = this.els.fade;
    f.style.transition = `opacity ${dur}s ease`;
    f.style.opacity = toBlack ? '1' : '0';
    return new Promise<void>((r) => setTimeout(r, dur * 1000));
  }

  // ---- Messages -------------------------------------------------------------
  toast(msg: string, dur = 2.6) {
    // Avoid spamming the same line.
    for (const c of Array.from(this.toasts.children)) if (c.textContent === msg) return;
    const t = el('div', 'toast');
    t.textContent = msg;
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 4) this.toasts.firstChild?.remove();
    setTimeout(() => t.classList.add('out'), dur * 1000);
    setTimeout(() => t.remove(), dur * 1000 + 500);
  }

  say(name: string, text: string, priority = false) {
    // Cutscene dialogue interrupts whatever chatter is queued.
    if (priority || ctx.game?.inCutscene) {
      const cur = this.sayQueue[0];
      const keepCurrent = cur && ctx.game?.inCutscene && performance.now() - cur.at < 600;
      this.sayQueue = keepCurrent ? [cur] : [];
    }
    if (this.sayQueue.some((l) => l.text === text)) return;
    if (this.sayQueue.length > 3) return;
    this.sayQueue.push({ name, text, at: performance.now() });
    if (this.sayQueue.length === 1) this.showLine();
  }
  clearSay() { this.sayQueue = []; this.sayBox.classList.add('hidden'); }
  get speaking() { return this.sayQueue.length > 0; }

  private showLine() {
    // Drop chatter that went stale while waiting in the queue.
    while (this.sayQueue.length > 1 && performance.now() - this.sayQueue[0].at > 14000) this.sayQueue.shift();
    const l = this.sayQueue[0];
    if (!l) { this.sayBox.classList.add('hidden'); return; }
    (this.sayBox.querySelector('.say-name') as HTMLElement).textContent = l.name;
    (this.sayBox.querySelector('.say-text') as HTMLElement).textContent = l.text;
    this.sayBox.classList.remove('hidden');
    this.sayBox.classList.remove('pop');
    void this.sayBox.offsetWidth;
    this.sayBox.classList.add('pop');
    this.sayBox.dataset.who = l.name === 'Kaito' ? 'kaito' : l.name === ctx.progress?.name ? 'player' : 'other';
    this.sayT = 2.2 + l.text.length * 0.045;
  }

  banner(title: string, sub = '', dur = 2.5, kind: 'ult' | 'win' | 'boss' | 'island' | 'awaken' | 'info' = 'info') {
    const b = this.bannerEl;
    (b.querySelector('.banner-title') as HTMLElement).textContent = title;
    (b.querySelector('.banner-sub') as HTMLElement).textContent = sub;
    b.className = `banner kind-${kind}`;
    void b.offsetWidth;
    b.classList.add('show');
    this.bannerT = dur;
  }

  damageNumber(pos: THREE.Vector3, amount: number, color: string, crit: boolean, big: boolean) {
    if (amount < 1) return;
    const e = this.dmgPool.pop() ?? (el('div', 'dmg') as HTMLDivElement);
    e.textContent = String(Math.round(amount)) + (crit ? '!' : '');
    e.style.color = color;
    e.className = 'dmg' + (crit ? ' crit' : '') + (big ? ' big' : '');
    this.dmgLayer.appendChild(e);
    this.dmg.push({ el: e, pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0, (Math.random() - 0.5) * 0.8)), life: 0, max: crit ? 1.1 : 0.85, vy: big ? 2.5 : 1.6, big });
    if (this.dmg.length > 40) { const d = this.dmg.shift()!; d.el.remove(); this.dmgPool.push(d.el); }
  }

  hurtVignette() { this.vignetteT = 0.5; }

  prompt(text: string | null) {
    if (text === this.promptText) return;
    this.promptText = text;
    const p = this.els.prompt;
    if (!text) { p.classList.add('hidden'); return; }
    p.innerHTML = text.replace(/\[(\w+)\]/g, '<kbd>$1</kbd>');
    p.classList.remove('hidden');
  }

  objective(text: string) { if (this.els.objective.textContent !== text) this.els.objective.textContent = text; }

  bossBar(b: Boss | null) {
    this.bossRef = b;
    this.els.boss.classList.toggle('hidden', !b);
    if (b) {
      this.els.bossName.textContent = b.def.name;
      this.els.bossTitle.textContent = b.def.title;
      this.els.bossT25.style.display = b.def.phase3 ? '' : 'none';
      this.bossShownHp = b.hp / b.hpMax;
    }
  }

  /** Wanted poster that slides in after a big victory. */
  poster(name: string, bounty: number, look: Look, fruit: FruitId | null, dur = 6) {
    const p = el('div', 'poster', `
      <div class="poster-wanted">WANTED</div>
      <canvas width="220" height="200"></canvas>
      <div class="poster-dao">DEAD OR ALIVE</div>
      <div class="poster-name">${name.toUpperCase()}</div>
      <div class="poster-bounty">${formatBerry(bounty)}</div>
      <div class="poster-marine">MERIDIAN NAVY</div>`);
    drawPortrait(p.querySelector('canvas') as HTMLCanvasElement, look, fruit);
    this.root.appendChild(p);
    requestAnimationFrame(() => p.classList.add('in'));
    ctx.audio.sfx('gong');
    setTimeout(() => p.classList.remove('in'), dur * 1000);
    setTimeout(() => p.remove(), dur * 1000 + 900);
  }

  // ---- Per-frame update -------------------------------------------------------
  update(dt: number) {
    // Speech.
    if (this.sayQueue.length) {
      this.sayT -= dt;
      if (this.sayT <= 0) { this.sayQueue.shift(); this.showLine(); }
    }
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) this.bannerEl.classList.remove('show'); }
    if (this.vignetteT > 0) this.vignetteT -= dt;
    const p = ctx.player;
    const lowHp = p && p.alive && p.hp / p.hpMax < 0.3;
    this.els.vignette.style.opacity = String(Math.max(this.vignetteT * 1.6, lowHp ? 0.35 + Math.sin(performance.now() / 180) * 0.15 : 0));
    this.updateDamageNumbers(dt);
    if (this.hud.classList.contains('hidden') || !p) return;
    this.updateVitals(dt);
    this.updateCompass();
    this.updateShip();
    this.updateAbilities();
    this.updateBoss(dt);
    this.map.update(dt);
  }

  private updateDamageNumbers(dt: number) {
    const cam = ctx.camera;
    const W = window.innerWidth, H = window.innerHeight;
    for (let i = this.dmg.length - 1; i >= 0; i--) {
      const d = this.dmg[i];
      d.life += dt;
      d.pos.y += d.vy * dt;
      d.vy *= 0.96;
      const k = d.life / d.max;
      if (k >= 1) { d.el.remove(); this.dmgPool.push(d.el); this.dmg.splice(i, 1); continue; }
      this.tmp.copy(d.pos).project(cam);
      if (this.tmp.z > 1) { d.el.style.opacity = '0'; continue; }
      const x = (this.tmp.x * 0.5 + 0.5) * W, y = (-this.tmp.y * 0.5 + 0.5) * H;
      const s = k < 0.15 ? 0.6 + k / 0.15 * 0.8 : 1.4 - Math.min(0.4, (k - 0.15) * 1.5);
      d.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${s * (d.big ? 1.3 : 1)})`;
      d.el.style.opacity = String(k > 0.7 ? (1 - k) / 0.3 : 1);
    }
  }

  private updateVitals(dt: number) {
    const p = ctx.player, pr = ctx.progress;
    if (this.lastFruit !== p.fruit) this.buildAbilities(p.fruit);
    const hpK = Math.max(0, p.hp / p.hpMax);
    this.els.hpFill.style.width = `${hpK * 100}%`;
    const lag = parseFloat(this.els.hpLag.dataset.v || '1');
    const nl = lag > hpK ? Math.max(hpK, lag - dt * 0.5) : hpK;
    this.els.hpLag.dataset.v = String(nl);
    this.els.hpLag.style.width = `${nl * 100}%`;
    this.els.hpText.textContent = `${Math.ceil(p.hp)} / ${p.hpMax}`;
    this.els.enFill.style.width = `${(p.energy / p.energyMax) * 100}%`;
    this.els.xpFill.style.width = `${Math.min(1, pr.xp / xpForLevel(pr.level)) * 100}%`;
    this.els.lvl.textContent = String(pr.level);
    this.els.pname.textContent = `${pr.name}${p.awakened ? ' · ' + FRUITS[p.fruit].awakenedName : ''}`;
    this.els.bountyVal.textContent = formatBerry(pr.bounty);
    this.els.gold.textContent = pr.gold.toLocaleString();
    this.els.wood.textContent = String(pr.wood);
    this.els.iron.textContent = String(pr.iron);
    this.els.cola.textContent = String(pr.cola);
    this.els.ultmeter.classList.toggle('hidden', !p.awakened);
    this.els.ultFill.style.width = `${p.ult}%`;
    this.els.ultmeter.classList.toggle('ready', p.ult >= 100);
    this.els.crosshair.style.display = p.mode === 'foot' && ctx.cam.mode === 'follow' ? '' : 'none';
    const hints: string[] = [];
    if (p.mode === 'helm') hints.push('[W][S] Sails', '[A][D] Steer', '[LMB] Broadside', '[Shift] Gale Burst', '[F] Leave helm');
    else if (p.groundShip === ctx.ship) hints.push('[F] Take helm', `[T] ${ctx.game.kaitoSteering ? 'Kaito: stop' : 'Kaito: steer'}`, '[R] Repair');
    this.els.keyhints.innerHTML = hints.map((h) => h.replace(/\[(\w+)\]/g, '<kbd>$1</kbd>')).join('');
  }

  private updateCompass() {
    const c = this.compass;
    const g = c.getContext('2d')!;
    const W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    const grad = g.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, 'rgba(20,14,8,0)'); grad.addColorStop(0.15, 'rgba(20,14,8,0.55)'); grad.addColorStop(0.85, 'rgba(20,14,8,0.55)'); grad.addColorStop(1, 'rgba(20,14,8,0)');
    g.fillStyle = grad;
    g.fillRect(0, 8, W, 30);
    const bearing = -ctx.cam.yaw;
    const span = Math.PI * 0.6;
    const toX = (b: number) => W / 2 + (angleDiff(bearing, b) / span) * (W / 2);
    const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    g.textAlign = 'center';
    for (let i = 0; i < 48; i++) {
      const b = (i / 48) * Math.PI * 2;
      const x = toX(b);
      if (x < 10 || x > W - 10) continue;
      const major = i % 6 === 0;
      const alpha = 1 - Math.abs(x - W / 2) / (W / 2);
      g.strokeStyle = `rgba(255,240,210,${alpha * (major ? 0.9 : 0.4)})`;
      g.lineWidth = major ? 2 : 1;
      g.beginPath(); g.moveTo(x, 30); g.lineTo(x, major ? 22 : 26); g.stroke();
      if (major) {
        g.fillStyle = `rgba(255,240,210,${alpha})`;
        g.font = `${i === 0 ? 'bold 17px' : '14px'} 'Bangers', sans-serif`;
        if (i === 0) g.fillStyle = `rgba(255,90,70,${alpha})`;
        g.fillText(labels[i / 6], x, 20);
      }
    }
    const focus = ctx.player.mode === 'helm' ? ctx.ship.pos : ctx.player.pos;
    const mark = (x0: number, z0: number, color: string, shape: 'star' | 'ship' | 'dot' | 'skull') => {
      const b = Math.atan2(x0 - focus.x, -(z0 - focus.z));
      let x = toX(b);
      const off = x < 16 || x > W - 16;
      x = Math.max(16, Math.min(W - 16, x));
      g.fillStyle = color;
      g.strokeStyle = 'rgba(0,0,0,0.7)';
      g.lineWidth = 2;
      g.beginPath();
      if (shape === 'star') { for (let i = 0; i < 10; i++) { const r = i % 2 ? 4 : 9; const a = i / 10 * Math.PI * 2 - Math.PI / 2; g.lineTo(x + Math.cos(a) * r, 40 + Math.sin(a) * r); } }
      else if (shape === 'ship') { g.moveTo(x - 7, 38); g.lineTo(x + 7, 38); g.lineTo(x + 4, 44); g.lineTo(x - 4, 44); g.closePath(); g.moveTo(x, 30); g.lineTo(x + 5, 37); g.lineTo(x, 37); }
      else if (shape === 'skull') { g.arc(x, 40, 6, 0, Math.PI * 2); }
      else g.arc(x, 41, 4, 0, Math.PI * 2);
      g.closePath();
      g.stroke(); g.fill();
      if (off) { g.font = '14px sans-serif'; g.fillText(x < W / 2 ? '◀' : '▶', x + (x < W / 2 ? 12 : -12), 45); }
    };
    // Center pointer.
    g.fillStyle = '#ffd34a';
    g.beginPath(); g.moveTo(W / 2 - 6, 4); g.lineTo(W / 2 + 6, 4); g.lineTo(W / 2, 12); g.closePath(); g.fill();
    const pr = ctx.progress;
    if (!(ctx.player.mode === 'helm' || ctx.player.groundShip === ctx.ship)) mark(ctx.ship.pos.x, ctx.ship.pos.z, '#c98a4a', 'ship');
    for (const es of ctx.encounters.ships) if (es.ship.alive && es.aggro) mark(es.ship.pos.x, es.ship.pos.z, '#ff4a3a', 'dot');
    else if (es.ship.wreck) mark(es.ship.pos.x, es.ship.pos.z, '#e8c070', 'dot');
    const nid = Math.min(pr.nextIsland, ISLANDS.length - 1);
    const isl = ctx.world.islands[nid];
    if (isl && !pr.finished) {
      const here = ctx.world.islandAt(focus.x, focus.z, 60);
      const tgt = here === isl && isl.arena ? isl.arena.pos : isl.shipPark;
      mark(tgt.x, tgt.z, '#ffd34a', here === isl ? 'skull' : 'star');
      const d = Math.hypot(tgt.x - focus.x, tgt.z - focus.z);
      this.els.lpName.textContent = here === isl ? `${isl.def.name} · Boss` : isl.def.name;
      this.els.lpDist.textContent = `${Math.round(d).toLocaleString()} m`;
    } else { this.els.lpName.textContent = 'Solhaven · Free sailing'; this.els.lpDist.textContent = ''; }
  }

  private updateShip() {
    const p = ctx.player;
    const s = ctx.ship;
    const show = p.mode === 'helm' || p.groundShip === s || ctx.encounters.engaged();
    this.els.shippanel.classList.toggle('hidden', !show);
    if (!show) return;
    this.els.shipName.textContent = ctx.progress.shipName + (s.docked ? ' · Moored' : s.anchored ? ' · Anchored' : '');
    this.els.shipFill.style.width = `${(s.hp / s.hpMax) * 100}%`;
    this.els.shipText.textContent = `${Math.ceil(s.hp)} / ${s.hpMax}`;
    const pips = this.els.sails.children;
    for (let i = 0; i < 3; i++) pips[i].classList.toggle('on', s.sail > i);
    this.els.knots.textContent = `${Math.round(Math.abs(s.speed) * 1.2)} kn`;
    this.els.reloadFill.style.width = `${(1 - s.reload / s.reloadTime) * 100}%`;
    this.els.reloadFill.parentElement!.classList.toggle('ready', s.reload <= 0);
    this.els.steer.textContent = ctx.game.kaitoSteering ? 'Kaito at the helm' : p.mode === 'helm' ? 'You have the helm' : '';
  }

  private updateAbilities() {
    const p = ctx.player;
    const def = FRUITS[p.fruit];
    this.abilitySlots.forEach((s, i) => {
      if (i === 3) {
        s.classList.toggle('locked', !p.awakened);
        const nm = s.querySelector('.slot-name') as HTMLElement;
        const want = p.awakened ? def.ultimate.name : 'Awakening';
        if (nm.textContent !== want) nm.textContent = want;
        s.classList.toggle('ready', p.awakened && p.ult >= 100);
        s.style.setProperty('--cd', p.awakened ? String(1 - p.ult / 100) : '0');
        return;
      }
      const ab = def.abilities[i];
      const cdMax = ab.cd * (p.awakened ? 0.7 : 1);
      s.style.setProperty('--cd', String(Math.min(1, p.cds[i] / cdMax)));
      s.classList.toggle('noen', p.energy < ab.cost);
      s.classList.toggle('ready', p.cds[i] <= 0 && p.energy >= ab.cost);
    });
  }

  private updateBoss(dt: number) {
    const b = this.bossRef;
    if (!b) return;
    const k = Math.max(0, b.hp / b.hpMax);
    this.els.bossFill.style.width = `${k * 100}%`;
    this.bossShownHp = this.bossShownHp > k ? Math.max(k, this.bossShownHp - dt * 0.25) : k;
    this.els.bossLag.style.width = `${this.bossShownHp * 100}%`;
    this.els.boss.dataset.phase = String(b.phase);
  }
}

/** Stylized captain portrait for wanted posters and the save slot. */
export function drawPortrait(c: HTMLCanvasElement, look: Look, fruit: FruitId | null) {
  const g = c.getContext('2d')!;
  const W = c.width, H = c.height;
  const bg = g.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W);
  bg.addColorStop(0, fruit ? hexCss(FRUITS[fruit].color2) : '#f0d8a0');
  bg.addColorStop(1, '#b08850');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.globalAlpha = 0.25;
  g.fillStyle = '#5a3a1a';
  for (let i = 0; i < 40; i++) g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  g.globalAlpha = 1;
  const cx = W / 2, cy = H * 0.58;
  // Shoulders / shirt.
  g.fillStyle = look.shirt;
  g.beginPath(); g.ellipse(cx, H + 20, 95, 70, 0, Math.PI, 0); g.fill();
  g.fillStyle = look.skin;
  g.fillRect(cx - 14, cy + 30, 28, 30);
  g.beginPath(); g.moveTo(cx - 30, H); g.lineTo(cx, cy + 60); g.lineTo(cx + 30, H); g.fill();
  // Head.
  g.beginPath(); g.ellipse(cx, cy, 44, 50, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#2a1a0a'; g.lineWidth = 3; g.stroke();
  // Hair.
  g.fillStyle = look.hair;
  if (look.hairStyle !== 'bald') {
    g.beginPath();
    g.ellipse(cx, cy - 26, 48, 30, 0, Math.PI, 0);
    const spikes = look.hairStyle === 'spiky' ? 8 : 5;
    for (let i = 0; i <= spikes; i++) { const x = cx - 46 + (92 * i) / spikes; g.lineTo(x, cy - 14 + (i % 2 ? 0 : 10)); }
    g.fill();
    if (look.hairStyle === 'long') { g.fillRect(cx - 50, cy - 26, 14, 70); g.fillRect(cx + 36, cy - 26, 14, 70); }
    if (look.hairStyle === 'topknot') { g.beginPath(); g.arc(cx, cy - 64, 14, 0, Math.PI * 2); g.fill(); }
  }
  // Hat.
  if (look.hat === 'straw') {
    g.fillStyle = look.hatColor;
    g.beginPath(); g.ellipse(cx, cy - 36, 80, 16, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.ellipse(cx, cy - 46, 44, 30, 0, Math.PI, 0); g.fill(); g.stroke();
    g.fillStyle = '#c8282b'; g.fillRect(cx - 44, cy - 50, 88, 10);
  } else if (look.hat === 'tricorn') {
    g.fillStyle = look.hatColor;
    g.beginPath(); g.moveTo(cx - 78, cy - 34); g.quadraticCurveTo(cx, cy - 110, cx + 78, cy - 34); g.quadraticCurveTo(cx, cy - 54, cx - 78, cy - 34); g.fill(); g.stroke();
    g.fillStyle = '#e8c45a'; g.fillRect(cx - 50, cy - 50, 100, 4);
  } else if (look.hat === 'bandana') {
    g.fillStyle = look.hatColor;
    g.beginPath(); g.ellipse(cx, cy - 30, 47, 30, 0, Math.PI, 0); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(cx + 40, cy - 30); g.lineTo(cx + 64, cy - 18); g.lineTo(cx + 58, cy - 6); g.closePath(); g.fill();
  }
  // Face.
  g.fillStyle = '#1a1208';
  g.beginPath(); g.ellipse(cx - 16, cy - 2, 5, 7, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(cx + 16, cy - 2, 5, 7, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(cx - 14, cy - 4, 1.8, 0, Math.PI * 2); g.arc(cx + 18, cy - 4, 1.8, 0, Math.PI * 2); g.fill();
  // Big grin.
  g.fillStyle = '#fff'; g.strokeStyle = '#1a1208'; g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(cx - 24, cy + 18); g.quadraticCurveTo(cx, cy + 46, cx + 24, cy + 18); g.closePath(); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(cx - 20, cy + 24); g.lineTo(cx + 20, cy + 24); g.stroke();
  if (look.scar) {
    g.strokeStyle = '#8a2a1a'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx - 24, cy + 10); g.lineTo(cx - 12, cy + 12); g.stroke();
    for (const x of [-21, -17, -13]) { g.beginPath(); g.moveTo(cx + x, cy + 7); g.lineTo(cx + x, cy + 14); g.stroke(); }
  }
}
