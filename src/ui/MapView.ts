// Sea charts: a painted base map generated from the world heightfield, a
// fog-of-war layer revealed as you sail, the HUD minimap and the full map.
import { ctx } from '../game/ctx';
import { ISLANDS } from '../game/data';
import { FOG_CELL, FOG_H, FOG_W, WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_X, WORLD_MIN_Z, decodeFog, encodeFog } from '../game/state';
import { HT_CELL, HT_H, HT_W } from '../world/World';

const WORLD_W = WORLD_MAX_X - WORLD_MIN_X;
const WORLD_H = WORLD_MAX_Z - WORLD_MIN_Z;

function hex(c: number) { return [(c >> 16) & 255, (c >> 8) & 255, c & 255]; }
function mix(a: number[], b: number[], t: number) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

export class MapView {
  base: HTMLCanvasElement;
  fogBits = new Uint8Array(FOG_W * FOG_H);
  fogCanvas: HTMLCanvasElement;
  private fogImg: ImageData;
  private fogCtx: CanvasRenderingContext2D;
  private fogDirty = true;
  private revealT = 0;
  mini: HTMLCanvasElement;
  big: HTMLCanvasElement;
  bigOpen = false;
  private view = { cx: 0, cz: 0, zoom: 1 };
  private drag: { x: number; y: number; cx: number; cz: number } | null = null;
  private blurred: HTMLCanvasElement[] = [];

  constructor(mini: HTMLCanvasElement, big: HTMLCanvasElement) {
    this.mini = mini;
    this.big = big;
    this.base = document.createElement('canvas');
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = FOG_W;
    this.fogCanvas.height = FOG_H;
    this.fogCtx = this.fogCanvas.getContext('2d')!;
    this.fogImg = this.fogCtx.createImageData(FOG_W, FOG_H);
    big.addEventListener('mousedown', (e) => { this.drag = { x: e.clientX, y: e.clientY, cx: this.view.cx, cz: this.view.cz }; });
    window.addEventListener('mouseup', () => { this.drag = null; });
    window.addEventListener('mousemove', (e) => {
      if (!this.drag || !this.bigOpen) return;
      const s = this.bigScale();
      this.view.cx = this.drag.cx - (e.clientX - this.drag.x) / s;
      this.view.cz = this.drag.cz - (e.clientY - this.drag.y) / s;
    });
    big.addEventListener('wheel', (e) => { e.preventDefault(); this.view.zoom = Math.min(6, Math.max(0.6, this.view.zoom * (e.deltaY > 0 ? 0.88 : 1.14))); }, { passive: false });
  }

