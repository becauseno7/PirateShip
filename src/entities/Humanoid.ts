// Procedurally built, procedurally animated anime-style character rig.
import * as THREE from 'three';
import { clothGradient, skinGradient, charOutlineMat, sharedUniforms, strawTexture } from '../world/materials';
import { EXPR, Expr, FaceOpts, FaceStyle, atlasView, beardGeometry, faceAtlas, faceGeometry, fistGeometry, hairGeometry, headGeometry, headPoint, setAtlasCell, shell } from './rigParts';

// Flickering rim-lit flame aura for awakened fighters.
function auraMaterial(color: number) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: sharedUniforms.uTime, uColor: { value: new THREE.Color(color) } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vP = position; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform float uTime; uniform vec3 uColor; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.6);
        float a = atan(vP.z, vP.x);
        float flame = 0.55 + 0.45 * sin(vP.y * 9.0 - uTime * 14.0 + sin(a * 5.0 + uTime * 3.0) * 2.0);
        float top = smoothstep(0.75, 0.1, vP.y);
        float alpha = rim * (0.45 + 0.75 * flame) * (0.4 + 0.6 * top);
        gl_FragColor = vec4(mix(uColor, vec3(1.0), rim * 0.15) * alpha * 0.85, alpha);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
}
import { clamp, damp, easeOutCubic, lerp, smoothstep, window01 } from '../core/math';

export type Weapon = 'none' | 'cutlass' | 'katana' | 'katana3' | 'musket' | 'anchor' | 'kanabo' | 'axe' | 'scimitar2' | 'spear' | 'staff';
export type Headgear = 'straw' | 'bandana' | 'tricorn' | 'none' | 'helmet' | 'navy' | 'turban' | 'crown' | 'hood' | 'horns';
export type Hair = 'spiky' | 'messy' | 'long' | 'topknot' | 'bald' | 'wild';

export interface RigLook {
  skin: string | number;
  hair: string | number;
  hairStyle: Hair;
  shirt: string | number;
  pants: string | number;
  shoes?: string | number;
  hat: Headgear;
  hatColor?: string | number;
  scar?: boolean;
  sash?: string | number;
  build?: number;
  height?: number;
  vest?: boolean;
  cape?: string | number;
  beard?: string | number;
  armor?: string | number;
  eyeGlow?: number;
  weapon?: Weapon;
  weaponColor?: number;
  outline?: boolean;
  belly?: number;
  face?: FaceStyle;
  iris?: string;
}

export interface AnimInput {
  speed: number;
  grounded: boolean;
  vy: number;
  action: string | null;
  actionT: number;
  dead?: boolean;
  stun?: boolean;
  steer?: number | null;
  turn?: number;
}

type J = 'body' | 'hips' | 'spine' | 'chest' | 'neck' | 'head' | 'shL' | 'elL' | 'haL' | 'shR' | 'elR' | 'haR' | 'hiL' | 'knL' | 'ftL' | 'hiR' | 'knR' | 'ftR';
type Pose = Partial<Record<J, [number, number, number]>>;
const JOINTS: J[] = ['body', 'hips', 'spine', 'chest', 'neck', 'head', 'shL', 'elL', 'haL', 'shR', 'elR', 'haR', 'hiL', 'knL', 'ftL', 'hiR', 'knR', 'ftR'];

const EXPR_FOR: Record<string, Expr> = { hit: 'pain', kneel: 'pain', victory: 'grin', wave: 'grin', eat: 'grin', block: 'angry' };

const capCache = new Map<string, THREE.CapsuleGeometry>();
function capsule(r: number, len: number) {
  const k = r.toFixed(3) + ':' + len.toFixed(3);
  let g = capCache.get(k);
  if (!g) { g = new THREE.CapsuleGeometry(r, len, 4, 10); capCache.set(k, g); }
  return g;
}

