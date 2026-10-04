// Menu screens: title, character creator, devil fruit selection, pause and
// settings, the shipwright, defeat and the ending/credits.
import { ctx } from '../game/ctx';
import { FRUITS, FRUIT_ORDER, FruitId, UPGRADES, COMPANION, ISLANDS } from '../game/data';
import { Look, HatStyle, HairStyle, defaultLook, saveSettings } from '../game/state';
import { ABILITY_GLYPHS, drawPortrait } from './UI';
import { formatBerry } from '../core/math';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const hexCss = (c: number) => '#' + c.toString(16).padStart(6, '0');
const click = (node: Element | null, fn: () => void) => node?.addEventListener('click', () => { ctx.audio.sfx('ui'); fn(); });

export class Menus {
  title!: HTMLElement;
  create!: HTMLElement;
  fruit!: HTMLElement;
  pause!: HTMLElement;
  shop!: HTMLElement;
  dead!: HTMLElement;
  ending!: HTMLElement;
  look: Look = defaultLook();
  private selFruit: FruitId = 'blaze';

  constructor() {
    this.buildTitle();
    this.buildCreate();
    this.buildFruit();
    this.buildPause();
    this.buildShop();
    this.buildDead();
    this.buildEnding();
  }

  // ---- Title ------------------------------------------------------------------
  private buildTitle() {
    const t = el('div', 'title-screen', `
      <div class="logo big"><span class="logo-top">GRAND</span><span class="logo-main">MERIDIAN</span><span class="logo-sub">Voyage to the Last Dawn</span></div>
      <div class="title-menu">
        <button class="btn primary t-continue">Continue Voyage</button>
        <button class="btn t-new">New Adventure</button>
        <button class="btn t-settings">Settings</button>
      </div>
      <div class="save-slot hidden"><canvas width="90" height="82"></canvas><div class="slot-info"></div></div>
      <div class="title-foot">Click to set sail · Best with headphones · WASD + Mouse</div>`);
    click(t.querySelector('.t-continue'), () => ctx.game.continueGame());
    click(t.querySelector('.t-new'), () => {
      if (ctx.game.hasSave() && !confirm('Start a new adventure? Your current voyage will be overwritten.')) return;
      ctx.game.startNewGame();
    });
    click(t.querySelector('.t-settings'), () => { ctx.game.settingsFromTitle = true; this.openPause('settings'); ctx.ui.setScreen('pause'); });
    this.title = t;
    ctx.ui.addScreen('title', t);
  }

  refreshTitle() {
    const save = ctx.game.peekSave();
    const cont = this.title.querySelector('.t-continue') as HTMLElement;
    cont.style.display = save ? '' : 'none';
    (this.title.querySelector('.t-new') as HTMLElement).classList.toggle('primary', !save);
    const slot = this.title.querySelector('.save-slot') as HTMLElement;
    slot.classList.toggle('hidden', !save);
    if (save) {
      drawPortrait(slot.querySelector('canvas') as HTMLCanvasElement, save.look, save.fruit);
      const isl = ISLANDS[Math.min(save.nextIsland, ISLANDS.length - 1)];
      (slot.querySelector('.slot-info') as HTMLElement).innerHTML = `
        <b>${save.name}</b> · Lv ${save.level}<br>
        ${save.fruit ? FRUITS[save.fruit].name : ''}<br>
        ${save.finished ? 'Reached Solhaven' : 'Bound for ' + isl.name}<br>
        <span class="slot-bounty">${formatBerry(save.bounty)}</span>`;
    }
  }