  /** Paint the base chart from the world heightfield (run once after generation). */
  build() {
    const c = this.base;
    c.width = HT_W;
    c.height = HT_H;
    const g = c.getContext('2d')!;
    const img = g.createImageData(HT_W, HT_H);
    const land = document.createElement('canvas');
    land.width = HT_W; land.height = HT_H;
    const lg = land.getContext('2d')!;
    const landImg = lg.createImageData(HT_W, HT_H);
    const grid = ctx.world.heightGrid;
    const deep = [28, 70, 120], mid = [44, 112, 160], paper = [222, 205, 160];
    for (let j = 0; j < HT_H; j++) {
      const z = WORLD_MIN_Z + (j + 0.5) * HT_CELL;
      for (let i = 0; i < HT_W; i++) {
        const x = WORLD_MIN_X + (i + 0.5) * HT_CELL;
        const h = grid[j * HT_W + i];
        let col: number[];
        if (h < 0) {
          const t = Math.min(1, -h / 40);
          let shallow = [80, 190, 200];
          const isl = ctx.world.islandAt(x, z, 120);
          if (isl) shallow = hex(isl.def.theme.shallow);
          col = h > -8 ? mix(shallow, mid, (-h) / 8) : mix(mid, deep, t);
          // Faint wave hatching.
          if ((i + j * 3) % 23 === 0) col = mix(col, [200, 230, 240], 0.25);
        } else {
          const isl = ctx.world.islandAt(x, z, 10);
          const th = isl ? isl.def.theme : ISLANDS[0].theme;
          const hm = isl ? isl.def.height : 30;
          const k = h / hm;
          col = h < 2.5 ? hex(th.sand) : k < 0.35 ? mix(hex(th.grass), hex(th.grass2), k / 0.35) : k < 0.7 ? mix(hex(th.grass2), hex(th.rock), (k - 0.35) / 0.35) : mix(hex(th.rock), hex(th.peak), Math.min(1, (k - 0.7) / 0.3));
          // Hill shading from the neighbor to the north-west.
          const hn = grid[Math.max(0, j - 1) * HT_W + Math.max(0, i - 1)];
          const shade = Math.max(-0.25, Math.min(0.25, (h - hn) * 0.04));
          col = col.map((v) => v * (1 + shade));
          // Coastline ink.
          const hl = grid[j * HT_W + Math.max(0, i - 1)], hu = grid[Math.max(0, j - 1) * HT_W + i];
          if ((hl < 0) !== (h < 0) || (hu < 0) !== (h < 0)) col = [70, 50, 30];
        }
        col = mix(col, paper, 0.18);
        const o = (j * HT_W + i) * 4;
        img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
        if (h > -4) { landImg.data[o] = col[0] * 0.8; landImg.data[o + 1] = col[1] * 0.8; landImg.data[o + 2] = col[2] * 0.8; landImg.data[o + 3] = h > 0 ? 255 : 120; }
      }
    }
    g.putImageData(img, 0, 0);
    lg.putImageData(landImg, 0, 0);
    // Pre-blurred silhouettes for islands not yet discovered.
    this.blurred = this.world().islands.map((isl) => {
      const r = isl.R * 1.25;
      const px = Math.ceil((r * 2) / HT_CELL) + 24;
      const cv = document.createElement('canvas');
      cv.width = cv.height = px;
      const cg = cv.getContext('2d')!;
      cg.filter = 'blur(7px)';
      cg.drawImage(land, (isl.cx - r - WORLD_MIN_X) / HT_CELL - 12, (isl.cz - r - WORLD_MIN_Z) / HT_CELL - 12, px, px, 0, 0, px, px);
      return cv;
    });
  }

  private world() { return ctx.world; }

  loadFog(str: string) {
    this.fogBits.fill(0);
    decodeFog(str, this.fogBits);
    this.fogDirty = true;
  }
  saveFog() { return encodeFog(this.fogBits); }

  reveal(x: number, z: number, radius: number) {
    const ci = Math.floor((x - WORLD_MIN_X) / FOG_CELL), cj = Math.floor((z - WORLD_MIN_Z) / FOG_CELL);
    const rc = Math.ceil(radius / FOG_CELL);
    for (let j = cj - rc; j <= cj + rc; j++) {
      if (j < 0 || j >= FOG_H) continue;
      for (let i = ci - rc; i <= ci + rc; i++) {
        if (i < 0 || i >= FOG_W) continue;
        const k = j * FOG_W + i;
        if (this.fogBits[k]) continue;
        if ((i - ci) ** 2 + (j - cj) ** 2 <= rc * rc) { this.fogBits[k] = 1; this.fogDirty = true; }
      }
    }
  }

  isRevealed(x: number, z: number) {
    const i = Math.floor((x - WORLD_MIN_X) / FOG_CELL), j = Math.floor((z - WORLD_MIN_Z) / FOG_CELL);
    if (i < 0 || j < 0 || i >= FOG_W || j >= FOG_H) return false;
    return !!this.fogBits[j * FOG_W + i];
  }

  private refreshFog() {
    if (!this.fogDirty) return;
    this.fogDirty = false;
    const d = this.fogImg.data;
    for (let k = 0; k < this.fogBits.length; k++) {
      const o = k * 4;
      d[o] = 214; d[o + 1] = 196; d[o + 2] = 150;
      d[o + 3] = this.fogBits[k] ? 0 : 255;
    }
    this.fogCtx.putImageData(this.fogImg, 0, 0);
  }

