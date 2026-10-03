// Sky dome, sun & ambient lighting, fog, day/night cycle, weather and
// regional atmosphere that blends toward the theme of the nearest island.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ISLANDS, IslandTheme } from '../game/data';
import { clamp, damp, lerp, rand, smoothstep } from '../core/math';
import { ctx } from '../game/ctx';

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w; // push to far plane
}`;
const skyFrag = /* glsl */ `
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom;
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uTime;
uniform float uCloud; uniform float uNight; uniform float uStorm; uniform vec3 uCloudColor;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(uHorizon, uBottom, clamp(-h * 4.0, 0.0, 1.0));
  float sd = max(dot(d, uSunDir), 0.0);
  // Sun disk + glow (moon at night uses the opposite direction).
  col += uSunColor * (pow(sd, 1200.0) * 30.0 + pow(sd, 60.0) * 0.45 + pow(sd, 6.0) * 0.18) * (1.0 - uStorm * 0.8);
  float md = max(dot(d, -uSunDir), 0.0);
  col += vec3(0.8, 0.85, 1.0) * (pow(md, 2500.0) * 8.0 + pow(md, 80.0) * 0.12) * uNight;
  // Stars.
  if (uNight > 0.01 && h > 0.0) {
    vec3 sp = floor(d * 420.0);
    float s = hash3(sp);
    float tw = 0.6 + 0.4 * sin(uTime * 3.0 + s * 50.0);
    col += vec3(step(0.9975, s) * tw * uNight * (1.0 - uStorm));
  }
  // Clouds: planar projection.
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.12) * 1.4 + vec2(uTime * 0.012, uTime * 0.004);
    float c = fbm(uv);
    float cov = mix(0.62, 0.32, uCloud);
    float cl = smoothstep(cov, cov + 0.25, c) * smoothstep(0.0, 0.15, h);
    vec3 cc = mix(uCloudColor, uCloudColor * 0.55, smoothstep(cov + 0.1, cov + 0.45, c));
    cc += uSunColor * pow(sd, 8.0) * 0.4;
    col = mix(col, cc, cl * 0.9);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const OPEN_SEA: IslandTheme = {
  sand: 0, grass: 0, grass2: 0, rock: 0, peak: 0, path: 0, shallow: 0x2ad1c4,
  fog: 0xbfe0f0, skyTop: 0x2f7fd8, skyHorizon: 0xc9e8f8, ambient: 'none', storm: 0,
};

type AmbientKind = IslandTheme['ambient'];