  // ---- Character creator --------------------------------------------------------
  private buildCreate() {
    const SK = ['#f6d3b3', '#f1c59b', '#d9a066', '#b07443', '#7a4a2a', '#4e2f1c'];
    const HC = ['#1d1a1a', '#5a3218', '#c8a060', '#e8e0d0', '#c83a2a', '#3f9a4a', '#3a5ad8', '#e070b0'];
    const CL = ['#c8282b', '#2f5fa8', '#e8e4d8', '#2a2a30', '#3f8a4a', '#e8a030', '#7a3ab0', '#f07a90', '#3ab0b8', '#8a5a2a'];
    const HATC = ['#e9c46a', '#c8282b', '#2a2a30', '#2f5fa8', '#e8e4d8', '#3f8a4a'];
    const swatches = (key: keyof Look, list: string[]) => `<div class="swatches" data-key="${key}">${list.map((c) => `<button class="sw" data-v="${c}" style="background:${c}"></button>`).join('')}</div>`;
    const choices = (key: keyof Look, list: [string, string][]) => `<div class="choices" data-key="${key}">${list.map(([v, n]) => `<button class="ch" data-v="${v}">${n}</button>`).join('')}</div>`;
    const c = el('div', 'create-screen', `
      <div class="panel create-panel">
        <h2>Create Your Captain</h2>
        <label>Captain's name<input class="in-name" maxlength="16" value="Ren"></label>
        <label>Ship's name<input class="in-ship" maxlength="22" value="Sunrise Wanderer"></label>
        <div class="row"><span>Skin</span>${swatches('skin', SK)}</div>
        <div class="row"><span>Hair</span>${choices('hairStyle', [['messy', 'Messy'], ['spiky', 'Spiky'], ['long', 'Long'], ['topknot', 'Topknot'], ['bald', 'Shaved']])}</div>
        <div class="row"><span></span>${swatches('hair', HC)}</div>
        <div class="row"><span>Shirt</span>${swatches('shirt', CL)}</div>
        <div class="row"><span>Pants</span>${swatches('pants', CL)}</div>
        <div class="row"><span>Hat</span>${choices('hat', [['straw', 'Straw'], ['tricorn', 'Tricorn'], ['bandana', 'Bandana'], ['none', 'None']])}</div>
        <div class="row"><span></span>${swatches('hatColor', HATC)}</div>
        <div class="row"><span>Scar</span>${choices('scar', [['true', 'Yes'], ['false', 'No']])}</div>
        <div class="create-actions">
          <button class="btn c-random">Randomize</button>
          <button class="btn primary c-done">Set Sail ➜</button>
        </div>
      </div>
      <div class="create-hint">Drag to turn your captain</div>`);
    c.querySelectorAll('.swatches, .choices').forEach((group) => {
      const key = (group as HTMLElement).dataset.key as keyof Look;
      group.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        const v = (b as HTMLElement).dataset.v!;
        (this.look as unknown as Record<string, unknown>)[key] = key === 'scar' ? v === 'true' : v;
        ctx.audio.sfx('ui');
        this.syncCreate();
        ctx.game.previewLook(this.look);
      }));
    });
    click(c.querySelector('.c-random'), () => {
      const r = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
      this.look = {
        skin: r(SK), hair: r(HC), hairStyle: r(['messy', 'spiky', 'long', 'topknot', 'bald'] as HairStyle[]), shirt: r(CL), pants: r(CL),
        hat: r(['straw', 'tricorn', 'bandana', 'none'] as HatStyle[]), hatColor: r(HATC), scar: Math.random() < 0.5,
      };
      this.syncCreate();
      ctx.game.previewLook(this.look);
    });
    click(c.querySelector('.c-done'), () => {
      const name = (c.querySelector('.in-name') as HTMLInputElement).value.trim() || 'Ren';
      const ship = (c.querySelector('.in-ship') as HTMLInputElement).value.trim() || 'Sunrise Wanderer';
      ctx.game.finishCreator(name, ship, { ...this.look });
    });
    // Drag to rotate the preview.
    let dragging = false, lastX = 0;
    c.addEventListener('mousedown', (e) => { if ((e.target as HTMLElement).closest('.panel')) return; dragging = true; lastX = e.clientX; });
    window.addEventListener('mouseup', () => { dragging = false; });
    window.addEventListener('mousemove', (e) => { if (!dragging) return; ctx.game.rotatePreview((e.clientX - lastX) * 0.01); lastX = e.clientX; });
    this.create = c;
    ctx.ui.addScreen('create', c);
  }

  syncCreate() {
    this.create.querySelectorAll('.swatches, .choices').forEach((group) => {
      const key = (group as HTMLElement).dataset.key as keyof Look;
      const v = String(this.look[key]);
      group.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', (b as HTMLElement).dataset.v === v));
    });
  }

  // ---- Devil fruit selection -------------------------------------------------------
  private buildFruit() {
    const f = el('div', 'fruit-screen', `
      <div class="fruit-head"><h2>A Chest of Devil Fruits</h2><p>Each grants a fearsome power. Eat one, and the sea will reject you forever.</p></div>
      <div class="panel fruit-info"></div>
      <div class="fruit-cards">${FRUIT_ORDER.map((id) => {
        const d = FRUITS[id];
        return `<button class="fcard" data-id="${id}" style="--c1:${hexCss(d.color)};--c2:${hexCss(d.color2)}"><div class="fcard-orb">${ABILITY_GLYPHS[id][0]}</div><div><div class="fcard-name">${d.name}</div><div class="fcard-en">${d.english} · ${d.type}</div></div></button>`;
      }).join('')}</div>
      <button class="btn primary eat">Eat the Fruit</button>`);
    f.querySelectorAll('.fcard').forEach((b) => {
      b.addEventListener('click', () => { ctx.audio.sfx('ui'); this.selectFruit((b as HTMLElement).dataset.id as FruitId); });
      b.addEventListener('mouseenter', () => ctx.audio.sfx('ui', undefined, 0.3));
    });
    click(f.querySelector('.eat'), () => ctx.game.chooseFruit(this.selFruit));
    this.fruit = f;
    ctx.ui.addScreen('fruit', f);
  }

  selectFruit(id: FruitId) {
    this.selFruit = id;
    const d = FRUITS[id];
    this.fruit.querySelectorAll('.fcard').forEach((b) => b.classList.toggle('sel', (b as HTMLElement).dataset.id === id));
    const info = this.fruit.querySelector('.fruit-info') as HTMLElement;
    info.style.setProperty('--c1', hexCss(d.color));
    info.innerHTML = `
      <div class="fi-type">${d.type}</div>
      <h3>${d.name}</h3>
      <div class="fi-en">${d.english}</div>
      <p class="fi-blurb">${d.blurb}</p>
      <div class="fi-ab"><span class="fi-key">LMB</span><div><b>Combo</b><br>${d.basic}</div></div>
      ${d.abilities.map((a, i) => `<div class="fi-ab"><span class="fi-key">${i + 1}</span><div><b>${a.name}</b><br>${a.desc}</div></div>`).join('')}
      <div class="fi-ab locked"><span class="fi-key">4</span><div><b>??? (Awakening)</b><br>Some say a fruit only shows its true power when its eater stands at death's door...</div></div>`;
    ctx.game.previewFruit(id);
  }

  // ---- Pause / settings -----------------------------------------------------------
  private buildPause() {
    const s = ctx.settings;
    const p = el('div', 'pause-screen', `
      <div class="panel pause-panel">
        <div class="tabs"><button class="tab" data-tab="main">Paused</button><button class="tab" data-tab="settings">Settings</button><button class="tab" data-tab="controls">Controls</button><button class="tab" data-tab="log">Captain's Log</button></div>
        <div class="tab-body" data-tab="main">
          <button class="btn primary p-resume">Resume</button>
          <button class="btn p-map">World Map</button>
          <button class="btn p-save">Save Game</button>
          <button class="btn p-title">Save & Quit to Title</button>
        </div>
        <div class="tab-body" data-tab="settings">
          <label>Master volume<input type="range" min="0" max="1" step="0.05" data-s="master" value="${s.master}"></label>
          <label>Music<input type="range" min="0" max="1" step="0.05" data-s="music" value="${s.music}"></label>
          <label>Effects<input type="range" min="0" max="1" step="0.05" data-s="sfx" value="${s.sfx}"></label>
          <label>Mouse sensitivity<input type="range" min="0.3" max="2.5" step="0.05" data-s="sensitivity" value="${s.sensitivity}"></label>
          <label class="check"><input type="checkbox" data-s="invertY" ${s.invertY ? 'checked' : ''}> Invert camera Y</label>
          <label class="check"><input type="checkbox" data-s="shake" ${s.shake ? 'checked' : ''}> Screen shake</label>
          <label>Graphics quality<select data-s="quality"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
          <button class="btn p-back hidden">Back</button>
        </div>
        <div class="tab-body controls" data-tab="controls">
          <div class="ctl-col"><h4>On foot</h4>
            <p><kbd>W A S D</kbd> Move · <kbd>Shift</kbd> Sprint · <kbd>Space</kbd> Jump</p>
            <p><kbd>LMB</kbd> Combo · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> Fruit powers · <kbd>4</kbd> Awakened ultimate</p>
            <p><kbd>Q</kbd> Dodge · <kbd>E</kbd> Interact / loot / board · <kbd>Mouse</kbd> Camera · <kbd>Wheel</kbd> Zoom</p>
          </div>
          <div class="ctl-col"><h4>At sea</h4>
            <p><kbd>F</kbd> Take / leave the helm · <kbd>T</kbd> Let ${COMPANION.name} steer to the Log Pose</p>
            <p><kbd>W</kbd><kbd>S</kbd> Raise / lower sails · <kbd>A</kbd><kbd>D</kbd> Rudder</p>
            <p><kbd>LMB</kbd> Broadside (side you look at) · <kbd>Shift</kbd> Gale Burst (uses Burst Cola)</p>
            <p><kbd>R</kbd> Patch the hull (10 timber + 2 iron) · <kbd>E</kbd> Go ashore when moored</p>
          </div>
          <div class="ctl-col"><h4>General</h4><p><kbd>M</kbd> World map · <kbd>Esc</kbd> Pause</p></div>
        </div>
        <div class="tab-body log" data-tab="log"></div>
      </div>`);
    p.querySelectorAll('.tab').forEach((b) => click(b, () => this.openPause((b as HTMLElement).dataset.tab!)));
    click(p.querySelector('.p-resume'), () => ctx.game.resume());
    click(p.querySelector('.p-map'), () => ctx.game.openMap());
    click(p.querySelector('.p-save'), () => { ctx.game.save(); ctx.ui.toast('Voyage saved.'); });
    click(p.querySelector('.p-title'), () => ctx.game.quitToTitle());
    click(p.querySelector('.p-back'), () => { ctx.game.settingsFromTitle = false; ctx.ui.setScreen('title'); });
    (p.querySelector('select') as HTMLSelectElement).value = s.quality;
    p.querySelectorAll('[data-s]').forEach((inp) => inp.addEventListener('input', () => {
      const i = inp as HTMLInputElement;
      const key = i.dataset.s as keyof typeof s;
      const v = i.type === 'checkbox' ? i.checked : i.tagName === 'SELECT' ? i.value : parseFloat(i.value);
      (s as unknown as Record<string, unknown>)[key] = v;
      saveSettings(s);
      ctx.game.applySettings();
    }));
    this.pause = p;
    ctx.ui.addScreen('pause', p);
  }

  openPause(tab = 'main') {
    const p = this.pause;
    const fromTitle = ctx.game.settingsFromTitle;
    p.querySelectorAll('.tab').forEach((b) => { b.classList.toggle('sel', (b as HTMLElement).dataset.tab === tab); (b as HTMLElement).style.display = fromTitle && (b as HTMLElement).dataset.tab !== 'settings' && (b as HTMLElement).dataset.tab !== 'controls' ? 'none' : ''; });
    p.querySelectorAll('.tab-body').forEach((b) => b.classList.toggle('hidden', (b as HTMLElement).dataset.tab !== tab));
    (p.querySelector('.p-back') as HTMLElement).classList.toggle('hidden', !fromTitle);
    if (tab === 'log') this.fillLog();
  }

  private fillLog() {
    const pr = ctx.progress;
    const log = this.pause.querySelector('.log') as HTMLElement;
    const mins = Math.floor(pr.playTime / 60);
    log.innerHTML = `
      <div class="log-stats">
        <div><b>${pr.name}</b> of the <i>${pr.shipName}</i></div>
        <div>${pr.fruit ? FRUITS[pr.fruit].name : ''} ${pr.awakened ? '· <span class="aw">AWAKENED</span>' : ''}</div>
        <div>Bounty ${formatBerry(pr.bounty)} · Level ${pr.level}</div>
        <div>Ships sunk ${pr.shipsSunk} · Sea Kings slain ${pr.monstersSlain} · ${mins} min at sea</div>
      </div>
      <div class="log-islands">${ISLANDS.map((isl, i) => {
        const known = pr.discovered[i];
        const state = pr.cleared[i] ? 'Liberated' : i === pr.nextIsland ? 'Log Pose target' : known ? 'Uncharted' : '';
        return `<div class="log-isl ${pr.cleared[i] ? 'done' : ''} ${known ? '' : 'unknown'}"><b>${known ? isl.name : '? ? ?'}</b><span>${known ? isl.title : 'Somewhere beyond the horizon'}</span><em>${state}</em>${known ? `<p>${isl.lore[0]}</p>` : ''}</div>`;
      }).join('')}</div>`;
  }

  // ---- Shipwright -----------------------------------------------------------------
  private buildShop() {
    const s = el('div', 'shop-screen', `<div class="panel shop-panel"><h2>Shipwright Bonnie's Dock</h2><div class="shop-body"></div><button class="btn primary s-close">Back to the docks</button></div>`);
    click(s.querySelector('.s-close'), () => ctx.game.closeShop());
    this.shop = s;
    ctx.ui.addScreen('shop', s);
  }

  refreshShop() {
    const pr = ctx.progress;
    const ship = ctx.ship;
    const body = this.shop.querySelector('.shop-body') as HTMLElement;
    const missing = Math.ceil(ship.hpMax - ship.hp);
    const repairCost = ctx.game.repairCost();
    const can = (c: { gold: number; wood: number; iron: number }) => pr.gold >= c.gold && pr.wood >= c.wood && pr.iron >= c.iron;
    const cost = (c: { gold: number; wood: number; iron: number }) => `<span class="cost ${pr.gold >= c.gold ? '' : 'short'}">฿ ${c.gold}</span> <span class="cost ${pr.wood >= c.wood ? '' : 'short'}">▤ ${c.wood}</span> <span class="cost ${pr.iron >= c.iron ? '' : 'short'}">⛓ ${c.iron}</span>`;
    body.innerHTML = `
      <div class="shop-wallet">฿ ${pr.gold.toLocaleString()} · ▤ ${pr.wood} timber · ⛓ ${pr.iron} iron · ✚ ${pr.cola} cola</div>
      <div class="shop-item">
        <div><b>Repair the ${pr.shipName}</b><br><span class="dim">Hull ${Math.ceil(ship.hp)} / ${ship.hpMax}</span></div>
        <div class="shop-buy">${missing > 0 ? cost(repairCost) : '<span class="dim">Shipshape!</span>'}<button class="btn small s-repair" ${missing > 0 && can(repairCost) ? '' : 'disabled'}>Repair</button></div>
      </div>
      ${(['hull', 'cannons', 'sails'] as const).map((k) => {
        const u = UPGRADES[k];
        const lv = pr.upgrades[k];
        const max = lv >= u.costs.length;
        return `<div class="shop-item">
          <div><b>${u.name}</b> <span class="tier">${'★'.repeat(lv + 1)}${'☆'.repeat(u.costs.length - lv)}</span><br><span class="dim">${u.desc[lv]}</span>${max ? '' : `<br><span class="next">Next: ${u.desc[lv + 1]}</span>`}</div>
          <div class="shop-buy">${max ? '<span class="dim">Maxed</span>' : cost(u.costs[lv]) + `<button class="btn small s-up" data-k="${k}" ${can(u.costs[lv]) ? '' : 'disabled'}>Upgrade</button>`}</div>
        </div>`;
      }).join('')}
      <div class="shop-item"><div><b>Burst Cola</b><br><span class="dim">Fuel for one Gale Burst at the helm</span></div><div class="shop-buy"><span class="cost ${pr.gold >= 120 ? '' : 'short'}">฿ 120</span><button class="btn small s-cola" ${pr.gold >= 120 ? '' : 'disabled'}>Buy</button></div></div>
      <div class="shop-item"><div><b>Timber bundle</b><br><span class="dim">10 planks of seasoned oak</span></div><div class="shop-buy"><span class="cost ${pr.gold >= 90 ? '' : 'short'}">฿ 90</span><button class="btn small s-wood" ${pr.gold >= 90 ? '' : 'disabled'}>Buy</button></div></div>
      <div class="shop-item"><div><b>Iron ingots</b><br><span class="dim">4 bars of Wano steel</span></div><div class="shop-buy"><span class="cost ${pr.gold >= 160 ? '' : 'short'}">฿ 160</span><button class="btn small s-iron" ${pr.gold >= 160 ? '' : 'disabled'}>Buy</button></div></div>`;
    click(body.querySelector('.s-repair'), () => { ctx.game.shopRepair(); this.refreshShop(); });
    body.querySelectorAll('.s-up').forEach((b) => click(b, () => { ctx.game.buyUpgrade((b as HTMLElement).dataset.k as 'hull' | 'cannons' | 'sails'); this.refreshShop(); }));
    click(body.querySelector('.s-cola'), () => { if (pr.gold >= 120) { pr.gold -= 120; pr.cola++; ctx.audio.sfx('coin'); } this.refreshShop(); });
    click(body.querySelector('.s-wood'), () => { if (pr.gold >= 90) { pr.gold -= 90; pr.wood += 10; ctx.audio.sfx('coin'); } this.refreshShop(); });
    click(body.querySelector('.s-iron'), () => { if (pr.gold >= 160) { pr.gold -= 160; pr.iron += 4; ctx.audio.sfx('coin'); } this.refreshShop(); });
  }

  // ---- Defeat ---------------------------------------------------------------------
  private buildDead() {
    const d = el('div', 'dead-screen', `<div class="dead-title">DEFEATED</div><div class="dead-sub"></div><button class="btn primary d-go">Get back up</button>`);
    click(d.querySelector('.d-go'), () => ctx.game.respawn());
    this.dead = d;
    ctx.ui.addScreen('dead', d);
  }
  showDead(sub: string) { (this.dead.querySelector('.dead-sub') as HTMLElement).textContent = sub; }

  // ---- Ending ---------------------------------------------------------------------
  private buildEnding() {
    const e = el('div', 'ending-screen', `<div class="credits"></div><div class="end-actions hidden"><button class="btn primary e-free">Keep sailing</button><button class="btn e-title">Return to title</button></div>`);
    click(e.querySelector('.e-free'), () => ctx.game.freeRoam());
    click(e.querySelector('.e-title'), () => ctx.game.quitToTitle());
    this.ending = e;
    ctx.ui.addScreen('ending', e);
  }

  rollCredits() {
    const pr = ctx.progress;
    const c = this.ending.querySelector('.credits') as HTMLElement;
    const mins = Math.floor(pr.playTime / 60);
    c.innerHTML = `
      <div class="logo"><span class="logo-top">GRAND</span><span class="logo-main">MERIDIAN</span></div>
      <p class="cr-lead">The Daybreak Treasure was never gold.</p>
      <p>At the heart of Solhaven, beneath the ruined sun-temple, ${pr.name} found Aurelio's last log: a map of every sea beyond the Meridian, and a single line.</p>
      <p class="cr-quote">"The dawn belongs to whoever is brave enough to sail toward it."</p>
      <p>Vexis's eclipse shattered. For the first time in two hundred years, the sun rose over the Last Dawn.</p>
      <h3>Captain</h3><p>${pr.name} · ${pr.fruit ? FRUITS[pr.fruit].awakenedName : ''}</p>
      <h3>Final Bounty</h3><p class="cr-bounty">${formatBerry(pr.bounty)}</p>
      <h3>Voyage</h3><p>${pr.shipsSunk} ships sunk · ${pr.monstersSlain} Sea Kings slain · Level ${pr.level} · ${mins} minutes</p>
      <h3>Crew of the ${pr.shipName}</h3><p>${pr.name}, Captain<br>${COMPANION.full}, Swordsman</p>
      <h3>Inspired by</h3><p>The great pirate stories, and everyone who ever dreamed of the open sea.</p>
      <p class="cr-end">THE END ...?</p>
      <p class="dim">The seas beyond the Meridian await in a future voyage.</p>`;
    c.classList.remove('roll');
    void c.offsetWidth;
    c.classList.add('roll');
    const actions = this.ending.querySelector('.end-actions') as HTMLElement;
    actions.classList.add('hidden');
    setTimeout(() => actions.classList.remove('hidden'), 14000);
  }
}
