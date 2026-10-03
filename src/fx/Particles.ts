// Pooled CPU particle system rendered as soft point sprites (two blend modes).
import * as THREE from 'three';

export interface EmitOpts {
  pos: THREE.Vector3;
  vel?: THREE.Vector3;
  life?: number;
  size?: number;
  sizeEnd?: number;
  color?: number;
  colorEnd?: number;
  alpha?: number;
  gravity?: number;
  drag?: number;
  additive?: boolean;
}

class Pool {
  max: number;
  count = 0;
  pos: Float32Array;
  vel: Float32Array;
  life: Float32Array;
  maxLife: Float32Array;
  size: Float32Array;
  sizeEnd: Float32Array;
  c0: Float32Array;
  c1: Float32Array;
  alpha: Float32Array;
  grav: Float32Array;
  drag: Float32Array;
  geo: THREE.BufferGeometry;
  aPos: Float32Array;
  aCol: Float32Array;
  aSize: Float32Array;
  points: THREE.Points;

  constructor(max: number, additive: boolean, tex: THREE.Texture) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.sizeEnd = new Float32Array(max);
    this.c0 = new Float32Array(max * 3);
    this.c1 = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.aPos = new Float32Array(max * 3);
    this.aCol = new Float32Array(max * 4);
    this.aSize = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.aPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.aCol, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.aSize, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: tex }, uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute vec4 aColor; attribute float aSize; uniform float uScale; varying vec4 vColor;
        void main() { vColor = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex; varying vec4 vColor;
        void main() { vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vColor.rgb, vColor.a * t.a); if (gl_FragColor.a < 0.01) discard; }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 10 : 9;
  }

  emit(o: EmitOpts) {
    if (this.count >= this.max) return;
    const i = this.count++;
    const c0 = new THREE.Color(o.color ?? 0xffffff), c1 = new THREE.Color(o.colorEnd ?? o.color ?? 0xffffff);
    this.pos[i * 3] = o.pos.x; this.pos[i * 3 + 1] = o.pos.y; this.pos[i * 3 + 2] = o.pos.z;
    this.vel[i * 3] = o.vel?.x ?? 0; this.vel[i * 3 + 1] = o.vel?.y ?? 0; this.vel[i * 3 + 2] = o.vel?.z ?? 0;
    this.life[i] = this.maxLife[i] = o.life ?? 1;
    this.size[i] = o.size ?? 0.5;
    this.sizeEnd[i] = o.sizeEnd ?? (o.size ?? 0.5);
    this.c0[i * 3] = c0.r; this.c0[i * 3 + 1] = c0.g; this.c0[i * 3 + 2] = c0.b;
    this.c1[i * 3] = c1.r; this.c1[i * 3 + 1] = c1.g; this.c1[i * 3 + 2] = c1.b;
    this.alpha[i] = o.alpha ?? 1;
    this.grav[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 0.5;
  }

  update(dt: number) {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // Swap-remove with last.
        const last = --this.count;
        if (i !== last) this.copy(last, i);
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      this.aPos[i * 3] = this.pos[i * 3]; this.aPos[i * 3 + 1] = this.pos[i * 3 + 1]; this.aPos[i * 3 + 2] = this.pos[i * 3 + 2];
      this.aCol[i * 4] = this.c0[i * 3] + (this.c1[i * 3] - this.c0[i * 3]) * t;
      this.aCol[i * 4 + 1] = this.c0[i * 3 + 1] + (this.c1[i * 3 + 1] - this.c0[i * 3 + 1]) * t;
      this.aCol[i * 4 + 2] = this.c0[i * 3 + 2] + (this.c1[i * 3 + 2] - this.c0[i * 3 + 2]) * t;
      const fadeIn = Math.min(1, t * 8);
      this.aCol[i * 4 + 3] = this.alpha[i] * fadeIn * (1 - t * t);
      this.aSize[i] = this.size[i] + (this.sizeEnd[i] - this.size[i]) * t;
      i++;
    }
    this.geo.setDrawRange(0, this.count);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }

  private copy(a: number, b: number) {
    for (let k = 0; k < 3; k++) {
      this.pos[b * 3 + k] = this.pos[a * 3 + k];
      this.vel[b * 3 + k] = this.vel[a * 3 + k];
      this.c0[b * 3 + k] = this.c0[a * 3 + k];
      this.c1[b * 3 + k] = this.c1[a * 3 + k];
    }
    this.life[b] = this.life[a]; this.maxLife[b] = this.maxLife[a];
    this.size[b] = this.size[a]; this.sizeEnd[b] = this.sizeEnd[a];
    this.alpha[b] = this.alpha[a]; this.grav[b] = this.grav[a]; this.drag[b] = this.drag[a];
  }
}

export class Particles {
  add: Pool;
  norm: Pool;
  budget = 1;
  constructor(scene: THREE.Scene) {
    const tex = Particles.makeTex();
    this.add = new Pool(5000, true, tex);
    this.norm = new Pool(4000, false, tex);
    scene.add(this.add.points, this.norm.points);
  }
  static makeTex() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.8)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }
  setViewport(h: number) {
    (this.add.points.material as THREE.ShaderMaterial).uniforms.uScale.value = h * 0.9;
    (this.norm.points.material as THREE.ShaderMaterial).uniforms.uScale.value = h * 0.9;
  }
  emit(o: EmitOpts) {
    if (this.budget < 1 && Math.random() > this.budget) return;
    (o.additive ? this.add : this.norm).emit(o);
  }
  /** Burst of particles radiating from a point. */
  burst(pos: THREE.Vector3, n: number, o: Omit<EmitOpts, 'pos' | 'vel'> & { speed?: number; up?: number; spread?: number }) {
    const sp = o.speed ?? 6;
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(sp * (0.4 + Math.random() * 0.8));
      v.y += o.up ?? 0;
      const p = pos.clone();
      if (o.spread) p.add(new THREE.Vector3((Math.random() - 0.5) * o.spread, (Math.random() - 0.5) * o.spread, (Math.random() - 0.5) * o.spread));
      this.emit({ ...o, pos: p, vel: v, life: (o.life ?? 1) * (0.6 + Math.random() * 0.6) });
    }
  }
  update(dt: number) {
    this.add.update(dt);
    this.norm.update(dt);
  }
}