  update(dt: number) {
    this.revealT -= dt;
    if (this.revealT <= 0) {
      this.revealT = 0.3;
      const p = ctx.player;
      const onShip = p.groundShip === ctx.ship || p.mode === 'helm';
      const focus = onShip ? ctx.ship.pos : p.pos;
      this.reveal(focus.x, focus.z, onShip ? 300 : 170);
      // Discover islands whose heart we've seen or that we've reached.
      ctx.world.islands.forEach((isl, idx) => {
        if (ctx.progress.discovered[idx]) return;
        const d = Math.hypot(focus.x - isl.cx, focus.z - isl.cz);
        if (d < isl.R + 260) {
          ctx.progress.discovered[idx] = true;
          ctx.ui.toast(`Island discovered: ${isl.def.name}`, 3.5);
          ctx.audio.sfx('bell');
        }
      });
    }
    this.refreshFog();
    this.drawMini();
    if (this.bigOpen) this.drawBig();
  }

  // ---- Coordinate helpers -------------------------------------------------
  private drawLayers(g: CanvasRenderingContext2D, x0: number, z0: number, wUnits: number, hUnits: number, w: number, h: number) {
    g.imageSmoothingEnabled = true;
    g.drawImage(this.base, (x0 - WORLD_MIN_X) / HT_CELL, (z0 - WORLD_MIN_Z) / HT_CELL, wUnits / HT_CELL, hUnits / HT_CELL, 0, 0, w, h);
    const s = w / wUnits;
    // Fog first; blurred silhouettes of unknown islands float above it as rumors.
    g.drawImage(this.fogCanvas, (x0 - WORLD_MIN_X) / FOG_CELL, (z0 - WORLD_MIN_Z) / FOG_CELL, wUnits / FOG_CELL, hUnits / FOG_CELL, 0, 0, w, h);
    this.world().islands.forEach((isl, idx) => {
      if (ctx.progress.discovered[idx] && this.isRevealed(isl.cx, isl.cz)) return;
      const cv = this.blurred[idx];
      if (!cv) return;
      const r = isl.R * 1.25 + 12 * HT_CELL;
      const sx = (isl.cx - r - x0) * s, sz = (isl.cz - r - z0) * s;
      if (sx > w || sz > h || sx + r * 2 * s < 0 || sz + r * 2 * s < 0) return;
      g.save();
      g.globalAlpha = ctx.progress.discovered[idx] ? 0.9 : 0.55;
      g.drawImage(cv, sx, sz, r * 2 * s, r * 2 * s);
      g.restore();
    });
  }

