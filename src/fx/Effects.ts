// Transient visual effects: shockwaves, bursts, lightning, beams, slash arcs,
// ground telegraphs, explosions, splashes, light flashes and screen shake.
import * as THREE from 'three';
import { ctx } from '../game/ctx';
import { rand } from '../core/math';

interface Fx { update(dt: number): boolean; dispose(): void }

const telegraphVert = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const circleFrag = /* glsl */ `
uniform float uProgress; uniform vec3 uColor; uniform float uTime; varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0; float r = length(p);
  if (r > 1.0) discard;
  float edge = smoothstep(0.9, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r));
  float fill = step(r, uProgress) * 0.35;
  float pulse = 0.12 + 0.06 * sin(uTime * 14.0);
  gl_FragColor = vec4(uColor, edge * 0.95 + fill + pulse * (1.0 - r * 0.5));
}`;
const rectFrag = /* glsl */ `
uniform float uProgress; uniform vec3 uColor; uniform float uTime; varying vec2 vUv;
void main() {
  float edge = max(smoothstep(0.92, 1.0, abs(vUv.x * 2.0 - 1.0)), smoothstep(0.97, 1.0, vUv.y));
  float fill = step(vUv.y, uProgress) * 0.35;
  float pulse = 0.12 + 0.06 * sin(uTime * 14.0);
  gl_FragColor = vec4(uColor, edge * 0.9 + fill + pulse);
}`;

export class Telegraph {
  mesh: THREE.Mesh;
  t = 0;
  dead = false;
  constructor(public duration: number, mesh: THREE.Mesh) { this.mesh = mesh; }
}

export class Effects {
  private list: Fx[] = [];
  shakeAmt = 0;
  private flashEl: HTMLDivElement;
  private lightPool: THREE.PointLight[] = [];
  private lightLife: number[] = [];
  private lightMax: number[] = [];
  private ringGeo = new THREE.RingGeometry(0.85, 1, 48);
  private sphereGeo = new THREE.SphereGeometry(1, 20, 14);
  private telegraphs: Telegraph[] = [];
  hitstop = 0;

