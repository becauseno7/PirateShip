// Procedurally built, procedurally animated anime-style character rig.
import * as THREE from 'three';
import { toonGradient, outlineMat, sharedUniforms } from '../world/materials';

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

const capCache = new Map<string, THREE.CapsuleGeometry>();
function capsule(r: number, len: number) {
  const k = r.toFixed(3) + ':' + len.toFixed(3);
  let g = capCache.get(k);
  if (!g) { g = new THREE.CapsuleGeometry(r, len, 4, 10); capCache.set(k, g); }
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
  mouth!: THREE.Mesh;
  deadT = 0;
  scale: number;
  private aura: THREE.Mesh | null = null;
  private eyeMats: THREE.MeshBasicMaterial[] = [];

  constructor(look: RigLook) {
    this.look = look;
    this.scale = look.height ?? 1;
    this.build();
    this.root.scale.setScalar(this.scale);
  }

  private mat(color: string | number) {
    const m = new THREE.MeshToonMaterial({ color: new THREE.Color(color as any), gradientMap: toonGradient() });
    this.mats.push(m);
    return m;
  }
  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0, outline = true) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    if (outline && this.look.outline) {
      const o = new THREE.Mesh(geo, outlineMat);
      o.scale.setScalar(1.07);
      m.add(o);
    }
    return m;
  }

  private build() {
    const L = this.look;
    const b = L.build ?? 1;
    const skin = this.mat(L.skin), shirt = this.mat(L.shirt), pants = this.mat(L.pants), shoes = this.mat(L.shoes ?? 0x3a2a1e);
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

    // Torso.
    const belly = L.belly ?? 0;
    const pelvis = this.mesh(new THREE.SphereGeometry(0.17, 12, 8), pants, hips, 0, 0, 0);
    pelvis.scale.set(1.15 * b, 0.75, 0.85 * b);
    const torso = this.mesh(capsule(0.16, 0.22), L.vest ? skin : shirt, spine, 0, 0.18, 0);
    torso.scale.set(1.25 * b + belly * 0.4, 1, 0.85 * b + belly * 0.5);
    const chestM = this.mesh(capsule(0.18, 0.12), L.vest ? skin : shirt, chest, 0, 0.02, 0);
    chestM.scale.set(1.35 * b, 1, 0.9 * b);
    if (L.vest) {
      // Open vest panels over bare chest.
      for (const s of [-1, 1]) {
        const v = this.mesh(new THREE.BoxGeometry(0.14, 0.42, 0.33), shirt, spine, s * 0.17 * b, 0.25, 0, true);
        v.scale.set(b, 1, b);
        v.rotation.z = s * 0.05;
      }
    }
    if (L.sash) {
      const sash = this.mesh(new THREE.CylinderGeometry(0.205, 0.2, 0.09, 14), this.mat(L.sash), spine, 0, 0.0, 0);
      sash.scale.set(1.25 * b + belly * 0.4, 1, 0.9 * b + belly * 0.5);
    }
    if (L.armor) {
      const am = this.mat(L.armor);
      for (const s of [-1, 1]) {
        const pad = this.mesh(new THREE.SphereGeometry(0.13, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), am, chest, s * 0.26 * b, 0.08, 0);
        pad.scale.set(1.2, 0.9, 1.1);
        pad.rotation.z = -s * 0.5;
      }
      const plate = this.mesh(new THREE.BoxGeometry(0.4 * b, 0.32, 0.08), am, chest, 0, 0, 0.14 * b);
      plate.rotation.x = -0.1;
    }
    if (L.cape) {
      const cape = new THREE.Mesh(new THREE.PlaneGeometry(0.62 * b, 1.15, 1, 4), new THREE.MeshToonMaterial({ color: new THREE.Color(L.cape as any), gradientMap: toonGradient(), side: THREE.DoubleSide }));
      cape.geometry.translate(0, -0.55, 0);
      cape.position.set(0, 0.14, -0.17 * b);
      cape.rotation.x = 0.12;
      cape.castShadow = true;
      chest.add(cape);
      cape.name = 'cape';
    }

    // Head.
    const headM = this.mesh(new THREE.SphereGeometry(0.19, 18, 14), skin, head, 0, 0.17, 0);
    headM.scale.set(1, 1.08, 1);
    this.mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 8), skin, neck, 0, 0.0, 0, false);
    // Face.
    const eyeWhite = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const eyeCol = new THREE.MeshBasicMaterial({ color: L.eyeGlow ?? 0x1a1410 });
    this.eyeMats.push(eyeCol);
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 8), eyeCol);
      e.position.set(s * 0.068, 0.19, 0.172);
      e.scale.set(0.85, 1.25, 0.5);
      head.add(e);
      const hl = new THREE.Mesh(new THREE.SphereGeometry(0.01, 6, 6), eyeWhite);
      hl.position.set(s * 0.068 + 0.008, 0.2, 0.188);
      head.add(hl);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.01), new THREE.MeshBasicMaterial({ color: new THREE.Color(L.hair as any).multiplyScalar(0.7) }));
      brow.position.set(s * 0.07, 0.245, 0.175);
      brow.rotation.z = s * -0.15;
      head.add(brow);
    }
    this.mouth = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.01), new THREE.MeshBasicMaterial({ color: 0x5a2a20 }));
    this.mouth.position.set(0, 0.095, 0.178);
    head.add(this.mouth);
    if (L.scar) {
      const scar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.006, 0.01), new THREE.MeshBasicMaterial({ color: 0x9a2a2a }));
      scar.position.set(-0.07, 0.15, 0.178);
      head.add(scar);
      for (const dx of [-0.012, 0, 0.012]) {
        const st = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.016, 0.01), scar.material);
        st.position.set(-0.07 + dx, 0.15, 0.179);
        head.add(st);
      }
    }
    if (L.beard) {
      const bm = this.mat(L.beard);
      const beard = this.mesh(new THREE.ConeGeometry(0.15, 0.3, 10), bm, head, 0, 0.0, 0.08);
      beard.rotation.x = Math.PI + 0.25;
    }
    this.buildHair(head, hairM);
    this.buildHat(head);

    // Arms.
    const armR = (side: 1 | -1) => {
      const sh = g(side === 1 ? 'shL' : 'shR', chest, side * 0.25 * b, 0.07, 0);
      const up = this.mesh(capsule(0.062 * Math.sqrt(b), 0.22), L.vest ? skin : shirt, sh, 0, -0.14, 0);
      up.scale.set(1, 1, 1);
      const el = g(side === 1 ? 'elL' : 'elR', sh, 0, -0.29, 0);
      this.mesh(capsule(0.055 * Math.sqrt(b), 0.2), skin, el, 0, -0.13, 0);
      const ha = g(side === 1 ? 'haL' : 'haR', el, 0, -0.28, 0);
      const fist = this.mesh(new THREE.SphereGeometry(0.068 * Math.sqrt(b), 10, 8), skin, ha, 0, -0.02, 0.01);
      fist.scale.set(1, 1.1, 1.15);
      return sh;
    };
    armR(1);
    this.armR = armR(-1);
    // Legs.
    const leg = (side: 1 | -1) => {
      const hi = g(side === 1 ? 'hiL' : 'hiR', hips, side * 0.11 * b, -0.02, 0);
      const th = this.mesh(capsule(0.085 * Math.sqrt(b), 0.28), pants, hi, 0, -0.22, 0);
      th.scale.set(1, 1, 1);
      const kn = g(side === 1 ? 'knL' : 'knR', hi, 0, -0.44, 0);
      this.mesh(capsule(0.07 * Math.sqrt(b), 0.28), L.vest || L.hat === 'straw' ? skin : pants, kn, 0, -0.2, 0);
      const ft = g(side === 1 ? 'ftL' : 'ftR', kn, 0, -0.43, 0);
      const shoe = this.mesh(new THREE.BoxGeometry(0.12, 0.08, 0.24), shoes, ft, 0, -0.03, 0.05);
      shoe.scale.set(Math.sqrt(b), 1, 1);
      if (L.hat === 'straw') {
        // Rolled-up shorts cuff.
        this.mesh(new THREE.CylinderGeometry(0.095, 0.1, 0.07, 10), pants, kn, 0, 0.0, 0);
      }
    };
    leg(1);
    leg(-1);
    this.attachWeapons();
  }

  private buildHair(head: THREE.Group, m: THREE.Material) {
    const st = this.look.hairStyle;
    if (st === 'bald') return;
    const cap = this.mesh(new THREE.SphereGeometry(0.2, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), m, head, 0, 0.19, -0.01);
    cap.scale.set(1.04, 1.1, 1.06);
    const cone = (x: number, y: number, z: number, rx: number, rz: number, r = 0.06, h = 0.16) => {
      const c = this.mesh(new THREE.ConeGeometry(r, h, 6), m, head, x, y, z, false);
      c.rotation.set(rx, 0, rz);
    };
    if (st === 'spiky' || st === 'wild') {
      const n = st === 'wild' ? 14 : 10;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        cone(Math.cos(a) * 0.12, 0.33 + Math.random() * 0.03, Math.sin(a) * 0.12 - 0.02, Math.sin(a) * 1.0, -Math.cos(a) * 1.0, 0.07, st === 'wild' ? 0.26 : 0.2);
      }
      cone(0, 0.4, -0.03, -0.2, 0, 0.07, 0.2);
    }
    if (st === 'messy' || st === 'spiky') {
      for (let i = 0; i < 5; i++) cone(-0.12 + i * 0.06, 0.28, 0.15, 2.3, (i - 2) * 0.2, 0.045, 0.13);
      for (const s of [-1, 1]) cone(s * 0.19, 0.2, 0.02, 0.3, s * 2.6, 0.05, 0.14);
      for (let i = 0; i < 4; i++) cone(-0.09 + i * 0.06, 0.2, -0.17, -2.4, 0, 0.05, 0.14);
    }
    if (st === 'long') {
      const back = this.mesh(new THREE.BoxGeometry(0.34, 0.42, 0.1), m, head, 0, 0.04, -0.15);
      back.rotation.x = 0.1;
      for (let i = 0; i < 5; i++) cone(-0.12 + i * 0.06, 0.28, 0.15, 2.3, (i - 2) * 0.15, 0.045, 0.12);
    }
    if (st === 'topknot') {
      this.mesh(new THREE.SphereGeometry(0.08, 10, 8), m, head, 0, 0.42, -0.05);
    }
  }

  private buildHat(head: THREE.Group) {
    const L = this.look;
    const hc = L.hatColor ?? 0xe9c46a;
    switch (L.hat) {
      case 'straw': {
        const m = this.mat(hc);
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
        const c = this.mesh(new THREE.SphereGeometry(0.205, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), m, head, 0, 0.2, -0.01);
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
        this.mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), head, 0, 0.42, 0.19, false);
        break;
      }
      case 'helmet':
      case 'horns': {
        const m = this.mat(L.hat === 'horns' ? 0x3a3a3a : hc);
        const c = this.mesh(new THREE.SphereGeometry(0.22, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), m, head, 0, 0.19, 0);
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
        const m = new THREE.MeshToonMaterial({ color: 0xffd54a, emissive: 0x6a4a00, gradientMap: toonGradient() });
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
        const c = this.mesh(new THREE.SphereGeometry(0.24, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), m, head, 0, 0.16, -0.03);
        c.scale.set(1, 1.1, 1.1);
        break;
      }
    }
  }

  private weapon(kind: Weapon, color: number): THREE.Object3D {
    const g = new THREE.Group();
    const steel = this.mat(color);
    const dark = this.mat(0x2a1a12);
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0) => {
      const me = new THREE.Mesh(geo, m);
      me.position.set(x, y, z);
      me.rotation.x = rx;
      me.castShadow = true;
      g.add(me);
      return me;
    };
    switch (kind) {
      case 'cutlass':
        add(new THREE.BoxGeometry(0.03, 0.12, 0.03), dark, 0, 0, 0);
        add(new THREE.BoxGeometry(0.1, 0.02, 0.06), this.mat(0xd8b04a), 0, -0.07, 0);
        add(new THREE.BoxGeometry(0.02, 0.7, 0.08), steel, 0, -0.42, 0.02, 0.08);
        break;
      case 'katana':
      case 'katana3':
        add(new THREE.CylinderGeometry(0.02, 0.02, 0.24, 6), dark, 0, 0.02, 0);
        add(new THREE.CylinderGeometry(0.05, 0.05, 0.015, 10), this.mat(0xd8b04a), 0, -0.1, 0);
        add(new THREE.BoxGeometry(0.015, 0.95, 0.045), steel, 0, -0.58, 0.01);
        break;
      case 'musket':
        add(new THREE.CylinderGeometry(0.025, 0.025, 1.1, 8), this.mat(0x333333), 0, 0, 0.45, Math.PI / 2);
        add(new THREE.BoxGeometry(0.06, 0.12, 0.45), this.mat(0x6a4a2a), 0, -0.04, -0.12);
        break;
      case 'anchor': {
        add(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 8), steel, 0, -0.7, 0);
        add(new THREE.BoxGeometry(0.7, 0.08, 0.08), steel, 0, -0.1, 0);
        const t = add(new THREE.TorusGeometry(0.42, 0.07, 6, 16, Math.PI), steel, 0, -1.4, 0);
        t.rotation.z = Math.PI;
        add(new THREE.TorusGeometry(0.1, 0.03, 6, 12), steel, 0, 0.12, 0);
        break;
      }
      case 'kanabo': {
        add(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8), dark, 0, 0, 0);
        add(new THREE.CylinderGeometry(0.2, 0.1, 1.5, 10), steel, 0, -0.95, 0);
        for (let i = 0; i < 18; i++) {
          const a = (i / 6) * Math.PI * 2, y = -0.5 - Math.floor(i / 6) * 0.4;
          const s = add(new THREE.ConeGeometry(0.04, 0.12, 5), this.mat(0xc8c8c8), Math.cos(a) * 0.17, y, Math.sin(a) * 0.17);
          s.rotation.z = -Math.atan2(Math.cos(a), 0.0001) * 0.0 + (Math.cos(a) > 0 ? -Math.PI / 2 : Math.PI / 2);
        }
        break;
      }
      case 'axe':
        add(new THREE.CylinderGeometry(0.04, 0.04, 1.3, 8), dark, 0, -0.5, 0);
        add(new THREE.BoxGeometry(0.05, 0.4, 0.45), steel, 0, -1.0, 0.18);
        break;
      case 'scimitar2':
        add(new THREE.BoxGeometry(0.03, 0.12, 0.03), dark, 0, 0, 0);
        add(new THREE.BoxGeometry(0.02, 0.6, 0.1), steel, 0, -0.38, 0.05, 0.25);
        break;
      case 'spear':
        add(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 8), this.mat(0xd8b04a), 0, -0.2, 0);
        add(new THREE.ConeGeometry(0.08, 0.4, 6), steel, 0, -1.6, 0, Math.PI);
        add(new THREE.ConeGeometry(0.08, 0.3, 6), steel, 0, 1.1, 0);
        break;
      case 'staff':
        add(new THREE.CylinderGeometry(0.03, 0.03, 1.8, 8), dark, 0, -0.3, 0);
        add(new THREE.SphereGeometry(0.12, 12, 10), new THREE.MeshBasicMaterial({ color }), 0, 0.65, 0);
        break;
    }
    return g;
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
  setEyeGlow(c: number) { for (const e of this.eyeMats) e.color.setHex(c); }

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
        target.shL = [0.05, 0, 0.12 + Math.sin(t * 2.1) * 0.02];
        target.shR = [0.05, 0, -0.12 - Math.sin(t * 2.1) * 0.02];
        target.elL = [-0.2, 0, 0]; target.elR = [-0.2, 0, 0];
        target.neck = [Math.sin(t * 0.7) * 0.04, Math.sin(t * 0.4) * 0.15, 0];
        bodyY = Math.sin(t * 2.1) * 0.008;
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
    // Mouth: open during attacks.
    this.mouth.scale.y = s.action ? 3.5 : 1;
    const cape = this.j.chest.getObjectByName('cape');
    if (cape) cape.rotation.x = 0.12 + moveK * 0.5 + Math.sin(t * 6) * 0.05 * (0.3 + moveK);
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