class AmbientField {
  points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private count: number;
  private mat: THREE.PointsMaterial;
  kind: AmbientKind = 'none';
  opacity = 0;
  constructor(count: number) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.pos[i * 3] = rand(-40, 40);
      this.pos[i * 3 + 1] = rand(-5, 30);
      this.pos[i * 3 + 2] = rand(-40, 40);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const tex = AmbientField.dotTexture();
    this.mat = new THREE.PointsMaterial({ size: 0.25, map: tex, transparent: true, depthWrite: false, opacity: 0, sizeAttenuation: true });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
  }
  static dotTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.4, 'rgba(255,255,255,0.7)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  }
  setKind(k: AmbientKind) {
    if (k === this.kind) return;
    this.kind = k;
    const m = this.mat;
    m.blending = THREE.NormalBlending;
    switch (k) {
      case 'snow': m.color.set(0xffffff); m.size = 0.35; break;
      case 'embers': m.color.set(0xff7a2a); m.size = 0.3; m.blending = THREE.AdditiveBlending; break;
      case 'leaves': m.color.set(0xd8ff9a); m.size = 0.18; m.blending = THREE.AdditiveBlending; break;
      case 'sand': m.color.set(0xf0d8a0); m.size = 0.16; break;
      case 'sparkle': m.color.set(0xfff2b0); m.size = 0.3; m.blending = THREE.AdditiveBlending; break;
      case 'rain': m.color.set(0xaac4dd); m.size = 0.12; break;
    }
    m.needsUpdate = true;
    for (let i = 0; i < this.count; i++) this.respawnVel(i);
  }
  private respawnVel(i: number) {
    const v = this.vel;
    switch (this.kind) {
      case 'snow': v[i * 3] = rand(-1, 1); v[i * 3 + 1] = rand(-2.5, -1.2); v[i * 3 + 2] = rand(-1, 1); break;
      case 'embers': v[i * 3] = rand(-0.6, 0.6); v[i * 3 + 1] = rand(0.8, 2.5); v[i * 3 + 2] = rand(-0.6, 0.6); break;
      case 'leaves': v[i * 3] = rand(-0.3, 0.3); v[i * 3 + 1] = rand(-0.2, 0.3); v[i * 3 + 2] = rand(-0.3, 0.3); break;
      case 'sand': v[i * 3] = rand(5, 9); v[i * 3 + 1] = rand(-0.3, 0.3); v[i * 3 + 2] = rand(1, 3); break;
      case 'sparkle': v[i * 3] = rand(-0.2, 0.2); v[i * 3 + 1] = rand(0.2, 0.6); v[i * 3 + 2] = rand(-0.2, 0.2); break;
      case 'rain': v[i * 3] = rand(-1, 1); v[i * 3 + 1] = rand(-38, -30); v[i * 3 + 2] = rand(-1, 1); break;
      default: v[i * 3] = v[i * 3 + 1] = v[i * 3 + 2] = 0;
    }
  }
  update(dt: number, center: THREE.Vector3, time: number) {
    const target = this.kind === 'none' ? 0 : 1;
    this.opacity = damp(this.opacity, target * this.intensity, 1.5, dt);
    this.mat.opacity = this.opacity;
    this.points.visible = this.opacity > 0.01;
    if (!this.points.visible) return;
    const p = this.pos, v = this.vel;
    const R = 40, H = 30;
    for (let i = 0; i < this.count; i++) {
      const j = i * 3;
      let x = p[j] + v[j] * dt, y = p[j + 1] + v[j + 1] * dt, z = p[j + 2] + v[j + 2] * dt;
      if (this.kind === 'leaves' || this.kind === 'sparkle') { x += Math.sin(time * 1.3 + i) * dt * 0.5; y += Math.cos(time + i * 0.7) * dt * 0.3; }
      // Wrap around the camera in a box.
      const lx = x - center.x, lz = z - center.z, ly = y - center.y;
      if (lx > R) x -= 2 * R; else if (lx < -R) x += 2 * R;
      if (lz > R) z -= 2 * R; else if (lz < -R) z += 2 * R;
      if (ly < -8) y += H + 8; else if (ly > H) y -= H + 8;
      p[j] = x; p[j + 1] = y; p[j + 2] = z;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
  intensity = 1;
}

export class Environment {
  sky: THREE.Mesh;
  skyMat: THREE.ShaderMaterial;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  fog: THREE.FogExp2;
  timeOfDay = 0.32; // 0..1, 0.25 = sunrise, 0.5 = noon
  dayLength = 600;
  storm = 0;
  night = 0;
  sunDir = new THREE.Vector3();
  private rain: THREE.LineSegments;
  private rainPos: Float32Array;
  private ambientField = new AmbientField(900);
  private clouds: THREE.InstancedMesh;
  private lightningTimer = 4;
  private flash = 0;
  private flashLight: THREE.PointLight;
  private bolt: THREE.Mesh | null = null;
  private boltLife = 0;
  forceStorm = -1; // cutscene override
  darken = 0; // 0..1, cutscene dramatic darkening
  zoneTheme: IslandTheme = { ...OPEN_SEA };
  private cur = {
    top: new THREE.Color(), horizon: new THREE.Color(), fog: new THREE.Color(), cloud: new THREE.Color(),
  };
  private shadowSize = 70;

  constructor(scene: THREE.Scene) {
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uBottom: { value: new THREE.Color(0x0a3d6b) },
        uSunDir: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Color() }, uTime: { value: 0 },
        uCloud: { value: 0.3 }, uNight: { value: 0 }, uStorm: { value: 0 }, uCloudColor: { value: new THREE.Color(1, 1, 1) },
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -2;
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -this.shadowSize; sc.right = this.shadowSize; sc.top = this.shadowSize; sc.bottom = -this.shadowSize;
    sc.near = 1; sc.far = 600;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbfe3ff, 0x5a6b4a, 1.1);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.15);
    scene.add(this.ambient);
    this.fog = new THREE.FogExp2(0xbfe0f0, 0.00045);
    scene.fog = this.fog;

    // Rain streaks.
    const N = 1400;
    this.rainPos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) {
      const x = rand(-45, 45), y = rand(-5, 40), z = rand(-45, 45);
      this.rainPos.set([x, y, z, x + 0.15, y - 1.1, z], i * 6);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xaabbd0, transparent: true, opacity: 0.0, depthWrite: false }));
    this.rain.frustumCulled = false;
    scene.add(this.rain);
    scene.add(this.ambientField.points);

    // Puffy anime cumulus scattered over the whole voyage: domed puffs on a shared flat base.
    const dome = new THREE.SphereGeometry(1, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2);
    const base = new THREE.CircleGeometry(1, 18).rotateX(Math.PI / 2);
    dome.deleteAttribute('uv'); base.deleteAttribute('uv');
    const cloudGeo = mergeGeometries([dome.toNonIndexed(), base.toNonIndexed()])!;
    const cloudRamp = new THREE.DataTexture(new Uint8Array([178, 178, 178, 255, 228, 228, 228, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
    cloudRamp.needsUpdate = true;
    const cloudMat = new THREE.MeshToonMaterial({ color: 0xffffff, emissive: 0x8aa4c8, emissiveIntensity: 0.55, gradientMap: cloudRamp, fog: false });
    const CL = 150, PUFFS = 11;
    this.clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, CL * PUFFS);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let k = 0;
    for (let c = 0; c < CL; c++) {
      const cx = rand(-3500, 3500), cz = rand(-12500, 2500), cy = rand(240, 460);
      const size = rand(22, 58);
      const len = rand(1.2, 2.2);
      for (let i = 0; i < PUFFS; i++) {
        const t = i / (PUFFS - 1) - 0.5;
        const center = 1 - Math.abs(t) * 1.6;
        const r = size * (0.45 + center * 0.55) * rand(0.75, 1.1);
        // Base row first, then a few big crown puffs in the middle raised above it.
        const crown = i % 3 === 1;
        const y = cy + (crown ? size * rand(0.25, 0.55) * center : 0);
        p.set(cx + t * size * len * 2 + rand(-0.2, 0.2) * size, y, cz + rand(-0.45, 0.45) * size);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(0, 6.28));
        s.set(r * 1.25, r * (crown ? 0.95 : 0.75), r);
        m.compose(p, q, s);
        this.clouds.setMatrixAt(k++, m);
      }
    }
    this.clouds.frustumCulled = false;
    scene.add(this.clouds);

    this.flashLight = new THREE.PointLight(0xbfd8ff, 0, 1500, 1.2);
    scene.add(this.flashLight);
  }

  setQuality(q: 'low' | 'medium' | 'high') {
    const size = q === 'high' ? 2048 : q === 'medium' ? 1024 : 512;
    this.sun.castShadow = q !== 'low';
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); (this.sun.shadow as any).map = null; }
    this.sun.shadow.mapSize.set(size, size);
  }

  /** How much each island influences the atmosphere at a point. */
  private zoneAt(pos: THREE.Vector3) {
    let bestW = 0;
    let best: IslandTheme | null = null;
    for (const isl of ISLANDS) {
      const d = Math.hypot(pos.x - isl.pos[0], pos.z - isl.pos[1]);
      const w = 1 - smoothstep(isl.radius + 150, isl.radius + 1100, d);
      if (w > bestW) { bestW = w; best = isl.theme; }
    }
    // Stormy seas on the approach to Thunderhold.
    const legStorm = 1 - smoothstep(0, 1400, Math.abs(pos.z - -6400)) ;
    return { theme: best, w: bestW, legStorm: legStorm * 0.85 };
  }

  update(dt: number, focus: THREE.Vector3, camera: THREE.Camera) {
    const tScaled = dt;
    this.timeOfDay = (this.timeOfDay + tScaled / this.dayLength) % 1;
    const ang = (this.timeOfDay - 0.25) * Math.PI * 2;
    const elev = Math.sin(ang);
    this.sunDir.set(Math.cos(ang) * 0.75, elev, -0.45).normalize();
    const dayF = smoothstep(-0.12, 0.25, elev);
    const sunsetF = (1 - smoothstep(0.0, 0.35, Math.abs(elev))) * smoothstep(-0.2, 0.05, elev);
    this.night = 1 - smoothstep(-0.25, 0.02, elev);

    const z = this.zoneAt(focus);
    const theme = z.theme || OPEN_SEA;
    const w = z.w;
    let stormTarget = Math.max(lerp(0, theme.storm, w), z.legStorm);
    if (this.forceStorm >= 0) stormTarget = this.forceStorm;
    this.storm = damp(this.storm, stormTarget, 0.6, dt);
    const storm = this.storm;
    this.zoneTheme = theme;

    const c = this.cur;
    const tmp = new THREE.Color();
    const dayTop = new THREE.Color(OPEN_SEA.skyTop).lerp(tmp.setHex(theme.skyTop), w);
    const dayHor = new THREE.Color(OPEN_SEA.skyHorizon).lerp(tmp.setHex(theme.skyHorizon), w);
    const dayFog = new THREE.Color(OPEN_SEA.fog).lerp(tmp.setHex(theme.fog), w);
    const sunsetHor = new THREE.Color(0xff9a5a);
    const sunsetTop = new THREE.Color(0x5a5aa8);
    const nightTop = new THREE.Color(0x070b1c), nightHor = new THREE.Color(0x1a2440);
    const stormTop = new THREE.Color(0x2b313c), stormHor = new THREE.Color(0x56606c);

    c.top.copy(dayTop).lerp(sunsetTop, sunsetF * 0.6).lerp(nightTop, this.night).lerp(stormTop, storm * 0.85);
    c.horizon.copy(dayHor).lerp(sunsetHor, sunsetF * 0.75).lerp(nightHor, this.night).lerp(stormHor, storm * 0.85);
    c.fog.copy(dayFog).lerp(sunsetHor, sunsetF * 0.45).lerp(nightHor, this.night).lerp(stormHor, storm * 0.9);
    c.cloud.setRGB(1, 1, 1).lerp(new THREE.Color(1, 0.75, 0.6), sunsetF).lerp(new THREE.Color(0.25, 0.3, 0.42), this.night).lerp(new THREE.Color(0.35, 0.38, 0.44), storm);
    if (this.darken > 0) {
      const dk = new THREE.Color(0x120814);
      c.top.lerp(dk, this.darken); c.horizon.lerp(dk, this.darken * 0.8); c.fog.lerp(dk, this.darken * 0.8);
    }

    const u = this.skyMat.uniforms;
    u.uTop.value.copy(c.top);
    u.uHorizon.value.copy(c.horizon);
    u.uSunDir.value.copy(this.sunDir);
    const sunCol = new THREE.Color(1, 0.96, 0.88).lerp(new THREE.Color(1, 0.55, 0.25), sunsetF);
    u.uSunColor.value.copy(sunCol).multiplyScalar(dayF);
    u.uTime.value += dt;
    u.uCloud.value = 0.25 + storm * 0.75;
    u.uNight.value = this.night;
    u.uStorm.value = storm;
    u.uCloudColor.value.copy(c.cloud);
    this.sky.position.copy(camera.position);

    this.fog.color.copy(c.fog);
    const onIsland = w > 0.6 ? 1 : 0;
    this.fog.density = lerp(0.00032, 0.0006, onIsland * 0.5) + storm * 0.0012 + this.darken * 0.002;

    // Lights: moonlight keeps nights readable.
    const lightDir = elev > -0.05 ? this.sunDir : this.sunDir.clone().negate();
    this.sun.position.copy(focus).addScaledVector(lightDir, 300);
    this.sun.target.position.copy(focus);
    this.sun.color.copy(sunCol).lerp(new THREE.Color(0.6, 0.7, 1.0), this.night);
    this.sun.intensity = lerp(2.8, 0.55, this.night) * (1 - storm * 0.55) * (1 - this.darken * 0.6) * (0.55 + 0.45 * Math.min(1, dayF + this.night));
    this.hemi.color.copy(c.top).lerp(new THREE.Color(1, 1, 1), 0.3);
    this.hemi.groundColor.setHex(0x5a5038).lerp(new THREE.Color(0x101420), this.night);
    this.hemi.intensity = lerp(0.95, 0.55, this.night) * (1 - storm * 0.25);
    this.ambient.intensity = 0.12 + this.night * 0.12;

    // Clouds tint: the shadowed undersides take on the sky colour instead of going grey.
    const cm = this.clouds.material as THREE.MeshToonMaterial;
    cm.color.copy(c.cloud);
    cm.emissive.copy(c.top).lerp(c.cloud, 0.45).multiplyScalar(0.62);

    // Ocean uniforms.
    const om = ctx.ocean.material.uniforms;
    om.uSunDir.value.copy(this.sunDir);
    om.uSunColor.value.copy(sunCol).multiplyScalar(dayF);
    om.uSkyColor.value.copy(c.horizon);
    om.uSkyTop.value.copy(c.top);
    om.uNight.value = Math.max(this.night * 0.85, storm * 0.4);
    om.uDeep.value.setHex(0x0a3d6b).lerp(new THREE.Color(0x03101f), this.night * 0.8).lerp(new THREE.Color(0x15232d), storm * 0.6);
    om.uMid.value.setHex(0x1b78b0).lerp(new THREE.Color(0x0a2038), this.night * 0.8).lerp(new THREE.Color(0x2d4552), storm * 0.6);
    ctx.ocean.waveScale = damp(ctx.ocean.waveScale, 1 + storm * 1.3, 0.5, dt);

    // Rain + ambient particles.
    const rainAmt = smoothstep(0.35, 0.8, storm);
    (this.rain.material as THREE.LineBasicMaterial).opacity = rainAmt * 0.45;
    this.rain.visible = rainAmt > 0.02;
    if (this.rain.visible) {
      const rp = this.rainPos;
      const cp = camera.position;
      for (let i = 0; i < rp.length; i += 6) {
        rp[i + 1] -= 42 * dt; rp[i + 4] -= 42 * dt;
        if (rp[i + 1] < cp.y - 10) {
          const x = cp.x + rand(-45, 45), y = cp.y + rand(20, 40), zz = cp.z + rand(-45, 45);
          rp[i] = x; rp[i + 1] = y; rp[i + 2] = zz; rp[i + 3] = x + 0.15; rp[i + 4] = y - 1.1; rp[i + 5] = zz;
        }
      }
      (this.rain.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
    const amb = w > 0.5 ? theme.ambient : 'none';
    this.ambientField.setKind(amb === 'rain' ? 'none' : amb);
    this.ambientField.intensity = amb === 'sparkle' || amb === 'leaves' ? (0.5 + this.night * 0.5) : 1;
    this.ambientField.update(dt, camera.position, u.uTime.value);

    // Lightning.
    if (storm > 0.55) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = rand(2.5, 9) / storm;
        this.strike(focus);
      }
    }
    this.flash = Math.max(0, this.flash - dt * 4);
    this.flashLight.intensity = this.flash * 4;
    this.hemi.intensity += this.flash * 2.5;
    if (this.bolt) {
      this.boltLife -= dt;
      (this.bolt.material as THREE.MeshBasicMaterial).opacity = Math.max(0, this.boltLife * 4);
      if (this.boltLife <= 0) { this.bolt.parent?.remove(this.bolt); this.bolt.geometry.dispose(); this.bolt = null; }
    }
  }

  strike(focus: THREE.Vector3) {
    const a = rand(0, Math.PI * 2), d = rand(250, 900);
    const x = focus.x + Math.cos(a) * d, z = focus.z + Math.sin(a) * d;
    this.flash = 1;
    this.flashLight.position.set(x, 200, z);
    // Jagged bolt from the clouds.
    const pts: THREE.Vector3[] = [];
    let px = x, pz = z;
    for (let y = 320; y >= 0; y -= 20) {
      pts.push(new THREE.Vector3(px, y, pz));
      px += rand(-14, 14); pz += rand(-14, 14);
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1);
    const geo = new THREE.TubeGeometry(curve, 40, 1.4, 4, false);
    if (this.bolt) { this.bolt.parent?.remove(this.bolt); this.bolt.geometry.dispose(); }
    this.bolt = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xe8f2ff, transparent: true, fog: false }));
    this.boltLife = 0.25;
    ctx.scene.add(this.bolt);
    const pos = new THREE.Vector3(x, 0, z);
    setTimeout(() => ctx.audio.sfx('thunder', pos, 0.8), clamp(d / 3, 100, 1800));
  }
}