  constructor(private scene: THREE.Scene) {
    this.flashEl = document.getElementById('flash') as HTMLDivElement;
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 40, 1.5);
      scene.add(l);
      this.lightPool.push(l);
      this.lightLife.push(0);
      this.lightMax.push(1);
    }
  }

  shake(a: number) {
    if (!ctx.settings.shake) return;
    this.shakeAmt = Math.min(2.5, Math.max(this.shakeAmt, a));
  }

  flash(color = '#ffffff', strength = 0.6, dur = 0.25) {
    const el = this.flashEl;
    el.style.transition = 'none';
    el.style.background = color;
    el.style.opacity = String(strength);
    void el.offsetWidth;
    el.style.transition = `opacity ${dur}s ease-out`;
    el.style.opacity = '0';
  }

  light(pos: THREE.Vector3, color: number, intensity: number, dur: number, range = 40) {
    let idx = this.lightLife.indexOf(Math.min(...this.lightLife));
    const l = this.lightPool[idx];
    l.position.copy(pos);
    l.color.setHex(color);
    l.distance = range;
    l.userData.peak = intensity;
    this.lightLife[idx] = dur;
    this.lightMax[idx] = dur;
  }

  private add(fx: Fx) { this.list.push(fx); }

  /** Expanding flat ring on the ground or water. */
  shockwave(pos: THREE.Vector3, radius: number, color: number, dur = 0.6, thickness = 1, yUp = true) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const geo = thickness === 1 ? this.ringGeo : new THREE.RingGeometry(1 - 0.15 * thickness, 1, 48);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pos);
    if (yUp) m.rotation.x = -Math.PI / 2;
    this.scene.add(m);
    let t = 0;
    this.add({
      update: (dt) => {
        t += dt / dur;
        const s = 0.5 + radius * (1 - Math.pow(1 - t, 3));
        m.scale.set(s, s, s);
        mat.opacity = 0.9 * (1 - t);
        return t < 1;
      },
      dispose: () => { this.scene.remove(m); mat.dispose(); if (geo !== this.ringGeo) geo.dispose(); },
    });
  }

  /** Expanding translucent sphere (explosions, auras, impacts). */
  sphere(pos: THREE.Vector3, radius: number, color: number, dur = 0.5, opacity = 0.7, follow?: THREE.Object3D) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
    const m = new THREE.Mesh(this.sphereGeo, mat);
    m.position.copy(pos);
    this.scene.add(m);
    let t = 0;
    this.add({
      update: (dt) => {
        t += dt / dur;
        if (follow) m.position.copy(follow.position);
        const s = radius * (0.3 + 0.7 * (1 - Math.pow(1 - t, 2)));
        m.scale.set(s, s, s);
        mat.opacity = opacity * (1 - t);
        return t < 1;
      },
      dispose: () => { this.scene.remove(m); mat.dispose(); },
    });
  }

  /** Jagged lightning bolt between two points. */
  lightning(a: THREE.Vector3, b: THREE.Vector3, color = 0xbfe6ff, width = 0.25, life = 0.25, jag = 1) {
    const pts: THREE.Vector3[] = [];
    const n = Math.max(4, Math.floor(a.distanceTo(b) / 2.5));
    for (let i = 0; i <= n; i++) {
      const p = a.clone().lerp(b, i / n);
      if (i > 0 && i < n) p.add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(jag * Math.min(2.5, a.distanceTo(b) * 0.05 + 0.4)));
      pts.push(p);
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.05);
    const geo = new THREE.TubeGeometry(curve, n * 3, width, 4, false);
    const core = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const glow = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
    const m1 = new THREE.Mesh(geo, core);
    const m2 = new THREE.Mesh(geo, glow);
    m2.scale.setScalar(1);
    const glowGeo = new THREE.TubeGeometry(curve, n * 3, width * 3, 4, false);
    m2.geometry = glowGeo;
    this.scene.add(m1, m2);
    let t = 0;
    this.add({
      update: (dt) => {
        t += dt / life;
        core.opacity = 1 - t;
        glow.opacity = 0.4 * (1 - t);
        return t < 1;
      },
      dispose: () => { this.scene.remove(m1, m2); geo.dispose(); glowGeo.dispose(); core.dispose(); glow.dispose(); },
    });
  }

  /** Cylinder beam from a to b. */
  beam(a: THREE.Vector3, b: THREE.Vector3, radius: number, color: number, life = 0.4) {
    const len = a.distanceTo(b);
    const geo = new THREE.CylinderGeometry(radius, radius, len, 12, 1, true);
    geo.translate(0, len / 2, 0);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    core.scale.set(0.4, 0.4, 1);
    const m = new THREE.Mesh(geo, mat);
    m.add(core);
    m.position.copy(a);
    m.lookAt(b);
    this.scene.add(m);
    let t = 0;
    this.add({
      update: (dt) => {
        t += dt / life;
        const w = 1 - t * t;
        m.scale.set(w, w, 1);
        mat.opacity = 0.85 * w;
        return t < 1;
      },
      dispose: () => { this.scene.remove(m); geo.dispose(); mat.dispose(); },
    });
  }

  /** Crescent arc for melee swings. */
  slash(pos: THREE.Vector3, yaw: number, color: number, radius = 2.2, tilt = 0, life = 0.22, arc = Math.PI * 0.9) {
    const geo = new THREE.RingGeometry(radius * 0.6, radius, 24, 1, -arc / 2, arc);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat);
    const holder = new THREE.Group();
    holder.position.copy(pos);
    holder.rotation.y = yaw - Math.PI / 2;
    m.rotation.set(-Math.PI / 2 + tilt, 0, 0);
    holder.add(m);
    this.scene.add(holder);
    let t = 0;
    this.add({
      update: (dt) => {
        t += dt / life;
        mat.opacity = 0.9 * (1 - t);
        holder.scale.setScalar(0.8 + t * 0.4);
        return t < 1;
      },
      dispose: () => { this.scene.remove(holder); geo.dispose(); mat.dispose(); },
    });
  }

  /** A mesh that lives for a while with a custom per-frame callback. */
  custom(obj: THREE.Object3D, life: number, fn: (t: number, dt: number) => void, onDone?: () => void) {
    this.scene.add(obj);
    let t = 0;
    this.add({
      update: (dt) => { t += dt / life; fn(Math.min(1, t), dt); return t < 1; },
      dispose: () => {
        this.scene.remove(obj);
        obj.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry && m.geometry !== this.sphereGeo && m.geometry !== this.ringGeo) m.geometry.dispose(); });
        onDone?.();
      },
    });
  }

  telegraphCircle(pos: THREE.Vector3, radius: number, duration: number, color = 0xff3a2a) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uProgress: { value: 0 }, uColor: { value: new THREE.Color(color) }, uTime: { value: 0 } },
      vertexShader: telegraphVert, fragmentShader: circleFrag, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.copy(pos);
    m.position.y += 0.15;
    m.renderOrder = 5;
    this.scene.add(m);
    const tg = new Telegraph(duration, m);
    this.telegraphs.push(tg);
    return tg;
  }

  telegraphRect(origin: THREE.Vector3, yaw: number, length: number, width: number, duration: number, color = 0xff3a2a) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uProgress: { value: 0 }, uColor: { value: new THREE.Color(color) }, uTime: { value: 0 } },
      vertexShader: telegraphVert, fragmentShader: rectFrag, transparent: true, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
    });
    const geo = new THREE.PlaneGeometry(width, length);
    geo.translate(0, length / 2, 0);
    const m = new THREE.Mesh(geo, mat);
    const holder = new THREE.Group();
    holder.position.copy(origin);
    holder.position.y += 0.15;
    holder.rotation.y = yaw;
    m.rotation.set(Math.PI / 2, 0, 0);
    holder.add(m);
    m.renderOrder = 5;
    this.scene.add(holder);
    const tg = new Telegraph(duration, m);
    (tg as any).holder = holder;
    this.telegraphs.push(tg);
    return tg;
  }

  removeTelegraph(t: Telegraph) { t.dead = true; }

  explosion(pos: THREE.Vector3, scale = 1, color = 0xff8a30) {
    const P = ctx.particles;
    P.burst(pos, Math.floor(30 * scale), { speed: 9 * scale, life: 0.7, size: 1.2 * scale, sizeEnd: 0.1, color: 0xfff0a0, colorEnd: color, additive: true, drag: 3 });
    P.burst(pos, Math.floor(20 * scale), { speed: 4 * scale, up: 2, life: 1.8, size: 1.5 * scale, sizeEnd: 4 * scale, color: 0x555555, colorEnd: 0x222222, alpha: 0.6, drag: 2 });
    P.burst(pos, Math.floor(16 * scale), { speed: 14 * scale, up: 4, life: 1.0, size: 0.25, sizeEnd: 0.05, color: 0xffd080, colorEnd: 0xff4010, additive: true, gravity: 12, drag: 0.5 });
    this.sphere(pos, 3.5 * scale, 0xffc060, 0.35, 0.8);
    this.shockwave(pos.clone().setY(Math.max(pos.y - 0.5, 0.2)), 6 * scale, color, 0.6);
    this.light(pos, color, 80 * scale, 0.4, 30 * scale);
  }

  splash(pos: THREE.Vector3, scale = 1) {
    const P = ctx.particles;
    const p = pos.clone(); p.y = Math.max(0.2, ctx.ocean.heightAt(pos.x, pos.z));
    for (let i = 0; i < 30 * scale; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(1, 4) * scale;
      P.emit({ pos: p.clone(), vel: new THREE.Vector3(Math.cos(a) * s, rand(5, 12) * scale, Math.sin(a) * s), life: rand(0.6, 1.2), size: rand(0.4, 0.9) * scale, sizeEnd: 0.1, color: 0xffffff, colorEnd: 0xbfe6ff, gravity: 18, drag: 0.3, alpha: 0.9 });
    }
    this.shockwave(p, 4 * scale, 0xdff6ff, 0.8, 1.5);
  }

  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (!this.list[i].update(dt)) {
        this.list[i].dispose();
        this.list.splice(i, 1);
      }
    }
    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      const t = this.telegraphs[i];
      t.t += dt;
      const u = (t.mesh.material as THREE.ShaderMaterial).uniforms;
      u.uProgress.value = Math.min(1, t.t / t.duration);
      u.uTime.value += dt;
      if (t.dead || t.t > t.duration + 0.1) {
        const holder = (t as any).holder as THREE.Object3D | undefined;
        this.scene.remove(holder || t.mesh);
        t.mesh.geometry.dispose();
        (t.mesh.material as THREE.Material).dispose();
        this.telegraphs.splice(i, 1);
      }
    }
    for (let i = 0; i < this.lightPool.length; i++) {
      if (this.lightLife[i] > 0) {
        this.lightLife[i] -= dt;
        const f = Math.max(0, this.lightLife[i] / this.lightMax[i]);
        this.lightPool[i].intensity = (this.lightPool[i].userData.peak || 0) * f;
      } else this.lightPool[i].intensity = 0;
    }
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 3);
  }
}
