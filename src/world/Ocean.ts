// Stylized animated ocean. A radial grid follows the camera; waves are a
// sum of directional sines evaluated identically on CPU (for buoyancy) and GPU.
import * as THREE from 'three';

interface Wave { dx: number; dz: number; k: number; amp: number; w: number; len: number }
const WAVE_SPECS: [number, number, number, number][] = [
  // dirX, dirZ, wavelength, amplitude
  [1, 0.35, 74, 0.95],
  [-0.45, 1, 41, 0.55],
  [0.75, -0.65, 23, 0.3],
  [-0.9, -0.25, 13.5, 0.16],
  [0.2, 0.98, 8, 0.07],
];
const WAVES: Wave[] = WAVE_SPECS.map(([x, z, len, amp]) => {
  const l = Math.hypot(x, z);
  const k = (Math.PI * 2) / len;
  return { dx: x / l, dz: z / l, k, amp, w: Math.sqrt(9.8 * k) * 0.9, len };
});

const vert = /* glsl */ `
uniform float uTime;
uniform float uWaveScale;
uniform vec3 uCenter;
varying vec3 vWorld;
varying vec3 vNormal2;
varying float vHeight;
#include <fog_pars_vertex>
${WAVES.map((w, i) => `const vec4 W${i} = vec4(${w.dx.toFixed(4)}, ${w.dz.toFixed(4)}, ${w.k.toFixed(5)}, ${w.amp.toFixed(3)}); const float WW${i} = ${w.w.toFixed(5)}; const float WL${i} = ${w.len.toFixed(2)};`).join('\n')}
void addWave(vec4 W, float ww, float wl, vec2 p, float dist, inout float h, inout vec2 d) {
  float fade = 1.0 - smoothstep(wl * 9.0, wl * 18.0, dist);
  float ph = W.z * dot(W.xy, p) - ww * uTime;
  float a = W.w * uWaveScale * fade;
  h += a * sin(ph);
  d += a * W.z * cos(ph) * W.xy;
}
void main() {
  vec3 p = position + vec3(uCenter.x, 0.0, uCenter.z);
  float dist = length(position.xz);
  float h = 0.0; vec2 d = vec2(0.0);
  addWave(W0, WW0, WL0, p.xz, dist, h, d);
  addWave(W1, WW1, WL1, p.xz, dist, h, d);
  addWave(W2, WW2, WL2, p.xz, dist, h, d);
  addWave(W3, WW3, WL3, p.xz, dist, h, d);
  addWave(W4, WW4, WL4, p.xz, dist, h, d);
  p.y = h;
  vHeight = h;
  vNormal2 = normalize(vec3(-d.x, 1.0, -d.y));
  vWorld = p;
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const frag = /* glsl */ `
uniform float uTime;
uniform float uWaveScale;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uSkyTop;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform sampler2D uHeightTex;
uniform vec4 uWorldRect; // minX, minZ, sizeX, sizeZ
uniform vec4 uIslands[8];
uniform vec3 uTints[8];
uniform float uNight;
varying vec3 vWorld;
varying vec3 vNormal2;
varying float vHeight;
#include <fog_pars_fragment>

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  vec3 viewDir = normalize(cameraPosition - vWorld);
  float camDist = length(cameraPosition - vWorld);
  // Detail normal from scrolling noise for glittering highlights.
  vec2 q = vWorld.xz * 0.35;
  float n1 = vnoise(q + vec2(uTime * 0.6, uTime * 0.3));
  float n2 = vnoise(q * 1.9 - vec2(uTime * 0.4, -uTime * 0.7));
  float detailFade = 1.0 - smoothstep(60.0, 260.0, camDist);
  vec3 N = normalize(vNormal2 + detailFade * 0.18 * vec3(n1 - 0.5, 0.0, n2 - 0.5));

  vec2 uv = (vWorld.xz - uWorldRect.xy) / uWorldRect.zw;
  float terrainH = -40.0;
  if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) terrainH = texture2D(uHeightTex, uv).r;
  float depth = max(0.0, vHeight - terrainH);

  // Shallow tint from the nearest island.
  vec3 tint = vec3(0.16, 0.8, 0.75);
  float best = 1e9;
  for (int i = 0; i < 8; i++) {
    float dd = length(vWorld.xz - uIslands[i].xy) - uIslands[i].z;
    if (dd < best) { best = dd; tint = uTints[i]; }
  }
  float shallow = exp(-depth / 7.0);
  float facing = clamp(dot(N, viewDir), 0.0, 1.0);
  vec3 water = mix(uDeep, uMid, pow(1.0 - facing, 2.0) * 0.8 + 0.1);
  water = mix(water, tint, shallow * 0.85);
  // Subsurface glow on crests facing the sun.
  float crest = smoothstep(0.2, 1.4, vHeight / max(0.3, uWaveScale));
  water += vec3(0.05, 0.22, 0.2) * crest * max(0.0, dot(uSunDir, -viewDir) * 0.5 + 0.5) * (1.0 - uNight * 0.7);

  float fres = pow(1.0 - facing, 4.0) * 0.85 + 0.04;
  vec3 R = reflect(-viewDir, N);
  vec3 sky = mix(uSkyColor, uSkyTop, clamp(R.y * 1.6, 0.0, 1.0));
  vec3 col = mix(water, sky, fres);
  float spec = pow(max(dot(R, uSunDir), 0.0), 380.0) * 6.0 + pow(max(dot(R, uSunDir), 0.0), 40.0) * 0.25;
  col += uSunColor * spec * (1.0 - uNight * 0.6);

  // Foam: wave crests + shoreline bands.
  float foamNoise = vnoise(vWorld.xz * 0.6 + uTime * 0.25) * 0.6 + vnoise(vWorld.xz * 1.7 - uTime * 0.4) * 0.4;
  float foamDetail = vnoise(vWorld.xz * 4.3 + uTime * 0.7);
  float crestFoam = smoothstep(0.92, 1.25, vHeight / max(0.35, uWaveScale * 1.3)) * smoothstep(0.55, 0.85, foamNoise * 0.7 + foamDetail * 0.4);
  float shoreBand = smoothstep(2.2, 0.0, depth);
  float shoreWave = 0.5 + 0.5 * sin(depth * 2.6 - uTime * 2.2 + foamNoise * 3.0);
  float shoreFoam = shoreBand * smoothstep(0.35, 0.85, shoreWave * foamNoise + shoreBand * 0.3);
  float foam = clamp(crestFoam + shoreFoam, 0.0, 1.0);
  col = mix(col, vec3(0.95, 0.98, 1.0) * (1.0 - uNight * 0.6), foam * 0.75);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export class Ocean {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  waveScale = 1;
  time = 0;

  constructor() {
    const geo = Ocean.radialGrid(208, 230, 0.9, 1.032);
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uWaveScale: { value: 1 },
          uCenter: { value: new THREE.Vector3() },
          uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
          uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
          uSkyColor: { value: new THREE.Color(0xcdeafa) },
          uSkyTop: { value: new THREE.Color(0x3d8fe0) },
          uDeep: { value: new THREE.Color(0x0a3d6b) },
          uMid: { value: new THREE.Color(0x1b6fa8) },
          uHeightTex: { value: null },
          uWorldRect: { value: new THREE.Vector4(0, 0, 1, 1) },
          uIslands: { value: Array.from({ length: 8 }, () => new THREE.Vector4(99999, 99999, 1, 0)) },
          uTints: { value: Array.from({ length: 8 }, () => new THREE.Color(0x2ad1c4)) },
          uNight: { value: 0 },
        },
      ]),
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  /** Concentric rings with geometric spacing: dense near the camera, sparse at the horizon. */
  static radialGrid(segments: number, rings: number, r0: number, ratio: number) {
    const pos: number[] = [0, 0, 0];
    const idx: number[] = [];
    let r = r0;
    for (let i = 0; i < rings; i++) {
      for (let s = 0; s < segments; s++) {
        const a = (s / segments) * Math.PI * 2;
        pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
      }
      r *= ratio;
      if (i > 120) r *= 1.02;
    }
    for (let s = 0; s < segments; s++) idx.push(0, 1 + ((s + 1) % segments), 1 + s);
    for (let i = 0; i < rings - 1; i++) {
      const a0 = 1 + i * segments, b0 = 1 + (i + 1) * segments;
      for (let s = 0; s < segments; s++) {
        const s1 = (s + 1) % segments;
        idx.push(a0 + s, a0 + s1, b0 + s);
        idx.push(a0 + s1, b0 + s1, b0 + s);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }

  setHeightTexture(tex: THREE.Texture, minX: number, minZ: number, sizeX: number, sizeZ: number) {
    this.material.uniforms.uHeightTex.value = tex;
    this.material.uniforms.uWorldRect.value.set(minX, minZ, sizeX, sizeZ);
  }

  setIslands(list: { x: number; z: number; r: number; tint: number }[]) {
    list.slice(0, 8).forEach((it, i) => {
      this.material.uniforms.uIslands.value[i].set(it.x, it.z, it.r, 0);
      this.material.uniforms.uTints.value[i].setHex(it.tint);
    });
  }

  heightAt(x: number, z: number, t = this.time): number {
    let h = 0;
    for (const w of WAVES) h += w.amp * Math.sin(w.k * (w.dx * x + w.dz * z) - w.w * t);
    return h * this.waveScale;
  }

  update(dt: number, camera: THREE.Camera) {
    this.time += dt;
    const u = this.material.uniforms;
    u.uTime.value = this.time;
    u.uWaveScale.value = this.waveScale;
    const snap = 4;
    const cx = Math.round(camera.position.x / snap) * snap;
    const cz = Math.round(camera.position.z / snap) * snap;
    u.uCenter.value.set(cx, 0, cz);
  }
}