/** Soft anime rim light: brightens silhouette edges so characters pop off the background. */
function rimLight(m: THREE.MeshToonMaterial) {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `
      float rimK = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.6);
      outgoingLight += (diffuseColor.rgb * 0.5 + vec3(0.07, 0.065, 0.06)) * smoothstep(0.25, 0.7, rimK);
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'char-rim';
}

const limbCache = new Map<string, THREE.BufferGeometry>();
/** Tapered limb with a soft muscle bulge; same footprint as capsule(r0, len). */
function limb(r0: number, r1: number, len: number, bulgeAt = 0.3, bulge = 0.008) {
  const k = [r0, r1, len, bulgeAt, bulge].map((v) => v.toFixed(3)).join(':');
  let g = limbCache.get(k);
  if (!g) {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 4; i++) { const a = (i / 4) * Math.PI / 2; pts.push(new THREE.Vector2(Math.max(1e-4, r0 * Math.sin(a)), len / 2 + r0 * Math.cos(a))); }
    for (let i = 1; i < 10; i++) {
      const t = i / 10;
      const r = r0 + (r1 - r0) * t + bulge * Math.exp(-Math.pow((t - bulgeAt) / 0.22, 2));
      pts.push(new THREE.Vector2(r, len / 2 - t * len));
    }
    for (let i = 0; i <= 4; i++) { const a = Math.PI / 2 + (i / 4) * Math.PI / 2; pts.push(new THREE.Vector2(Math.max(1e-4, r1 * Math.sin(a)), -len / 2 + r1 * Math.cos(a))); }
    g = new THREE.LatheGeometry(pts.reverse(), 12);
    g.computeVertexNormals();
    limbCache.set(k, g);
  }
  return g;
}

/** Action pose generators: given t in [0,1], return pose targets + weight. */
const ACTIONS: Record<string, (t: number) => { pose: Pose; w: number; bodyY?: number; spin?: number; lean?: number }> = {
  punchR: (t) => {
    const wind = smoothstep(0, 0.3, t), hit = smoothstep(0.3, 0.45, t), rec = smoothstep(0.6, 1, t);
    const k = hit * (1 - rec);
    return { w: window01(t, 0, 1, 0.12), pose: {
      shR: [lerp(0.6 * wind, -1.6, k), 0, -0.1], elR: [lerp(-1.9 * wind, -0.1, k), 0, 0],
      shL: [0.3, 0, 0.3], elL: [-1.6, 0, 0],
      chest: [0.1, lerp(0.5 * wind, -0.6, k), 0], hips: [0, lerp(0.2 * wind, -0.3, k), 0],
      hiL: [-0.35, 0, 0], knL: [0.3, 0, 0], hiR: [0.25, 0, 0], knR: [0.2, 0, 0],
    } };
  },
  punchL: (t) => {
    const wind = smoothstep(0, 0.3, t), hit = smoothstep(0.3, 0.45, t), rec = smoothstep(0.6, 1, t);
    const k = hit * (1 - rec);
    return { w: window01(t, 0, 1, 0.12), pose: {
      shL: [lerp(0.6 * wind, -1.6, k), 0, 0.1], elL: [lerp(-1.9 * wind, -0.1, k), 0, 0],
      shR: [0.3, 0, -0.3], elR: [-1.6, 0, 0],
      chest: [0.1, lerp(-0.5 * wind, 0.6, k), 0], hips: [0, lerp(-0.2 * wind, 0.3, k), 0],
      hiR: [-0.35, 0, 0], knR: [0.3, 0, 0], hiL: [0.25, 0, 0], knL: [0.2, 0, 0],
    } };
  },
  kick: (t) => {
    const k = smoothstep(0.15, 0.4, t) * (1 - smoothstep(0.6, 0.95, t));
    return { w: window01(t, 0, 1, 0.1), pose: {
      hiR: [-1.7 * k, 0, 0], knR: [lerp(1.2, 0.05, k), 0, 0], hiL: [0.1, 0, 0], knL: [0.3, 0, 0],
      chest: [-0.35 * k, -0.3 * k, 0], shL: [-0.6, 0, 0.9], shR: [0.6, 0, -0.9], elL: [-0.8, 0, 0], elR: [-0.8, 0, 0],
    } };
  },
  uppercut: (t) => {
    const k = smoothstep(0.25, 0.5, t) * (1 - smoothstep(0.7, 1, t));
    const wind = smoothstep(0, 0.25, t);
    return { w: window01(t, 0, 1, 0.1), bodyY: k * 0.25 - wind * 0.15 * (1 - k), pose: {
      shR: [lerp(0.5 * wind, -2.9, k), 0, -0.2], elR: [lerp(-1.4, -0.4, k), 0, 0],
      chest: [lerp(0.3 * wind, -0.3, k), lerp(0.4 * wind, -0.3, k), 0], shL: [0.2, 0, 0.4], elL: [-1.5, 0, 0],
      hiL: [-0.5 * wind, 0, 0], knL: [0.8 * wind * (1 - k), 0, 0], hiR: [0.2, 0, 0], knR: [0.5 * wind, 0, 0],
    } };
  },
  slam: (t) => {
    const up = smoothstep(0, 0.45, t), down = smoothstep(0.45, 0.6, t), rec = smoothstep(0.75, 1, t);
    const a = lerp(lerp(0, -3.0, up), -0.9, down);
    return { w: window01(t, 0, 1, 0.08), bodyY: -0.25 * down * (1 - rec), pose: {
      shL: [a, 0, 0.15], shR: [a, 0, -0.15], elL: [-0.3, 0, 0], elR: [-0.3, 0, 0],
      chest: [lerp(-0.35 * up, 0.6, down), 0, 0], hiL: [-0.6 * down, 0, 0], knL: [1.0 * down, 0, 0], hiR: [-0.2 * down, 0, 0], knR: [0.9 * down, 0, 0],
    } };
  },
  cast: (t) => {
    const k = smoothstep(0, 0.25, t);
    return { w: window01(t, 0, 1, 0.12), pose: {
      shL: [-1.45 * k, 0, -0.15 * k], shR: [-1.45 * k, 0, 0.15 * k], elL: [-0.1, 0, 0], elR: [-0.1, 0, 0],
      chest: [0.25 * k, 0, 0], hiL: [-0.4, 0, 0], knL: [0.35, 0, 0], hiR: [0.35, 0, 0], knR: [0.15, 0, 0],
    } };
  },
  castR: (t) => {
    const wind = smoothstep(0, 0.3, t), k = smoothstep(0.3, 0.45, t) * (1 - smoothstep(0.75, 1, t));
    return { w: window01(t, 0, 1, 0.1), pose: {
      shR: [lerp(0.8 * wind, -1.55, k), 0, 0], elR: [lerp(-1.6 * wind, 0, k), 0, 0],
      chest: [0.15, lerp(0.7 * wind, -0.5, k), 0], shL: [-0.5, 0, 0.6], elL: [-1.2, 0, 0],
      hiL: [-0.45, 0, 0], knL: [0.4, 0, 0], hiR: [0.35, 0, 0], knR: [0.2, 0, 0],
    } };
  },
  castUp: (t) => {
    const k = smoothstep(0, 0.3, t);
    return { w: window01(t, 0, 1, 0.12), bodyY: 0.05 * k, pose: {
      shL: [-2.9 * k, 0, 0.35 * k], shR: [-2.9 * k, 0, -0.35 * k], elL: [-0.2, 0, 0], elR: [-0.2, 0, 0],
      chest: [-0.3 * k, 0, 0], neck: [-0.3 * k, 0, 0], hiL: [0, 0, 0.12 * k], hiR: [0, 0, -0.12 * k],
    } };
  },
  stretch: (t) => {
    const k = smoothstep(0, 0.15, t) * (1 - smoothstep(0.8, 1, t));
    return { w: window01(t, 0, 1, 0.08), pose: {
      shR: [-1.57 * k, 0, 0], elR: [0, 0, 0], shL: [0.5, 0, 0.6], elL: [-1.2, 0, 0],
      chest: [0.2, -0.6 * k, 0], hips: [0, -0.3 * k, 0], hiL: [-0.6, 0, 0], knL: [0.5, 0, 0], hiR: [0.5, 0, 0], knR: [0.1, 0, 0],
    } };
  },
  gatling: (t) => {
    const f = Math.sin(t * Math.PI * 22);
    return { w: window01(t, 0, 1, 0.08), pose: {
      shR: [-1.0 - 0.6 * f, 0, 0], shL: [-1.0 + 0.6 * f, 0, 0], elR: [-0.6 + 0.5 * f, 0, 0], elL: [-0.6 - 0.5 * f, 0, 0],
      chest: [0.3, 0.25 * f, 0], hiL: [-0.6, 0, 0], knL: [0.6, 0, 0], hiR: [0.5, 0, 0], knR: [0.3, 0, 0],
    } };
  },
  slashR: (t) => {
    const wind = smoothstep(0, 0.3, t), k = smoothstep(0.3, 0.5, t) * (1 - smoothstep(0.7, 1, t));
    return { w: window01(t, 0, 1, 0.1), pose: {
      shR: [-1.3, lerp(-1.2 * wind, 1.0, k), lerp(-1.2 * wind, 0.4, k)], elR: [-0.4, 0, 0],
      shL: [-1.3, lerp(1.0 * wind, -0.4, k), lerp(0.4, 0.8, k)], elL: [-0.6, 0, 0],
      chest: [0.15, lerp(0.7 * wind, -0.7, k), 0], hiL: [-0.4, 0, 0], knL: [0.4, 0, 0], hiR: [0.3, 0, 0], knR: [0.2, 0, 0],
    } };
  },
  slashL: (t) => {
    const wind = smoothstep(0, 0.3, t), k = smoothstep(0.3, 0.5, t) * (1 - smoothstep(0.7, 1, t));
    return { w: window01(t, 0, 1, 0.1), pose: {
      shL: [-1.3, lerp(1.2 * wind, -1.0, k), lerp(1.2 * wind, -0.4, k)], elL: [-0.4, 0, 0],
      shR: [-1.3, lerp(-1.0 * wind, 0.4, k), lerp(-0.4, -0.8, k)], elR: [-0.6, 0, 0],
      chest: [0.15, lerp(-0.7 * wind, 0.7, k), 0], hiR: [-0.4, 0, 0], knR: [0.4, 0, 0], hiL: [0.3, 0, 0], knL: [0.2, 0, 0],
    } };
  },
  slashDown: (t) => {
    const up = smoothstep(0, 0.35, t), down = smoothstep(0.35, 0.5, t), rec = smoothstep(0.7, 1, t);
    const a = lerp(lerp(-0.5, -3.0, up), -0.7, down);
    return { w: window01(t, 0, 1, 0.08), bodyY: -0.15 * down * (1 - rec), pose: {
      shR: [a, 0, 0.2], shL: [a, 0, -0.2], elR: [-0.2, 0, 0], elL: [-0.2, 0, 0],
      chest: [lerp(-0.3 * up, 0.45, down), 0, 0], hiL: [-0.7 * down, 0, 0], knL: [0.7 * down, 0, 0], hiR: [0.4 * down, 0, 0],
    } };
  },
  spin: (t) => {
    const k = window01(t, 0, 1, 0.1);
    return { w: k, spin: easeOutCubic(t) * Math.PI * 4, pose: {
      shL: [-0.3, 0, 1.5], shR: [-0.3, 0, -1.5], elL: [0, 0, 0], elR: [0, 0, 0], hiL: [-0.3, 0, 0.2], hiR: [0.2, 0, -0.2], knL: [0.4, 0, 0],
    } };
  },
  shoot: (t) => {
    const recoil = smoothstep(0.5, 0.55, t) * (1 - smoothstep(0.55, 0.8, t));
    return { w: window01(t, 0, 1, 0.12), pose: {
      shR: [-1.5 + recoil * 0.4, 0.2, 0], elR: [-0.2, 0, 0], shL: [-1.3, -0.5, 0.2], elL: [-0.7, 0, 0],
      chest: [-0.05 * recoil, 0.3, 0], neck: [0, -0.3, 0], hiL: [-0.3, 0, 0], hiR: [0.3, 0, 0],
    } };
  },
  hit: (t) => {
    const k = 1 - smoothstep(0.2, 1, t);
    return { w: window01(t, 0, 1, 0.05), pose: {
      chest: [-0.45 * k, 0.2 * k, 0], neck: [-0.4 * k, 0, 0], shL: [-0.6 * k, 0, 0.8 * k], shR: [-0.6 * k, 0, -0.8 * k], elL: [-0.6, 0, 0], elR: [-0.6, 0, 0],
      hiL: [0.2, 0, 0], hiR: [-0.3, 0, 0], knR: [0.4, 0, 0],
    } };
  },
  roar: (t) => {
    const k = smoothstep(0, 0.25, t);
    const shake = Math.sin(t * 90) * 0.04 * k;
    return { w: window01(t, 0, 1, 0.1), pose: {
      chest: [-0.4 * k + shake, 0, 0], neck: [-0.5 * k, 0, 0], shL: [-0.8 * k, 0, 1.3 * k], shR: [-0.8 * k, 0, -1.3 * k], elL: [-1.2 * k, 0, 0], elR: [-1.2 * k, 0, 0],
      hiL: [0, 0, 0.25 * k], hiR: [0, 0, -0.25 * k], knL: [0.3, 0, 0], knR: [0.3, 0, 0],
    } };
  },
  throw: (t) => {
    const wind = smoothstep(0, 0.4, t), k = smoothstep(0.4, 0.55, t) * (1 - smoothstep(0.75, 1, t));
    return { w: window01(t, 0, 1, 0.1), pose: {
      shR: [lerp(-2.6 * wind, -1.2, k), 0, -0.2], elR: [lerp(-1.4 * wind, -0.1, k), 0, 0],
      chest: [lerp(-0.3 * wind, 0.4, k), lerp(0.6 * wind, -0.5, k), 0], shL: [-1.0, 0, 0.5], elL: [-0.5, 0, 0],
      hiL: [-0.5, 0, 0], knL: [0.3, 0, 0], hiR: [0.4, 0, 0],
    } };
  },
  eat: (t) => {
    const f = Math.max(0, Math.sin(t * Math.PI * 6));
    return { w: window01(t, 0, 1, 0.08), pose: {
      shR: [-1.4 - 0.4 * f, -0.6, -0.3], elR: [-2.2, 0, 0], neck: [0.1 * f, 0, 0], chest: [0.1, 0, 0], shL: [0, 0, 0.2],
    } };
  },
  victory: (t) => {
    const k = smoothstep(0, 0.2, t);
    return { w: window01(t, 0, 1, 0.08), bodyY: Math.sin(t * Math.PI) * 0.15, pose: {
      shR: [-3.0 * k, 0, -0.2], elR: [-0.3, 0, 0], shL: [0.2, 0, 0.6], elL: [-2.0, 0, 0], chest: [-0.2 * k, 0, 0], neck: [-0.2 * k, 0, 0],
    } };
  },
  dash: (t) => ({ w: window01(t, 0, 1, 0.12), pose: {
    chest: [0.5, 0, 0], shL: [1.1, 0, 0.3], shR: [1.1, 0, -0.3], elL: [-0.2, 0, 0], elR: [-0.2, 0, 0], hiL: [-0.9, 0, 0], knL: [0.6, 0, 0], hiR: [0.7, 0, 0], knR: [1.0, 0, 0],
  } }),
  block: (t) => ({ w: window01(t, 0, 1, 0.1), pose: {
    shL: [-1.3, 0.6, 0], shR: [-1.3, -0.6, 0], elL: [-1.4, 0, 0], elR: [-1.4, 0, 0], chest: [0.2, 0, 0], hiL: [-0.3, 0, 0], knL: [0.4, 0, 0], knR: [0.3, 0, 0],
  } }),
  kneel: (t) => {
    const k = smoothstep(0, 0.2, t);
    return { w: k, bodyY: -0.42 * k, pose: {
      hiL: [-1.5, 0, 0], knL: [1.5, 0, 0], hiR: [0.2, 0, 0], knR: [2.3, 0, 0], ftR: [0.6, 0, 0],
      chest: [0.5, 0, 0], neck: [0.5, 0, 0], shL: [-0.2, 0, 0.1], shR: [-0.5, 0, -0.2], elR: [-0.4, 0, 0],
    } };
  },
  wave: (t) => {
    const f = Math.sin(t * Math.PI * 8);
    return { w: window01(t, 0, 1, 0.1), pose: { shR: [-2.8, 0, -0.4 + f * 0.3], elR: [-0.5 + f * 0.3, 0, 0] } };
  },
  powerup: (t) => {
    const k = smoothstep(0, 0.3, t);
    const sh = Math.sin(t * 120) * 0.03 * k;
    return { w: window01(t, 0, 1, 0.06), bodyY: -0.1 * k, pose: {
      shL: [0.4, 0, 0.5 * k], shR: [0.4, 0, -0.5 * k], elL: [-1.6 * k, 0, 0], elR: [-1.6 * k, 0, 0],
      chest: [-0.2 * k + sh, 0, 0], neck: [-0.35 * k, 0, 0], hiL: [-0.2, 0, 0.3 * k], hiR: [-0.2, 0, -0.3 * k], knL: [0.5 * k, 0, 0], knR: [0.5 * k, 0, 0],
    } };
  },
};

export class Humanoid {
  root = new THREE.Group();
  j = {} as Record<J, THREE.Group>;
  look: RigLook;
  private cur = {} as Record<J, THREE.Euler>;
  private phase = 0;
  private time = Math.random() * 10;
  private mats: THREE.MeshToonMaterial[] = [];
  private flashT = 0;
  private flashColor = new THREE.Color();
  private tint: THREE.Color | null = null;
  hairMat!: THREE.MeshToonMaterial;
  skinMat!: THREE.MeshToonMaterial;
  armR!: THREE.Group;
  weaponR: THREE.Object3D | null = null;
  weaponL: THREE.Object3D | null = null;
  deadT = 0;
  private relax = 0;
  private sinceAction = 0;
  scale: number;
  private aura: THREE.Mesh | null = null;
  private faceOpts!: FaceOpts;
  private faceMat!: THREE.MeshToonMaterial;
  private exprCur: Expr = 'neutral';
  private blinkT = 2 + Math.random() * 3;
  /** Forces a facial expression (cutscenes); null lets the rig pick one from its state. */
  expr: Expr | null = null;

  constructor(look: RigLook) {
    this.look = look;
    this.scale = look.height ?? 1;
    this.build();
    this.root.scale.setScalar(this.scale);
  }

  private mat(color: string | number, skin = false) {
    const m = new THREE.MeshToonMaterial({ color: new THREE.Color(color as any), gradientMap: skin ? skinGradient() : clothGradient() });
    rimLight(m);
    this.mats.push(m);
    return m;
  }
  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0, outline = true) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    if (outline && this.look.outline) m.add(new THREE.Mesh(geo, charOutlineMat));
    return m;
  }

  private build() {
    const L = this.look;
    const b = L.build ?? 1;
    const sb = Math.sqrt(b);
    const belly = L.belly ?? 0;
    const bl = belly * 0.07, bl2 = belly * 0.1;
    const skin = this.mat(L.skin, true), shirt = this.mat(L.shirt), pants = this.mat(L.pants), shoes = this.mat(L.shoes ?? 0x3a2a1e);
    this.skinMat = skin;
    const hairM = this.mat(L.hair);
    this.hairMat = hairM;
    const g = (name: J, parent: THREE.Object3D, x: number, y: number, z: number) => {
      const n = new THREE.Group();
      n.position.set(x, y, z);
      parent.add(n);
      this.j[name] = n;
      this.cur[name] = new THREE.Euler();
      return n;
    };
    const body = g('body', this.root, 0, 0, 0);
    const hips = g('hips', body, 0, 0.95, 0);
    const spine = g('spine', hips, 0, 0.06, 0);
    const chest = g('chest', spine, 0, 0.32, 0);
    const neck = g('neck', chest, 0, 0.2, 0);
    const head = g('head', neck, 0, 0.06, 0);

    const bare = !!L.vest;
    const torsoMat = bare ? skin : shirt;
    const shorts = bare || L.hat === 'straw';
    const sandals = L.hat === 'straw';

    // Pelvis and torso: smooth elliptical shells (slim waist, broad chest).
    this.mesh(shell([[-0.17, 0.04 * b, 0.035 * b], [-0.14, 0.12 * b, 0.1 * b], [-0.07, 0.172 * b + bl, 0.13 * b + bl2], [0, 0.182 * b + bl, 0.138 * b + bl2], [0.07, 0.176 * b + bl, 0.135 * b + bl2], [0.12, 0.165 * b + bl, 0.128 * b + bl2]]), pants, hips);
    this.mesh(shell([[-0.08, 0.17 * b + bl, 0.132 * b + bl2], [0.02, 0.162 * b + bl * 1.4, 0.128 * b + bl2 * 1.5], [0.12, 0.158 * b + bl * 1.2, 0.13 * b + bl2 * 1.3], [0.22, 0.17 * b + bl * 0.5, 0.132 * b + bl2 * 0.5], [0.3, 0.18 * b, 0.136 * b]]), torsoMat, spine);
    this.mesh(shell([[-0.16, 0.17 * b, 0.132 * b], [-0.06, 0.19 * b, 0.142 * b], [0.03, 0.214 * b, 0.146 * b], [0.1, 0.224 * b, 0.14 * b], [0.15, 0.2 * b, 0.12 * b], [0.19, 0.13 * b, 0.092 * b], [0.22, 0.07, 0.064]]), torsoMat, chest);
    if (bare) {
      for (const s of [-1, 1]) {
        const pec = this.mesh(new THREE.SphereGeometry(0.085 * b, 12, 8), skin, chest, s * 0.085 * b, 0.045, 0.1 * b, false);
        pec.scale.set(1.05, 0.6, 0.32);
      }
      // Open sleeveless vest with buttons.
      const vm = this.mat(L.shirt);
      vm.side = THREE.DoubleSide;
      const prof: [number, number, number][] = [[-0.37, 0.184 * b + bl, 0.148 * b + bl2], [-0.26, 0.178 * b + bl * 1.3, 0.144 * b + bl2 * 1.4], [-0.15, 0.184 * b, 0.15 * b], [-0.06, 0.204 * b, 0.158 * b], [0.03, 0.228 * b, 0.162 * b], [0.1, 0.238 * b, 0.156 * b], [0.15, 0.214 * b, 0.136 * b], [0.19, 0.144 * b, 0.104 * b], [0.215, 0.088, 0.078]];
      const gap = (y: number) => 0.32 + clamp((y + 0.37) / 0.55, 0, 1) * 0.62;
      const vest = this.mesh(shell(prof, gap, 32), vm, chest);
      vest.castShadow = true;
      const btn = this.mat(0xe9c46a);
      for (const y of [-0.27, -0.16, -0.05]) {
        const a = -(gap(y) + 0.1);
        const pr = prof.find((p) => p[0] >= y) ?? prof[0];
        this.mesh(new THREE.SphereGeometry(0.014, 6, 5), btn, chest, Math.sin(a) * pr[1] * 1.03, y, Math.cos(a) * pr[2] * 1.03, false);
      }
    } else if (!L.armor) {
      // Collar and a shirt hem hanging over the waistband.
      const cm = this.mat(new THREE.Color(L.shirt as any).multiplyScalar(0.82).getHex());
      cm.side = THREE.DoubleSide;
      this.mesh(shell([[0.165, 0.16 * b, 0.118 * b], [0.2, 0.12 * b, 0.1 * b], [0.25, 0.085, 0.08]], () => 0.45, 20), cm, chest, 0, 0, 0, false);
      const hem = this.mat(L.shirt);
      hem.side = THREE.DoubleSide;
      this.mesh(shell([[-0.12, 0.195 * b + bl, 0.158 * b + bl2], [-0.02, 0.18 * b + bl, 0.142 * b + bl2], [0.04, 0.172 * b + bl, 0.136 * b + bl2]]), hem, spine, 0, 0, 0, false);
    }
    if (L.sash) {
      const sm = this.mat(L.sash);
      sm.side = THREE.DoubleSide;
      this.mesh(shell([[-0.05, 0.19 * b + bl, 0.152 * b + bl2], [0.05, 0.186 * b + bl, 0.148 * b + bl2]]), sm, spine, 0, 0, 0, false);
      this.mesh(new THREE.SphereGeometry(0.04, 8, 6), sm, spine, 0.15 * b + bl, -0.01, 0.09 * b, false);
      for (const t of [-1, 1]) {
        const tail = this.mesh(new THREE.BoxGeometry(0.05, 0.2, 0.014), sm, spine, 0.16 * b + bl + t * 0.02, -0.11, 0.09 * b, false);
        tail.rotation.set(0.12, -0.5, t * 0.12);
      }
    } else if (!bare) {
      const belt = this.mat(0x3a2414);
      belt.side = THREE.DoubleSide;
      this.mesh(shell([[-0.035, 0.188 * b + bl, 0.15 * b + bl2], [0.035, 0.186 * b + bl, 0.148 * b + bl2]]), belt, spine, 0, 0, 0, false);
      this.mesh(new THREE.BoxGeometry(0.07, 0.06, 0.02), this.mat(0xd8b04a), spine, 0, 0, 0.15 * b + bl2, false);
    }
    if (L.armor) {
      const am = this.mat(L.armor);
      for (const s of [-1, 1]) {
        const pad = this.mesh(new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), am, chest, s * 0.26 * b, 0.08, 0);
        pad.scale.set(1.2, 0.9, 1.1);
        pad.rotation.z = -s * 0.5;
      }
      const plate = this.mesh(shell([[-0.14, 0.2 * b, 0.158 * b], [-0.02, 0.222 * b, 0.168 * b], [0.1, 0.236 * b, 0.16 * b], [0.16, 0.21 * b, 0.138 * b]], () => 1.75, 20), am, chest);
      plate.rotation.y = Math.PI;
    }
    if (L.cape) {
      const cm = new THREE.MeshToonMaterial({ color: new THREE.Color(L.cape as any), gradientMap: clothGradient(), side: THREE.DoubleSide });
      this.mats.push(cm);
      const cape = new THREE.Mesh(shell([[-1.05, 0.36 * b, 0.33 * b], [-0.6, 0.31 * b, 0.27 * b], [-0.2, 0.27 * b, 0.2 * b], [0.08, 0.275 * b, 0.17 * b], [0.16, 0.23 * b, 0.145 * b], [0.21, 0.15 * b, 0.11 * b]], (y) => 0.75 + clamp(-y, 0, 1) * 0.25, 30), cm);
      cape.castShadow = true;
      cape.name = 'cape';
      chest.add(cape);
    }

    // Neck and head.
    this.mesh(new THREE.CylinderGeometry(0.052 * sb, 0.06 * sb, 0.14, 10), skin, neck, 0, 0.01, 0, false);
    const style = L.face ?? (L.build && L.build >= 1.4 || belly > 0.3 ? 'brute' : L.beard && L.hairStyle === 'bald' ? 'elder' : 'grunt');
    const jaw = { hero: 1, fem: 1.05, grunt: 0.8, brute: 0.4, elder: 0.7 }[style];
    const R = 0.19;
    const hp = new THREE.Group();
    hp.position.set(0, 0.155, 0);
    hp.scale.set(1, 1.06, 1);
    head.add(hp);
    // Slightly oversized heads read better at gameplay distance (anime proportions).
    head.scale.setScalar(style === 'brute' ? 1.04 : 1.12);
    this.mesh(headGeometry(R, jaw), skin, hp);
    const hairHex = '#' + new THREE.Color(L.hair as any).getHexString();
    this.faceOpts = {
      style, iris: L.iris ?? (style === 'hero' ? '#5a3a24' : '#3a2a20'), brow: '#' + new THREE.Color(hairHex).multiplyScalar(0.75).getHexString(),
      skin: '#' + new THREE.Color(L.skin as any).getHexString(), scar: !!L.scar, glow: L.eyeGlow ? '#' + new THREE.Color(L.eyeGlow).getHexString() : null,
    };
    this.faceMat = new THREE.MeshToonMaterial({ gradientMap: skinGradient(), transparent: true, alphaTest: 0.3, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    rimLight(this.faceMat);
    this.paintFace();
    const face = new THREE.Mesh(faceGeometry(R, jaw), this.faceMat);
    face.renderOrder = 1;
    hp.add(face);
    for (const s of [-1, 1]) {
      const ep = headPoint(1.62, s * 1.5, R, jaw);
      const ear = this.mesh(new THREE.SphereGeometry(0.042, 8, 6), skin, hp, ep.x * 0.97, ep.y, ep.z - 0.005);
      ear.scale.set(0.45, 0.85, 0.62);
    }
    const covered = L.hat !== 'none' && L.hat !== 'straw' && L.hat !== 'tricorn' && L.hat !== 'crown' && L.hat !== 'navy';
    const hair = hairGeometry(covered ? 'bald' : L.hairStyle, R, jaw, L.hat !== 'none');
    if (hair.cap.attributes.position) this.mesh(hair.cap, hairM, hp);
    if (hair.clumps) this.mesh(hair.clumps, hairM, hp);
    if (L.beard) this.mesh(beardGeometry(R, jaw, b > 1.2), this.mat(L.beard), hp);
    this.buildHat(head);

    // Arms.
    const arm = (side: 1 | -1) => {
      const sh = g(side === 1 ? 'shL' : 'shR', chest, side * 0.25 * b, 0.07, 0);
      // The upper arm's rounded top doubles as the deltoid, tucked into the torso.
      this.mesh(limb(0.067 * sb, 0.058 * sb, 0.2, 0.4, 0.008 * sb), torsoMat, sh, -side * 0.006, -0.125, 0);
      if (!bare && !L.armor) this.mesh(new THREE.CylinderGeometry(0.074 * sb, 0.078 * sb, 0.05, 12), shirt, sh, 0, -0.2, 0, false);
      const el = g(side === 1 ? 'elL' : 'elR', sh, 0, -0.29, 0);
      this.mesh(limb(0.06 * sb, 0.045 * sb, 0.19, 0.22, 0.008 * sb), skin, el, 0, -0.13, 0);
      const ha = g(side === 1 ? 'haL' : 'haR', el, 0, -0.28, 0);
      this.mesh(fistGeometry(1.05 * sb, side), skin, ha, 0, 0, 0);
      return sh;
    };
    arm(1);
    this.armR = arm(-1);
    // Legs.
    const leg = (side: 1 | -1) => {
      const hi = g(side === 1 ? 'hiL' : 'hiR', hips, side * 0.1 * b, -0.02, 0);
      this.mesh(limb(0.096 * sb, 0.076 * sb, 0.27, 0.3, 0.006 * sb), pants, hi, 0, -0.21, 0);
      const kn = g(side === 1 ? 'knL' : 'knR', hi, 0, -0.44, 0);
      if (shorts) {
        this.mesh(new THREE.CylinderGeometry(0.1 * sb, 0.106 * sb, 0.08, 12), pants, kn, 0, 0.01, 0);
        this.mesh(limb(0.064 * sb, 0.046 * sb, 0.27, 0.3, 0.014 * sb), skin, kn, 0, -0.2, 0);
      } else {
        this.mesh(limb(0.078 * sb, 0.07 * sb, 0.27, 0.3, 0.005 * sb), pants, kn, 0, -0.2, 0);
        this.mesh(new THREE.CylinderGeometry(0.08 * sb, 0.072 * sb, 0.2, 12), shoes, kn, 0, -0.33, 0);
      }
      const ft = g(side === 1 ? 'ftL' : 'ftR', kn, 0, -0.43, 0);
      if (sandals) {
        // Bare foot: rounded heel, raised instep and toes on an oval straw sandal with a thong strap.
        const foot = this.mesh(new THREE.SphereGeometry(1, 16, 12), skin, ft, 0, -0.03, 0.05);
        foot.scale.set(0.044, 0.042, 0.105);
        foot.rotation.x = 0.12;
        const heel = this.mesh(new THREE.SphereGeometry(0.036, 10, 8), skin, ft, 0, -0.04, -0.02, false);
        heel.scale.set(1, 0.9, 1.1);
        for (let i = 0; i < 5; i++) {
          const toe = this.mesh(new THREE.SphereGeometry(1, 8, 6), skin, ft, side * (0.026 - i * 0.0125), -0.052, 0.142 - i * i * 0.0022, false);
          toe.scale.setScalar(i === 0 ? 0.016 : 0.0115 - i * 0.0006);
        }
        const sole = this.mesh(new THREE.CylinderGeometry(1, 1, 1, 18), shoes, ft, side * 0.002, -0.068, 0.058);
        sole.scale.set(0.056, 0.016, 0.135);
        const strapM = this.mat(0x6a3a1c);
        for (const sx of [-1, 1]) {
          const strap = this.mesh(new THREE.BoxGeometry(0.01, 0.01, 0.085), strapM, ft, sx * 0.024, -0.03, 0.095, false);
          strap.rotation.set(0.35, sx * 0.5, 0);
        }
      } else {
        const boot = this.mesh(capsule(0.058 * sb, 0.12), shoes, ft, 0, -0.025, 0.055);
        boot.rotation.x = Math.PI / 2;
        this.mesh(new THREE.BoxGeometry(0.125 * sb, 0.028, 0.26), this.mat(0x1e140e), ft, 0, -0.068, 0.055, false);
      }
    };
    leg(1);
    leg(-1);
    this.attachWeapons();
  }

  /** (Re)paint the face atlas, e.g. when the eyes start to glow on awakening. */
  private paintFace() {
    const f = faceAtlas(this.faceOpts);
    this.faceMat.map?.dispose();
    this.faceMat.emissiveMap?.dispose();
    this.faceMat.map = atlasView(f.map);
    if (f.emissive) {
      this.faceMat.emissiveMap = atlasView(f.emissive);
      this.faceMat.emissive.set(this.faceOpts.glow!).multiplyScalar(1.6);
    } else {
      this.faceMat.emissiveMap = null;
      this.faceMat.emissive.setRGB(0, 0, 0);
    }
    this.faceMat.needsUpdate = true;
    this.setExpr(this.exprCur);
  }

  private setExpr(e: Expr) {
    this.exprCur = e;
    setAtlasCell(this.faceMat.map!, EXPR[e]);
    if (this.faceMat.emissiveMap) setAtlasCell(this.faceMat.emissiveMap, EXPR[e]);
  }

  private buildHat(head: THREE.Group) {
    const L = this.look;
    const hc = L.hatColor ?? 0xe9c46a;
    switch (L.hat) {
      case 'straw': {
        const m = this.mat(hc);
        m.map = strawTexture();
        const brim = this.mesh(new THREE.CylinderGeometry(0.4, 0.42, 0.025, 24), m, head, 0, 0.31, 0);
        brim.rotation.x = -0.12;
        const crown = this.mesh(new THREE.CylinderGeometry(0.19, 0.21, 0.14, 18), m, head, 0, 0.39, -0.01);
        crown.rotation.x = -0.12;
        const band = this.mesh(new THREE.CylinderGeometry(0.213, 0.215, 0.045, 18), this.mat(0xc8282b), head, 0, 0.345, -0.005, false);
        band.rotation.x = -0.12;
        break;
      }
      case 'bandana': {
        const m = this.mat(hc);
        const c = this.mesh(new THREE.SphereGeometry(0.218, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), m, head, 0, 0.19, -0.01);
        c.scale.set(1.04, 1.0, 1.06);
        for (const s of [-1, 1]) {
          const tail = this.mesh(new THREE.BoxGeometry(0.05, 0.16, 0.02), m, head, s * 0.04, 0.14, -0.21);
          tail.rotation.set(0.3, 0, s * 0.3);
        }
        break;
      }
      case 'tricorn': {
        const m = this.mat(hc);
        const brim = this.mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.04, 3), m, head, 0, 0.33, 0);
        brim.rotation.y = Math.PI / 6 + Math.PI;
        this.mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.16, 14), m, head, 0, 0.42, 0);
        this.mesh(new THREE.SphereGeometry(0.026, 8, 6), this.mat(0xf2ede4), head, 0, 0.43, 0.185, false);
        break;
      }
      case 'helmet':
      case 'horns': {
        const m = this.mat(L.hat === 'horns' ? 0x3a3a3a : hc);
        const c = this.mesh(new THREE.SphereGeometry(0.232, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), m, head, 0, 0.18, 0);
        c.scale.set(1.02, 1.05, 1.05);
        if (L.hat === 'horns') for (const s of [-1, 1]) {
          const h = this.mesh(new THREE.ConeGeometry(0.06, 0.35, 8), this.mat(0xe8dcc0), head, s * 0.2, 0.42, 0);
          h.rotation.z = -s * 0.6;
        }
        break;
      }
      case 'navy': {
        const m = this.mat(0xf4f4f4);
        this.mesh(new THREE.CylinderGeometry(0.21, 0.2, 0.12, 16), m, head, 0, 0.36, 0);
        const v = this.mesh(new THREE.BoxGeometry(0.26, 0.02, 0.14), this.mat(0x1a2a5a), head, 0, 0.31, 0.18);
        v.rotation.x = 0.2;
        this.mesh(new THREE.CylinderGeometry(0.212, 0.212, 0.03, 16), this.mat(0x1a2a5a), head, 0, 0.32, 0, false);
        break;
      }
      case 'turban': {
        const m = this.mat(hc);
        const t = this.mesh(new THREE.TorusGeometry(0.17, 0.07, 8, 16), m, head, 0, 0.32, 0);
        t.rotation.x = Math.PI / 2;
        this.mesh(new THREE.SphereGeometry(0.17, 12, 8), m, head, 0, 0.36, 0);
        this.mesh(new THREE.SphereGeometry(0.04, 8, 6), this.mat(0x2ad1c4), head, 0, 0.35, 0.22, false);
        break;
      }
      case 'crown': {
        const m = new THREE.MeshToonMaterial({ color: 0xffd54a, emissive: 0x6a4a00, gradientMap: clothGradient() });
        this.mats.push(m);
        this.mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 16, 1, true), m, head, 0, 0.36, 0);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          this.mesh(new THREE.ConeGeometry(0.03, 0.1, 4), m, head, Math.cos(a) * 0.2, 0.44, Math.sin(a) * 0.2, false);
        }
        break;
      }
      case 'hood': {
        const m = this.mat(hc);
        const c = this.mesh(new THREE.SphereGeometry(0.25, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), m, head, 0, 0.15, -0.03);
        c.scale.set(1, 1.1, 1.1);
        break;
      }
    }
  }

  private weapon(kind: Weapon, color: number): THREE.Object3D {
    const g = new THREE.Group();
    const sc = new THREE.Color(color), lum = sc.r * 0.3 + sc.g * 0.59 + sc.b * 0.11;
    if (lum > 0.42) sc.multiplyScalar(0.42 / lum);
    const steel = this.mat(sc.getHex());
    const edge = this.mat(new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.55).getHex());
    const dark = this.mat(0x2a1a12);
    const wrap = this.mat(0x3a2418);
    const gold = this.mat(0xd8b04a);
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
      const me = this.mesh(geo, m, g, x, y, z, false);
      me.rotation.set(rx, ry, rz);
      return me;
    };
    // Blade from a 2D outline in the y/z plane (spine along -y, edge toward +z), thin in x.
    const blade = (pts: [number, number][], thick: number) => {
      const sh = new THREE.Shape();
      sh.moveTo(pts[0][1], pts[0][0]);
      for (const [y, z] of pts.slice(1)) sh.lineTo(z, y);
      const geo = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.4, bevelSize: thick * 0.35, bevelSegments: 1, steps: 1 });
      geo.translate(0, 0, -thick / 2);
      geo.rotateY(-Math.PI / 2); // shape x -> world z, extrude -> world x
      return geo;
    };
    const curve = (len: number, w0: number, w1: number, bend: number, n = 10, tipBack = 0.12) => {
      const top: [number, number][] = [], bot: [number, number][] = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n, y = -t * len, c = bend * t * t;
        const w = w0 + (w1 - w0) * t;
        top.push([y, c - w * 0.15]);
        bot.push([y, c + w * (i === n ? 0 : 1)]);
      }
      top[n] = [-len - tipBack * w1, bend + w1 * 0.4];
      return [...top, ...bot.reverse()] as [number, number][];
    };
    const grip = (len: number, r: number, y0: number) => {
      add(new THREE.CylinderGeometry(r, r * 1.05, len, 8), wrap, 0, y0, 0);
      for (let i = 0; i < 4; i++) add(new THREE.TorusGeometry(r * 1.02, r * 0.28, 4, 8), dark, 0, y0 - len / 2 + (i + 0.5) * (len / 4), 0, Math.PI / 2);
    };
    switch (kind) {
      case 'cutlass': {
        grip(0.13, 0.02, 0.02);
        add(new THREE.SphereGeometry(0.03, 8, 6), gold, 0, 0.1, 0);
        const guard = add(new THREE.TorusGeometry(0.075, 0.012, 5, 12, Math.PI * 1.2), gold, 0, 0.0, 0.03, 0, Math.PI / 2, -0.4);
        guard.scale.set(1, 1.2, 1);
        add(new THREE.BoxGeometry(0.03, 0.025, 0.13), gold, 0, -0.06, 0.03);
        add(blade(curve(0.66, 0.05, 0.075, 0.07), 0.012), steel, 0, -0.07, 0.0);
        break;
      }
      case 'katana':
      case 'katana3': {
        grip(0.24, 0.018, 0.04);
        add(new THREE.CylinderGeometry(0.02, 0.02, 0.02, 8), gold, 0, 0.17, 0);
        add(new THREE.CylinderGeometry(0.048, 0.048, 0.012, 12), gold, 0, -0.09, 0.01);
        add(new THREE.BoxGeometry(0.024, 0.04, 0.032), gold, 0, -0.115, 0.012);
        add(blade(curve(0.9, 0.032, 0.03, 0.05, 12, 0.6), 0.009), steel, 0, -0.12, 0);
        add(new THREE.BoxGeometry(0.004, 0.8, 0.008), edge, 0.0, -0.53, 0.028);
        break;
      }
      case 'musket': {
        add(new THREE.CylinderGeometry(0.022, 0.026, 1.0, 8), this.mat(0x3a3a40), 0, 0.02, 0.5, Math.PI / 2);
        for (const z of [0.25, 0.55, 0.85]) add(new THREE.TorusGeometry(0.03, 0.008, 4, 10), gold, 0, 0.02, z);
        const stock = new THREE.Shape();
        stock.moveTo(-0.32, 0.02); stock.lineTo(0.6, 0.02); stock.lineTo(0.6, -0.03); stock.lineTo(0.0, -0.04); stock.lineTo(-0.2, -0.13); stock.lineTo(-0.42, -0.16); stock.lineTo(-0.44, 0.0); stock.lineTo(-0.32, 0.02);
        const sg = new THREE.ExtrudeGeometry(stock, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 1 });
        sg.translate(0, 0, -0.025); sg.rotateY(-Math.PI / 2);
        add(sg, this.mat(0x6a4a2a), 0, 0, 0);
        add(new THREE.BoxGeometry(0.02, 0.05, 0.06), this.mat(0x3a3a40), 0, 0.05, -0.02);
        break;
      }
      case 'anchor': {
        add(new THREE.CylinderGeometry(0.055, 0.065, 1.55, 10), steel, 0, -0.72, 0);
        add(new THREE.TorusGeometry(0.11, 0.03, 6, 14), steel, 0, 0.14, 0);
        const stockBar = add(new THREE.CylinderGeometry(0.045, 0.045, 0.8, 8), dark, 0, -0.08, 0, Math.PI / 2, 0, 0);
        for (const sx of [-1, 1]) add(new THREE.SphereGeometry(0.06, 8, 6), dark, 0, -0.08, sx * 0.41);
        stockBar.castShadow = true;
        // Crown: arms curve up to broad flukes.
        const arm = add(new THREE.TorusGeometry(0.48, 0.06, 8, 20, Math.PI), steel, 0, -1.08, 0, 0, 0, Math.PI);
        arm.scale.set(1, 0.8, 1);
        add(new THREE.SphereGeometry(0.1, 10, 8), steel, 0, -1.47, 0);
        for (const sx of [-1, 1]) {
          const fl = add(new THREE.ConeGeometry(0.16, 0.36, 4), steel, sx * 0.5, -1.0, 0, 0, Math.PI / 4, -sx * 0.35);
          fl.scale.set(1, 1, 0.35);
        }
        break;
      }
      case 'kanabo': {
        grip(0.42, 0.045, 0.02);
        add(new THREE.CylinderGeometry(0.2, 0.1, 1.45, 10), steel, 0, -0.93, 0);
        add(new THREE.CylinderGeometry(0.205, 0.205, 0.05, 10), dark, 0, -1.66, 0);
        for (let r = 0; r < 4; r++) for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2 + r * 0.45, y = -0.55 - r * 0.32;
          const rad = 0.12 + (0.08 * (-y - 0.2)) / 1.45;
          const spike = add(new THREE.ConeGeometry(0.035, 0.11, 5), edge, Math.cos(a) * rad, y, Math.sin(a) * rad);
          spike.lookAt(Math.cos(a) * 2, y, Math.sin(a) * 2);
          spike.rotateX(Math.PI / 2);
        }
        break;
      }
      case 'axe': {
        grip(0.5, 0.035, -0.2);
        add(new THREE.CylinderGeometry(0.035, 0.04, 0.85, 8), dark, 0, -0.8, 0);
        const head: [number, number][] = [[-0.85, 0.02], [-0.8, 0.12], [-0.7, 0.28], [-0.82, 0.4], [-1.02, 0.44], [-1.22, 0.4], [-1.32, 0.28], [-1.22, 0.12], [-1.17, 0.02]];
        add(blade(head, 0.04), steel, 0, 0, 0);
        add(new THREE.BoxGeometry(0.06, 0.34, 0.1), dark, 0, -1.02, 0);
        add(new THREE.ConeGeometry(0.05, 0.18, 4), steel, 0, -1.02, -0.13, -Math.PI / 2);
        break;
      }
      case 'scimitar2': {
        grip(0.12, 0.02, 0.02);
        add(new THREE.SphereGeometry(0.028, 8, 6), gold, 0, 0.09, 0);
        add(new THREE.BoxGeometry(0.03, 0.025, 0.16), gold, 0, -0.05, 0.02);
        add(blade(curve(0.58, 0.045, 0.11, 0.16), 0.012), steel, 0, -0.06, 0);
        break;
      }
      case 'spear': {
        add(new THREE.CylinderGeometry(0.028, 0.028, 2.4, 8), this.mat(0x8a5a32), 0, -0.2, 0);
        add(blade([[-1.38, 0], [-1.48, 0.06], [-1.85, 0], [-1.48, -0.06]], 0.02), steel, 0, 0, 0);
        add(new THREE.CylinderGeometry(0.04, 0.035, 0.08, 8), gold, 0, -1.38, 0);
        for (let i = 0; i < 5; i++) add(new THREE.ConeGeometry(0.02, 0.18, 4), this.mat(0xc8282b), Math.cos(i) * 0.03, -1.27, Math.sin(i) * 0.03, Math.PI);
        add(new THREE.ConeGeometry(0.04, 0.12, 6), gold, 0, 1.04, 0);
        break;
      }
      case 'staff': {
        add(new THREE.CylinderGeometry(0.028, 0.034, 1.8, 8), dark, 0, -0.3, 0);
        for (const y of [0.45, -0.95]) add(new THREE.TorusGeometry(0.036, 0.01, 4, 10), gold, 0, y, 0, Math.PI / 2);
        add(new THREE.TorusGeometry(0.15, 0.015, 6, 16), gold, 0, 0.66, 0);
        add(new THREE.SphereGeometry(0.11, 14, 10), new THREE.MeshBasicMaterial({ color, toneMapped: false }), 0, 0.66, 0);
        break;
      }
    }
    return g;
  }

  /** Big weapons rest on the shoulder; spears and staffs stand upright; blades hang low. */
  private carry(): 'blade' | 'heavy' | 'pole' | 'gun' | 'none' {
    const w = this.look.weapon ?? 'none';
    if (w === 'anchor' || w === 'kanabo' || w === 'axe') return 'heavy';
    if (w === 'spear' || w === 'staff') return 'pole';
    if (w === 'musket') return 'gun';
    return w === 'none' ? 'none' : 'blade';
  }

  private attachWeapons() {
    const w = this.look.weapon ?? 'none';
    if (w === 'none') return;
    const col = this.look.weaponColor ?? 0xd8dde4;
    this.weaponR = this.weapon(w, col);
    this.weaponR.position.set(0, -0.04, 0.02);
    this.weaponR.rotation.x = -Math.PI / 2 + 0.1;
    this.j.haR.add(this.weaponR);
    if (w === 'musket') this.weaponR.rotation.set(0, 0, 0);
    if (w === 'katana3' || w === 'scimitar2') {
      this.weaponL = this.weapon(w, col);
      this.weaponL.position.set(0, -0.04, 0.02);
      this.weaponL.rotation.x = -Math.PI / 2 + 0.1;
      this.j.haL.add(this.weaponL);
    }
    if (w === 'katana3') {
      // Third sword sheathed at the hip.
      const sheath = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 0.06), this.mat(0x1a1a1a));
      sheath.position.set(0.22, 0, -0.06);
      sheath.rotation.set(0.5, 0, 0.3);
      this.j.hips.add(sheath);
    }
  }

  /** Blend each held weapon between its fighting grip and its relaxed carry. */
  private poseWeapons(k: number) {
    const c = this.carry();
    const fight = c === 'gun' ? 0 : -Math.PI / 2 + 0.1;
    const rest = c === 'blade' ? -0.95 : c === 'heavy' ? 0.55 : c === 'pole' ? Math.PI : c === 'gun' ? 0.7 : fight;
    for (const [wpn, side] of [[this.weaponR, 1], [this.weaponL, -1]] as const) {
      if (!wpn) continue;
      wpn.rotation.x = lerp(fight, rest, k);
      wpn.rotation.z = (c === 'blade' ? 0.22 : c === 'heavy' ? -0.55 : 0) * k * side;
      wpn.position.y = -0.04 + (c === 'pole' ? -0.55 : 0) * k;
    }
  }

  flash(color = 0xffffff, dur = 0.12) {
    this.flashT = dur;
    this.flashColor.setHex(color).multiplyScalar(0.5);
  }
  setTint(c: number | null) { this.tint = c === null ? null : new THREE.Color(c); this.applyEmissive(); }
  private applyEmissive() {
    for (const m of this.mats) {
      if (this.flashT > 0) m.emissive.copy(this.flashColor);
      else if (this.tint) m.emissive.copy(this.tint);
      else m.emissive.setRGB(0, 0, 0);
    }
  }

  setHairColor(c: number) { this.hairMat.color.setHex(c); }
  setEyeGlow(c: number) { this.faceOpts = { ...this.faceOpts, glow: '#' + new THREE.Color(c).getHexString() }; this.paintFace(); }

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

  worldPos(joint: J, out = new THREE.Vector3()) { return this.j[joint].getWorldPosition(out); }

  update(dt: number, s: AnimInput) {
    this.time += dt;
    const t = this.time;
    if (this.flashT > 0) { this.flashT -= dt; this.applyEmissive(); if (this.flashT <= 0) this.applyEmissive(); }
    if (this.aura) {
      this.aura.scale.set(1 + Math.sin(t * 7) * 0.05, 1.6 + Math.sin(t * 5) * 0.08, 1 + Math.sin(t * 7) * 0.05);
    }

    const target: Record<string, [number, number, number]> = {};
    for (const k of JOINTS) target[k] = [0, 0, 0];
    let bodyY = 0;
    let spin = 0;

    if (s.dead) {
      this.deadT = Math.min(1, this.deadT + dt * 2.5);
      const k = easeOutCubic(this.deadT);
      target.hips = [-1.45 * k, 0, 0];
      target.shL = [-0.4, 0, 1.3 * k]; target.shR = [-0.4, 0, -1.3 * k];
      target.hiL = [0.2, 0, 0.2]; target.hiR = [0.1, 0, -0.15]; target.knL = [0.5 * k, 0, 0];
      target.neck = [-0.3 * k, 0.4 * k, 0];
      bodyY = -0.8 * k;
      if (this.exprCur !== 'ko') this.setExpr('ko');
      this.apply(target, bodyY, 0, dt, 14);
      return;
    }
    this.deadT = 0;

    const spd = s.speed;
    const moveK = clamp(spd / 7, 0, 1.4);
    if (s.grounded) {
      this.phase += dt * (spd > 0.2 ? 3.2 + spd * 0.9 : 0);
      const ph = this.phase;
      const A = Math.min(1, moveK) * 0.85;
      const run = clamp((spd - 5) / 4, 0, 1);
      target.hiL = [-Math.sin(ph) * A, 0, 0];
      target.hiR = [Math.sin(ph) * A, 0, 0];
      target.knL = [Math.max(0, Math.sin(ph - 1.2)) * A * 1.7 + 0.05, 0, 0];
      target.knR = [Math.max(0, Math.sin(ph + Math.PI - 1.2)) * A * 1.7 + 0.05, 0, 0];
      target.ftL = [Math.max(0, -Math.sin(ph)) * 0.3 * A, 0, 0];
      target.ftR = [Math.max(0, Math.sin(ph)) * 0.3 * A, 0, 0];
      target.shL = [Math.sin(ph) * A * (0.8 + run * 0.4), 0, 0.1];
      target.shR = [-Math.sin(ph) * A * (0.8 + run * 0.4), 0, -0.1];
      target.elL = [-0.25 - A * 0.5 - run * 0.6, 0, 0];
      target.elR = [-0.25 - A * 0.5 - run * 0.6, 0, 0];
      target.spine = [0.06 * moveK + run * 0.12, Math.sin(ph) * 0.12 * A, 0];
      target.chest = [Math.sin(t * 2.1) * 0.025 * (1 - A), -Math.sin(ph) * 0.15 * A, 0];
      target.hips = [0, Math.sin(ph) * 0.12 * A, s.turn ? clamp(-s.turn * 0.1, -0.2, 0.2) : 0];
      target.head = [0, 0, 0];
      bodyY = Math.abs(Math.sin(ph)) * 0.07 * A - 0.02 * A;
      if (spd < 0.2) {
        // Relaxed stance: weight on one leg, soft elbows, slow breathing and a wandering gaze.
        const sway = Math.sin(t * 0.55);
        target.hips = [0, 0.04 * sway, 0.035 + 0.015 * sway];
        target.hiL = [-0.05, 0, 0.06]; target.knL = [0.16, 0, 0];
        target.hiR = [0.03, 0, -0.03]; target.knR = [0.04, 0, 0];
        target.spine = [0.02, 0, -0.03];
        target.chest = [Math.sin(t * 2.1) * 0.03, -0.04 * sway, 0];
        target.shL = [0.08, 0, 0.16 + Math.sin(t * 2.1) * 0.02];
        target.shR = [0.08, 0, -0.16 - Math.sin(t * 2.1) * 0.02];
        target.elL = [-0.32, 0, 0]; target.elR = [-0.32, 0, 0];
        target.neck = [Math.sin(t * 0.7) * 0.04, Math.sin(t * 0.4) * 0.18, 0];
        bodyY = Math.sin(t * 2.1) * 0.008 - 0.01;
      }
    } else {
      const up = s.vy > 0 ? 1 : 0;
      target.hiL = [-0.9 + up * 0.3, 0, 0.05]; target.knL = [1.3, 0, 0];
      target.hiR = [-0.2 - up * 0.2, 0, -0.05]; target.knR = [0.7, 0, 0];
      target.shL = [-0.4, 0, 0.9 + up * 0.4]; target.shR = [-0.4, 0, -0.9 - up * 0.4];
      target.elL = [-0.6, 0, 0]; target.elR = [-0.6, 0, 0];
      target.spine = [0.1, 0, 0];
    }
    if (s.steer !== undefined && s.steer !== null) {
      target.shL = [-1.15, 0, -0.15 + s.steer * 0.25]; target.shR = [-1.15, 0, 0.15 + s.steer * 0.25];
      target.elL = [-0.7, 0, 0]; target.elR = [-0.7, 0, 0];
      target.chest = [0.12, s.steer * 0.2, 0];
      target.hiL = [-0.2, 0, 0.05]; target.hiR = [0.15, 0, -0.05];
    }
    if (s.stun) {
      target.chest = [-0.25, Math.sin(t * 8) * 0.2, 0];
      target.neck = [0.3, Math.sin(t * 6) * 0.4, 0];
      target.shL = [0.2, 0, 0.3]; target.shR = [0.2, 0, -0.3];
    }

    // Relaxed weapon carry between fights.
    this.sinceAction = s.action ? 0 : this.sinceAction + dt;
    this.relax = s.action || s.steer != null ? Math.max(0, this.relax - dt * 8) : this.sinceAction > 1.2 ? Math.min(1, this.relax + dt * 2.5) : this.relax;
    const carry = this.carry();
    if (this.relax > 0 && s.grounded && carry !== 'none') {
      const k = this.relax;
      const blendArm = (j: J, p: [number, number, number]) => { const tg = target[j]; tg[0] = lerp(tg[0], p[0], k); tg[1] = lerp(tg[1], p[1], k); tg[2] = lerp(tg[2], p[2], k); };
      if (carry === 'heavy') { blendArm('shR', [-0.12, 0, -0.5]); blendArm('elR', [-2.3, 0, 0]); blendArm('haR', [0.25, 0, 0]); blendArm('neck', [0.02, -0.15, 0]); }
      else if (carry === 'pole') { blendArm('shR', [-0.12, 0, -0.18]); blendArm('elR', [-1.1, 0, 0]); }
      else if (carry === 'gun') { blendArm('shR', [-0.2, 0, -0.1]); blendArm('elR', [-1.0, 0, 0]); blendArm('shL', [-0.5, 0, 0.3]); blendArm('elL', [-1.2, 0, 0]); }
      else { const sw = Math.sin(this.phase) * 0.1 * Math.min(1, spd / 4); blendArm('shR', [0.12 - sw, 0, -0.22]); blendArm('elR', [-0.45, 0, 0]); if (this.weaponL) { blendArm('shL', [0.12 + sw, 0, 0.22]); blendArm('elL', [-0.45, 0, 0]); } }
    }
    this.poseWeapons(this.relax);

    // Action overlay.
    let sharp = 16;
    if (s.action && ACTIONS[s.action]) {
      const a = ACTIONS[s.action](clamp(s.actionT, 0, 1));
      for (const k in a.pose) {
        const p = a.pose[k as J]!;
        const tg = target[k];
        tg[0] = lerp(tg[0], p[0], a.w); tg[1] = lerp(tg[1], p[1], a.w); tg[2] = lerp(tg[2], p[2], a.w);
      }
      if (a.bodyY !== undefined) bodyY = lerp(bodyY, a.bodyY, a.w);
      if (a.spin) spin = a.spin;
      sharp = 30;
    }
    this.apply(target, bodyY, spin, dt, sharp);
    this.updateFace(dt, s);
    const cape = this.j.chest.getObjectByName('cape');
    if (cape) cape.rotation.x = 0.12 + moveK * 0.5 + Math.sin(t * 6) * 0.05 * (0.3 + moveK);
  }

  private updateFace(dt: number, s: AnimInput) {
    let e: Expr = 'neutral';
    this.blinkT -= dt;
    if (this.blinkT < -0.13) this.blinkT = 1.8 + Math.random() * 3.5;
    if (this.expr) e = this.expr;
    else if (s.stun || this.flashT > 0) e = 'pain';
    else if (s.action) e = EXPR_FOR[s.action] ?? (s.actionT > 0.12 && s.actionT < 0.8 ? 'shout' : 'angry');
    else if (s.speed > 7) e = 'focus';
    else if (this.blinkT < 0) e = 'blink';
    if (e !== this.exprCur) this.setExpr(e);
  }

  private apply(target: Record<string, [number, number, number]>, bodyY: number, spin: number, dt: number, sharp: number) {
    for (const k of JOINTS) {
      const tg = target[k];
      const c = this.cur[k];
      c.x = damp(c.x, tg[0], sharp, dt);
      c.y = damp(c.y, tg[1], sharp, dt);
      c.z = damp(c.z, tg[2], sharp, dt);
      this.j[k].rotation.set(c.x, c.y, c.z);
    }
    this.j.body.position.y = damp(this.j.body.position.y, bodyY, sharp, dt);
    this.j.body.rotation.y = spin;
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry && !capCache.has((m.geometry as any).__k)) { /* geometries mostly shared; leave */ }
    });
    for (const m of this.mats) m.dispose();
  }
}
