// The captain as a hand-animated skinned model (tools/blender/luffy): a drop-in for the procedural
// Humanoid. Locomotion clips are phase-locked and blended by speed, one-shot actions follow the
// gameplay clock (actionT) so hit frames line up, and a few procedural layers sit on top: lean into
// turns, the wheel, and the real rubber arm stretch for Gomu Gomu moves.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { charOutlineMat, clothGradient, skinGradient } from '../world/materials';
import { auraMaterial, rimLight, type AnimInput, type CharRig, type J } from './Humanoid';
import { clamp, damp, lerp } from '../core/math';

let tpl: { scene: THREE.Group; clips: Map<string, THREE.AnimationClip> } | null = null;

export async function loadCaptainModel(url: string) {
  try {
    const g = await new GLTFLoader().loadAsync(url);
    tpl = { scene: g.scene as THREE.Group, clips: new Map(g.animations.map((c) => [c.name, c])) };
  } catch (e) {
    console.warn('Captain model unavailable, using the procedural rig', e);
  }
}
export const captainModelReady = () => tpl !== null;

const BONE: Record<J, string> = {
  body: 'root', hips: 'hips', spine: 'spine', chest: 'chest', neck: 'neck', head: 'head',
  shL: 'upperarm.L', elL: 'forearm.L', haL: 'hand.L', shR: 'upperarm.R', elR: 'forearm.R', haR: 'hand.R',
  hiL: 'thigh.L', knL: 'shin.L', ftL: 'foot.L', hiR: 'thigh.R', knR: 'shin.R', ftR: 'foot.R',
};

// Game actions without a dedicated clip borrow the closest one.
const ACTION_CLIP: Record<string, string> = {
  slashR: 'punchR', slashL: 'punchL', slashDown: 'slam', spin: 'kick', shoot: 'castR', throw: 'castR',
  roar: 'powerup', block: 'stance', wave: 'idleHat',
};

// Ground speed (m/s) each gait clip was authored at: stride / (duty * cycle) in luffy_anims.gait.
const GAITS: [string, number][] = [['walk', 1.57], ['run', 6.9], ['sprint', 10.9]];

export class ModelRig implements CharRig {
  root = new THREE.Group();
  /** Hidden while another effect draws the right arm (Humanoid compatibility). */
  armR = new THREE.Object3D();
  scale = 1;
  private model: THREE.Object3D;
  private body = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private acts = new Map<string, THREE.AnimationAction>();
  private w = new Map<string, number>();
  private bones = {} as Record<string, THREE.Bone>;
  private mats: THREE.MeshToonMaterial[] = [];
  private flashT = 0;
  private flashColor = new THREE.Color();
  private tint: THREE.Color | null = null;
  private aura: THREE.Mesh | null = null;
  private hair = { value: new THREE.Vector4(1, 1, 1, 0) };
  private time = 0;
  private phase = 0;
  private airT = 0;
  private landT = 1;
  private deadT = 0;
  private sinceAction = 10;
  private idleT = 0;
  private hatT = -1;
  private nextHat = 7;
  private lean = 0;
  private lastAction: string | null = null;
  private stretchTarget: THREE.Vector3 | null = null;

