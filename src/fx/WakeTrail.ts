// Foam ribbon trailing behind a moving ship. Stern positions are sampled into a ring buffer;
// the ribbon widens and fades with age and rides the ocean surface.
import * as THREE from 'three';

const N = 48;
let foamTex: THREE.CanvasTexture | null = null;

function foamTexture() {
  if (foamTex) return foamTex;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 128, 256);
  // Streaky foam: soft edges, broken lumps in the middle, two bright outer lines.
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * 128, y = Math.random() * 256;
    const edge = Math.abs(x / 128 - 0.5) * 2;
    const a = (0.18 + Math.random() * 0.35) * (1 - Math.pow(edge, 3));
    g.fillStyle = `rgba(255,255,255,${a})`;
    g.beginPath(); g.ellipse(x, y, 2 + Math.random() * 6, 4 + Math.random() * 12, 0, 0, 7); g.fill();
  }
  for (const x of [10, 118]) {
    const gr = g.createLinearGradient(x - 10, 0, x + 10, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(x - 10, 0, 20, 256);
  }
  foamTex = new THREE.CanvasTexture(c);
  foamTex.wrapT = THREE.RepeatWrapping;
  return foamTex;
}

export class WakeTrail {
  mesh: THREE.Mesh;
  private pts: { x: number; z: number; age: number; w: number; v: number }[] = [];
  private geo = new THREE.BufferGeometry();
  private pos = new Float32Array(N * 2 * 3);
  private uv = new Float32Array(N * 2 * 2);
  private alpha = new Float32Array(N * 2);
  private acc = 0;
  private dist = 0;

  constructor(scene: THREE.Scene, private width: number) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    const idx: number[] = [];
    for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    this.geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTex: { value: null } }]),
      vertexShader: /* glsl */ `
        attribute float aAlpha; varying float vA; varying vec2 vUv;
        #include <fog_pars_vertex>
        void main() { vA = aAlpha; vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex; varying float vA; varying vec2 vUv;
        #include <fog_pars_fragment>
        void main() { vec4 t = texture2D(uTex, vUv); gl_FragColor = vec4(vec3(0.95, 0.98, 1.0), t.a * vA);
        #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    mat.uniforms.uTex.value = foamTexture();
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  /** stern: world position of the stern at the waterline; speed in m/s; heightAt samples the sea. */
  update(dt: number, stern: THREE.Vector3, speed: number, heightAt: (x: number, z: number) => number) {
    for (const p of this.pts) p.age += dt;
    while (this.pts.length && this.pts[this.pts.length - 1].age > 7) this.pts.pop();
    this.acc += dt;
    const strength = Math.min(1, Math.max(0, (Math.abs(speed) - 1) / 9));
    const head = this.pts[0];
    const moved = head ? Math.hypot(stern.x - head.x, stern.z - head.z) : 99;
    if (this.acc > 0.12 && moved > 0.8) {
      this.acc = 0;
      this.dist += moved;
      this.pts.unshift({ x: stern.x, z: stern.z, age: 0, w: strength, v: this.dist * 0.025 });
      if (this.pts.length > N) this.pts.length = N;
    } else if (head) {
      // Keep the newest point glued to the stern so the ribbon never detaches.
      head.x = stern.x; head.z = stern.z;
    }
    const n = this.pts.length;
    this.mesh.visible = n > 1;
    if (n < 2) return;
    for (let i = 0; i < N; i++) {
      const p = this.pts[Math.min(i, n - 1)];
      const q = this.pts[Math.min(n - 1, Math.max(i, 1))], r = this.pts[Math.max(0, Math.min(i, n - 1) - 1)];
      let dx = (i === 0 ? p.x - q.x : r.x - p.x), dz = (i === 0 ? p.z - q.z : r.z - p.z);
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const t = p.age / 7;
      const half = this.width * (0.5 + t * 2.4);
      const y = heightAt(p.x, p.z) + 0.22;
      const sx = -dz * half, sz = dx * half;
      this.pos.set([p.x + sx, y, p.z + sz, p.x - sx, y, p.z - sz], i * 6);
      this.uv.set([0, p.v, 1, p.v], i * 4);
      const a = i >= n ? 0 : p.w * Math.pow(1 - t, 1.6) * Math.min(1, 0.35 + i * 0.4);
      this.alpha[i * 2] = a; this.alpha[i * 2 + 1] = a;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.uv as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.mesh);
    this.geo.dispose();
  }
}