  private icon(g: CanvasRenderingContext2D, kind: 'player' | 'ship' | 'enemy' | 'monster' | 'chest' | 'next' | 'boss' | 'cleared' | 'wreck', x: number, y: number, angle = 0, size = 1) {
    g.save();
    g.translate(x, y);
    g.scale(size, size);
    switch (kind) {
      case 'player':
        g.rotate(angle);
        g.fillStyle = '#fff'; g.strokeStyle = '#1a1208'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath(); g.fill(); g.stroke();
        break;
      case 'ship':
        g.rotate(angle);
        g.fillStyle = '#7a4a22'; g.strokeStyle = '#1a1208'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(0, -9); g.quadraticCurveTo(5, -2, 4, 7); g.lineTo(-4, 7); g.quadraticCurveTo(-5, -2, 0, -9); g.fill(); g.stroke();
        g.fillStyle = '#fff8e0'; g.fillRect(-3.5, -3, 7, 4);
        break;
      case 'enemy':
        g.rotate(angle);
        g.fillStyle = '#d23a2a'; g.strokeStyle = '#2a0a06'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(0, -7); g.lineTo(4, 6); g.lineTo(-4, 6); g.closePath(); g.fill(); g.stroke();
        break;
      case 'wreck':
        g.fillStyle = '#9a7a5a'; g.strokeStyle = '#2a1a0a'; g.lineWidth = 1.5;
        g.beginPath(); g.arc(0, 0, 5, 0, Math.PI * 2); g.fill(); g.stroke();
        g.fillStyle = '#ffe070'; g.fillRect(-2, -2, 4, 4);
        break;
      case 'monster':
        g.fillStyle = '#b03ad0'; g.strokeStyle = '#1a0624'; g.lineWidth = 1.5;
        g.beginPath(); g.arc(0, 0, 5, 0, Math.PI * 2); g.fill(); g.stroke();
        break;
      case 'chest':
        g.fillStyle = '#ffd34a'; g.strokeStyle = '#4a3000'; g.lineWidth = 1.2;
        g.fillRect(-3.5, -2.5, 7, 5); g.strokeRect(-3.5, -2.5, 7, 5);
        break;
      case 'next':
        g.fillStyle = '#ffd34a'; g.strokeStyle = '#4a2a00'; g.lineWidth = 2;
        g.beginPath();
        for (let i = 0; i < 10; i++) { const r = i % 2 ? 4.5 : 10; const a = i / 10 * Math.PI * 2 - Math.PI / 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
        g.closePath(); g.fill(); g.stroke();
        break;
      case 'boss':
        g.fillStyle = '#1a1208'; g.beginPath(); g.arc(0, 0, 7, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#f4ead0'; g.beginPath(); g.arc(0, -1, 4, 0, Math.PI * 2); g.fill(); g.fillRect(-2.5, 1, 5, 3);
        g.fillStyle = '#1a1208'; g.fillRect(-2.2, -2, 1.6, 1.6); g.fillRect(0.6, -2, 1.6, 1.6);
        break;
      case 'cleared':
        g.strokeStyle = '#b8231a'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(-6, -6); g.lineTo(6, 6); g.moveTo(6, -6); g.lineTo(-6, 6); g.stroke();
        break;
    }
    g.restore();
  }

  private playerFocus() {
    const p = ctx.player;
    return p.mode === 'helm' ? ctx.ship.pos : p.pos;
  }

  // ---- Minimap ------------------------------------------------------------
  private drawMini() {
    const c = this.mini;
    const g = c.getContext('2d')!;
    const W = c.width, H = c.height;
    const p = this.playerFocus();
    const onSea = !ctx.world.islandAt(p.x, p.z, 40);
    const span = onSea ? 900 : 360; // world units across
    const s = W / span;
    g.clearRect(0, 0, W, H);
    g.save();
    g.beginPath(); g.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#2c5f86'; g.fillRect(0, 0, W, H);
    this.drawLayers(g, p.x - span / 2, p.z - span / 2, span, span, W, H);
    const toS = (x: number, z: number): [number, number] => [(x - p.x) * s + W / 2, (z - p.z) * s + H / 2];
    // Unopened chests on the current island.
    const isl = ctx.world.islandAt(p.x, p.z, 60);
    if (isl) for (const ch of ctx.game.activeChests()) { const [x, y] = toS(ch.x, ch.z); this.icon(g, 'chest', x, y); }
    for (const es of ctx.encounters.ships) {
      const [x, y] = toS(es.ship.pos.x, es.ship.pos.z);
      if (es.ship.wreck) this.icon(g, 'wreck', x, y);
      else if (es.ship.alive) this.icon(g, 'enemy', x, y, -es.ship.heading + Math.PI);
    }
    for (const m of ctx.encounters.monsters) if (m.alive) { const c3 = m.center(ctx.game.tmpV); const [x, y] = toS(c3.x, c3.z); this.icon(g, 'monster', x, y); }
    for (const e of ctx.game.activeEnemies()) { const [x, y] = toS(e.pos.x, e.pos.z); g.fillStyle = '#e8402a'; g.beginPath(); g.arc(x, y, 2.5, 0, Math.PI * 2); g.fill(); }
    const boss = ctx.game.boss;
    if (boss && boss.alive) { const [x, y] = toS(boss.pos.x, boss.pos.z); this.icon(g, 'boss', x, y, 0, 0.9); }
    const ship = ctx.ship;
    if (ctx.player.mode !== 'helm' && ctx.player.groundShip !== ship) { const [x, y] = toS(ship.pos.x, ship.pos.z); this.icon(g, 'ship', x, y, -ship.heading + Math.PI); }
    g.restore();
    // Next island: star if in range, else an edge arrow.
    const nid = Math.min(ctx.progress.nextIsland, ISLANDS.length - 1);
    const next = ctx.world.islands[nid];
    if (next && !ctx.progress.finished) {
      const target = isl === next && next.arena ? next.arena.pos : next.shipPark;
      let [x, y] = toS(target.x, target.z);
      const dx = x - W / 2, dy = y - H / 2;
      const d = Math.hypot(dx, dy);
      const R = W / 2 - 12;
      if (d > R) { x = W / 2 + dx / d * R; y = H / 2 + dy / d * R; }
      this.icon(g, 'next', x, y, 0, d > R ? 0.8 : 1);
    }
    // Player arrow (or ship when at the helm).
    const yaw = ctx.player.mode === 'helm' ? ship.heading : ctx.player.yaw;
    this.icon(g, ctx.player.mode === 'helm' ? 'ship' : 'player', W / 2, H / 2, -yaw + Math.PI, 1.1);
    // Camera view cone.
    g.save();
    g.translate(W / 2, H / 2);
    const cy = ctx.cam.yaw;
    const fx = -Math.sin(cy), fz = -Math.cos(cy);
    g.rotate(Math.atan2(fx, -fz));
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, 60);
    grad.addColorStop(0, 'rgba(255,255,255,0.28)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 60, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); g.closePath(); g.fill();
    g.restore();
  }

  // ---- World map ----------------------------------------------------------
  openBig() {
    this.bigOpen = true;
    const p = this.playerFocus();
    this.view.cx = p.x; this.view.cz = p.z - 600; this.view.zoom = 1;
    this.resizeBig();
  }
  closeBig() { this.bigOpen = false; }
  resizeBig() {
    const r = this.big.getBoundingClientRect();
    this.big.width = Math.max(200, Math.floor(r.width * devicePixelRatio));
    this.big.height = Math.max(200, Math.floor(r.height * devicePixelRatio));
  }
  private bigScale() {
    const H = this.big.height / devicePixelRatio;
    return (H / 3600) * this.view.zoom;
  }

  private drawBig() {
    const c = this.big;
    const g = c.getContext('2d')!;
    const dpr = devicePixelRatio;
    const W = c.width / dpr, H = c.height / dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = this.bigScale();
    const v = this.view;
    v.cx = Math.max(WORLD_MIN_X, Math.min(WORLD_MAX_X, v.cx));
    v.cz = Math.max(WORLD_MIN_Z, Math.min(WORLD_MAX_Z, v.cz));
    const x0 = v.cx - W / 2 / s, z0 = v.cz - H / 2 / s;
    g.fillStyle = '#d6c496'; g.fillRect(0, 0, W, H);
    // Clamp the source rect to the chart's bounds.
    const sx0 = Math.max(WORLD_MIN_X, x0), sz0 = Math.max(WORLD_MIN_Z, z0);
    const sx1 = Math.min(WORLD_MAX_X, x0 + W / s), sz1 = Math.min(WORLD_MAX_Z, z0 + H / s);
    if (sx1 > sx0 && sz1 > sz0) {
      g.save();
      g.translate((sx0 - x0) * s, (sz0 - z0) * s);
      this.drawLayers(g, sx0, sz0, sx1 - sx0, sz1 - sz0, (sx1 - sx0) * s, (sz1 - sz0) * s);
      g.restore();
    }
    const toS = (x: number, z: number): [number, number] => [(x - x0) * s, (z - z0) * s];
    // Grid lines like an old chart.
    g.strokeStyle = 'rgba(80,50,20,0.15)'; g.lineWidth = 1;
    for (let x = Math.ceil(x0 / 500) * 500; x < x0 + W / s; x += 500) { const [px] = toS(x, 0); g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.stroke(); }
    for (let z = Math.ceil(z0 / 500) * 500; z < z0 + H / s; z += 500) { const [, py] = toS(0, z); g.beginPath(); g.moveTo(0, py); g.lineTo(W, py); g.stroke(); }
    // Route: dashed line from us to the next island.
    const f = this.playerFocus();
    const [px, py] = toS(f.x, f.z);
    const nid = Math.min(ctx.progress.nextIsland, ISLANDS.length - 1);
    const next = ctx.world.islands[nid];
    if (next && !ctx.progress.finished) {
      const [nx, ny] = toS(next.shipPark.x, next.shipPark.z);
      g.save();
      g.setLineDash([8, 7]); g.lineDashOffset = -performance.now() / 60;
      g.strokeStyle = '#b8231a'; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(px, py); g.lineTo(nx, ny); g.stroke();
      g.restore();
    }
    // Island labels.
    g.textAlign = 'center';
    ctx.world.islands.forEach((isl, idx) => {
      const [ix, iy] = toS(isl.cx, isl.cz);
      const known = ctx.progress.discovered[idx];
      const cleared = ctx.progress.cleared[idx];
      g.font = `${known ? 18 : 16}px 'Pirata One', serif`;
      g.fillStyle = known ? '#2a1a0a' : 'rgba(42,26,10,0.55)';
      g.fillText(known ? isl.def.name : '? ? ?', ix, iy - isl.R * s - 10);
      if (known && isl.def.boss) {
        g.font = `12px 'Pirata One', serif`;
        g.fillText(cleared ? 'Liberated' : isl.def.crew, ix, iy - isl.R * s + 6);
      }
      if (idx === nid && !ctx.progress.finished) this.icon(g, 'next', ix, iy, 0, 1.4);
      else if (cleared && isl.def.boss) this.icon(g, 'cleared', ix, iy, 0, 1.4);
      else if (known && isl.def.boss) this.icon(g, 'boss', ix, iy, 0, 1.2);
    });
    // Ship marker.
    const ship = ctx.ship;
    const [shx, shy] = toS(ship.pos.x, ship.pos.z);
    this.icon(g, 'ship', shx, shy, -ship.heading + Math.PI, 1.5);
    if (ship.docked) { g.font = `13px 'Pirata One', serif`; g.fillStyle = '#2a1a0a'; g.fillText(`${ctx.progress.shipName} (moored)`, shx, shy + 22); }
    for (const es of ctx.encounters.ships) { const [x, y] = toS(es.ship.pos.x, es.ship.pos.z); this.icon(g, es.ship.wreck ? 'wreck' : 'enemy', x, y, -es.ship.heading + Math.PI); }
    if (ctx.player.mode !== 'helm') this.icon(g, 'player', px, py, -ctx.player.yaw + Math.PI, 1.3);
    // Compass rose.
    g.save();
    g.translate(W - 70, H - 80);
    g.strokeStyle = '#3a2410'; g.fillStyle = '#3a2410'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(0, 0, 34, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < 4; i++) {
      g.save(); g.rotate(i * Math.PI / 2);
      g.beginPath(); g.moveTo(0, -40); g.lineTo(6, 0); g.lineTo(0, 6); g.lineTo(-6, 0); g.closePath();
      g.fillStyle = i === 0 ? '#b8231a' : '#3a2410'; g.fill();
      g.restore();
    }
    g.font = `16px 'Pirata One', serif`; g.fillStyle = '#3a2410'; g.fillText('N', 0, -46);
    g.restore();
    void WORLD_W; void WORLD_H;
  }
}