  constructor() {
    if (!tpl) throw new Error('captain model not loaded');
    this.model = SkeletonUtils.clone(tpl.scene);
    this.body.add(this.model);
    this.root.add(this.body);
    this.model.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones[o.name] = o as THREE.Bone;
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      m.frustumCulled = false;
      m.castShadow = true;
      m.material = this.toon(m.material as THREE.MeshStandardMaterial);
      const ol = new THREE.SkinnedMesh(m.geometry, charOutlineMat);
      ol.frustumCulled = false;
      m.parent!.add(ol);
      ol.bind(m.skeleton, m.bindMatrix);
    });
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const [name, clip] of tpl.clips) {
      const a = this.mixer.clipAction(clip);
      a.play();
      a.paused = true;
      a.enabled = false;
      a.setEffectiveWeight(0);
      this.acts.set(name, a);
      this.w.set(name, 0);
    }
    this.w.set('idle', 1);
  }

  private bone(n: string) { return this.bones[THREE.PropertyBinding.sanitizeNodeName(n)]; }

  private toon(src: THREE.MeshStandardMaterial) {
    const skin = src.name === 'skin';
    const m = new THREE.MeshToonMaterial({
      name: src.name, color: src.color.clone(), map: src.map, normalMap: src.normalMap,
      gradientMap: skin ? skinGradient() : clothGradient(),
    });
    if (src.normalMap) m.normalScale.set(0.6, 0.6);
    rimLight(m);
    if (src.map) {
      // Gear-5 style hair recolour: dark texels above the neck, outside the hat material.
      const hair = this.hair;
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = (sh, r) => {
        prev.call(m, sh, r);
        sh.uniforms.uHair = hair;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vHairY;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHairY = position.y;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec4 uHair; varying float vHairY;')
          .replace('#include <map_fragment>', `#include <map_fragment>
            float hk = uHair.w * smoothstep(1.56, 1.62, vHairY) * (1.0 - smoothstep(0.08, 0.16, dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))));
            diffuseColor.rgb = mix(diffuseColor.rgb, uHair.rgb * 0.95, hk);`);
      };
      m.customProgramCacheKey = () => 'captain-model';
    }
    this.mats.push(m);
    return m;
  }

  worldPos(joint: J, out = new THREE.Vector3()) {
    const b = this.bone(BONE[joint]);
    return (b ?? this.root).getWorldPosition(out);
  }

  flash(color = 0xffffff, dur = 0.12) {
    this.flashT = dur;
    this.flashColor.setHex(color).multiplyScalar(0.5);
    this.applyEmissive();
  }
  setTint(c: number | null) { this.tint = c === null ? null : new THREE.Color(c); this.applyEmissive(); }
  private applyEmissive() {
    for (const m of this.mats) {
      if (this.flashT > 0) m.emissive.copy(this.flashColor);
      else if (this.tint) m.emissive.copy(this.tint);
      else m.emissive.setRGB(0, 0, 0);
    }
  }
  setHairColor(c: number) {
    const col = new THREE.Color(c);
    // The model's own hair is near-black: only a clearly lighter colour is worth repainting.
    this.hair.value.set(col.r, col.g, col.b, col.getHSL({ h: 0, s: 0, l: 0 }).l > 0.25 ? 1 : 0);
  }
  setEyeGlow(_c: number) { /* the painted eyes stay as they are */ }

  setAura(color: number | null) {
    if (color === null) { if (this.aura) { this.root.remove(this.aura); this.aura = null; } return; }
    if (!this.aura) {
      this.aura = new THREE.Mesh(new THREE.SphereGeometry(0.75, 24, 18), auraMaterial(color));
      this.aura.scale.set(1, 1.6, 1);
      this.aura.position.y = 1.0;
      this.root.add(this.aura);
    }
    ((this.aura.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color).setHex(color);
  }

  /** Stretch the right arm straight at a world point (rubber punches); null lets the clip drive it again. */
  stretchTo(p: THREE.Vector3 | null) { this.stretchTarget = p ? (this.stretchTarget ?? new THREE.Vector3()).copy(p) : null; }

  private clipOf(action: string) {
    if (this.acts.has(action)) return action;
    const alt = ACTION_CLIP[action];
    return alt && this.acts.has(alt) ? alt : 'punchR';
  }

  update(dt: number, s: AnimInput) {
    this.time += dt;
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.applyEmissive(); }
    if (this.aura) {
      const t = this.time;
      this.aura.scale.set(1 + Math.sin(t * 7) * 0.05, 1.6 + Math.sin(t * 5) * 0.08, 1 + Math.sin(t * 7) * 0.05);
    }
    const tgt = new Map<string, number>();
    const times = new Map<string, number>();
    const dur = (n: string) => this.acts.get(n)!.getClip().duration;
    let sharp = 12;

    // airtime and landing
    if (!s.grounded) this.airT += dt;
    else {
      if (this.airT > 0.3) this.landT = 0;
      this.airT = 0;
    }
    this.landT += dt;
    this.sinceAction = s.action ? 0 : this.sinceAction + dt;

    if (s.dead) {
      this.deadT += dt;
      tgt.set('dead', 1); times.set('dead', Math.min(this.deadT, dur('dead')));
      sharp = 18;
    } else {
      this.deadT = 0;
      // base layer
      if (s.steer !== undefined && s.steer !== null) {
        tgt.set('steer', 1); times.set('steer', this.time % dur('steer'));
      } else if (s.stun) {
        tgt.set('stun', 1); times.set('stun', this.time % dur('stun'));
      } else if (!s.grounded) {
        const up = s.vy > 0 && this.airT < dur('jump');
        tgt.set(up ? 'jump' : 'fall', 1);
        times.set('jump', Math.min(this.airT, dur('jump')));
        times.set('fall', this.time % dur('fall'));
      } else {
        this.locomotion(dt, s.speed, tgt, times, dur);
        if (this.landT < dur('land')) {
          const k = 1 - this.landT / dur('land');
          for (const [n, v] of tgt) tgt.set(n, v * (1 - k));
          tgt.set('land', k); times.set('land', this.landT);
        }
      }
      // action overlay
      if (s.action) {
        const c = this.clipOf(s.action);
        if (s.action !== this.lastAction) this.w.set(c, Math.max(this.w.get(c) ?? 0, 0.35));
        for (const n of tgt.keys()) tgt.set(n, 0);
        tgt.set(c, 1); times.set(c, clamp(s.actionT, 0, 1) * dur(c));
        sharp = 28;
      }
    }
    this.lastAction = s.action;

    // blend weights toward their targets, keeping the total at 1 (no bind-pose bleed)
    let sum = 0;
    for (const [n, cur] of this.w) {
      const v = damp(cur, tgt.get(n) ?? 0, sharp, dt);
      this.w.set(n, v < 0.002 ? 0 : v);
      sum += this.w.get(n)!;
    }
    for (const [n, a] of this.acts) {
      const v = sum > 0 ? this.w.get(n)! / sum : n === 'idle' ? 1 : 0;
      a.enabled = v > 0;
      a.setEffectiveWeight(v);
      if (times.has(n)) a.time = times.get(n)!;
    }
    this.mixer.update(0);
    this.overlays(dt, s);
  }

  private locomotion(dt: number, spd: number, tgt: Map<string, number>, times: Map<string, number>, dur: (n: string) => number) {
    if (spd < 0.25) {
      this.idleT += dt;
      // occasional fidget with the hat; a guard stance right after a fight
      if (this.hatT < 0 && this.idleT > this.nextHat && this.sinceAction > 3) { this.hatT = 0; this.nextHat = this.idleT + 9 + Math.random() * 8; }
      if (this.hatT >= 0) {
        this.hatT += dt;
        if (this.hatT >= dur('idleHat')) this.hatT = -1;
      }
      if (this.hatT >= 0) { tgt.set('idleHat', 1); times.set('idleHat', this.hatT); }
      else if (this.sinceAction < 2.5) { tgt.set('stance', 1); times.set('stance', this.time % dur('stance')); }
      else { tgt.set('idle', 1); times.set('idle', this.idleT % dur('idle')); }
      return;
    }
    this.idleT = 0;
    this.hatT = -1;
    // weights over walk / run / sprint by speed, idle fading in at a crawl
    const g = [0, 0, 0];
    if (spd < GAITS[0][1]) g[0] = 1;
    else if (spd < GAITS[1][1]) { const k = (spd - GAITS[0][1]) / (GAITS[1][1] - GAITS[0][1]); g[0] = 1 - k; g[1] = k; }
    else if (spd < GAITS[2][1]) { const k = (spd - GAITS[1][1]) / (GAITS[2][1] - GAITS[1][1]); g[1] = 1 - k; g[2] = k; }
    else g[2] = 1;
    const crawl = clamp((spd - 0.25) / 0.6, 0, 1);
    let rate = 0;
    GAITS.forEach(([n, v], i) => { rate += g[i] * (spd / v) / dur(n); });
    this.phase = (this.phase + dt * rate) % 1;
    GAITS.forEach(([n], i) => {
      if (g[i] > 0) { tgt.set(n, g[i] * crawl); times.set(n, this.phase * dur(n)); }
    });
    if (crawl < 1) { tgt.set('idle', 1 - crawl); times.set('idle', 0); }
  }

  private overlays(dt: number, s: AnimInput) {
    // lean into turns when moving fast
    const want = s.grounded && !s.action ? clamp(-(s.turn ?? 0) * 0.16 * clamp(s.speed / 7, 0, 1.4), -0.22, 0.22) : 0;
    this.lean = damp(this.lean, want, 8, dt);
    this.body.rotation.z = this.lean;
    if (s.steer !== undefined && s.steer !== null) {
      const ch = this.bone('chest');
      ch?.rotateY(s.steer * 0.3);
    }
    const ua = this.bone('upperarm.R'), fa = this.bone('forearm.R'), ha = this.bone('hand.R');
    if (!ua || !fa || !ha) return;
    if (this.stretchTarget) {
      fa.quaternion.identity();
      ha.quaternion.identity();
      fa.scale.set(1, 1, 1);
      this.model.updateMatrixWorld(true);
      const S = ua.getWorldPosition(new THREE.Vector3());
      const d = this.stretchTarget.clone().sub(S);
      const len = d.length();
      if (len > 1e-3) {
        const qw = ua.getWorldQuaternion(new THREE.Quaternion());
        const cur = new THREE.Vector3(0, 1, 0).applyQuaternion(qw);
        qw.premultiply(new THREE.Quaternion().setFromUnitVectors(cur, d.divideScalar(len)));
        const pq = ua.parent!.getWorldQuaternion(new THREE.Quaternion());
        ua.quaternion.copy(pq.invert().multiply(qw));
        const ps = ua.parent!.getWorldScale(new THREE.Vector3()).y;
        const reach = (fa.position.y + ha.position.y + 0.09) * ps;
        const k = Math.max(1, len / reach);
        const thin = 1 / Math.sqrt(lerp(1, k, 0.35));
        ua.scale.set(thin, k, thin);
        ha.scale.set(1 / thin, 1 / k, 1 / thin);
      }
    } else if (!this.armR.visible) {
      ua.scale.setScalar(1e-4);
    }
  }

  dispose() {
    for (const m of this.mats) m.dispose();
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
  }
}
