// Shared materials: toon gradient, wind-swaying vegetation, lava, energy.
import * as THREE from 'three';

export const sharedUniforms = { uTime: { value: 0 } };

let toonGrad: THREE.DataTexture | null = null;
export function toonGradient() {
  if (toonGrad) return toonGrad;
  const data = new Uint8Array([90, 90, 90, 255, 170, 170, 170, 255, 235, 235, 235, 255, 255, 255, 255, 255]);
  toonGrad = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  toonGrad.minFilter = THREE.NearestFilter;
  toonGrad.magFilter = THREE.NearestFilter;
  toonGrad.needsUpdate = true;
  return toonGrad;
}

const toonCache = new Map<string, THREE.MeshToonMaterial>();
export function toon(color: number | string, opts: { emissive?: number; emissiveIntensity?: number; transparent?: boolean; opacity?: number } = {}) {
  const key = String(color) + JSON.stringify(opts);
  let m = toonCache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color: new THREE.Color(color as any), gradientMap: toonGradient(), ...opts });
    if (opts.emissive !== undefined) m.emissive = new THREE.Color(opts.emissive);
    toonCache.set(key, m);
  }
  return m;
}

export const outlineMat = new THREE.MeshBasicMaterial({ color: 0x15100c, side: THREE.BackSide });

/** Inverted-hull outline for characters: extruded along normals by a constant width that grows a little with distance. */
export const charOutlineMat = new THREE.ShaderMaterial({
  uniforms: { uWidth: { value: 0.0105 }, uColor: { value: new THREE.Color(0x1a110c) } },
  vertexShader: /* glsl */ `
    uniform float uWidth;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vec3 wn = normalize(mat3(modelMatrix) * normal);
      float d = length(cameraPosition - wp.xyz);
      wp.xyz += wn * uWidth * clamp(d * 0.14, 1.0, 4.0);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */ `uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, 1.0); }`,
  side: THREE.BackSide,
});

let strawTex: THREE.CanvasTexture | null = null;
/** Woven straw: concentric rings (for the brim) with fibre noise, greyscale so the hat colour tints it. */
export function strawTexture() {
  if (strawTex) return strawTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4efe6'; g.fillRect(0, 0, 256, 256);
  for (let r = 4; r < 182; r += 5) {
    g.strokeStyle = `rgba(110,80,40,${0.22 + ((r / 5) % 2) * 0.12})`;
    g.lineWidth = 1.6;
    g.beginPath(); g.arc(128, 128, r, 0, Math.PI * 2); g.stroke();
  }
  for (let i = 0; i < 2600; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 180;
    g.strokeStyle = `rgba(${Math.random() < 0.5 ? '255,250,235' : '120,90,50'},0.25)`;
    g.lineWidth = 1;
    g.beginPath(); g.arc(128, 128, r, a, a + 0.06); g.stroke();
  }
  strawTex = new THREE.CanvasTexture(c);
  strawTex.colorSpace = THREE.SRGBColorSpace;
  return strawTex;
}

let worldGrad: THREE.DataTexture | null = null;
/** Softer 4-band ramp for the world so terrain and props match the cel-shaded characters. */
export function worldGradient() {
  if (worldGrad) return worldGrad;
  const v = [118, 172, 222, 255];
  const data = new Uint8Array(v.flatMap((x) => [x, x, x, 255]));
  worldGrad = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  worldGrad.minFilter = THREE.NearestFilter;
  worldGrad.magFilter = THREE.NearestFilter;
  worldGrad.needsUpdate = true;
  return worldGrad;
}

/** Vertex-colored cel-shaded material with optional wind sway. */
export function propMaterial(sway = 0, opts: THREE.MeshToonMaterialParameters = {}) {
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: worldGradient(), ...opts });
  if (sway > 0) {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = sharedUniforms.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          #else
            vec3 ip = vec3(0.0);
          #endif
          float sw = max(0.0, transformed.y) * ${sway.toFixed(3)};
          float ph = uTime * 1.6 + ip.x * 0.07 + ip.z * 0.05;
          transformed.x += sin(ph) * sw * sw * 0.6 + sin(ph * 2.7) * sw * 0.08;
          transformed.z += cos(ph * 0.8) * sw * sw * 0.4;`);
    };
    m.customProgramCacheKey = () => 'sway' + sway;
  }
  return m;
}

/** GLSL value noise shared by the world shaders. */
export const GLSL_NOISE = /* glsl */ `
  float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float wNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float wFbm(vec2 p) { return wNoise(p) * 0.55 + wNoise(p * 2.1 + 7.3) * 0.3 + wNoise(p * 4.3 + 1.7) * 0.15; }
`;

/**
 * Cel-shaded terrain: vertex colors from the island generator, broken up in the fragment shader
 * with world-space noise (sun-bleached patches, clover, dirt speckle) so the ground never reads flat.
 */
export function terrainMaterial() {
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: worldGradient() });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\n' + GLSL_NOISE)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 w = vWPos.xz;
          float big = wFbm(w * 0.018);
          float mid = wFbm(w * 0.09 + 13.0);
          float fine = wNoise(w * 1.3);
          float grassy = clamp((diffuseColor.g - max(diffuseColor.r, diffuseColor.b)) * 5.0, 0.0, 1.0);
          float sandy = clamp((diffuseColor.r - diffuseColor.b) * 3.0, 0.0, 1.0) * (1.0 - grassy);
          vec3 c = diffuseColor.rgb;
          c *= 0.9 + 0.2 * big + 0.12 * (mid - 0.5);
          c = mix(c, c * vec3(1.14, 1.08, 0.62), grassy * smoothstep(0.52, 0.78, big) * 0.55);
          c = mix(c, c * vec3(0.72, 0.9, 0.95), grassy * smoothstep(0.42, 0.18, mid) * 0.45);
          c *= 1.0 + (fine - 0.5) * (0.1 * grassy + 0.16 * sandy + 0.08);
          float lum = dot(c, vec3(0.299, 0.587, 0.114));
          c = mix(vec3(lum), c, 0.85 - 0.1 * grassy);
          diffuseColor.rgb = c;
        }`);
  };
  m.customProgramCacheKey = () => 'terrain-v1';
  return m;
}

export function lavaMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: sharedUniforms.uTime },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vW;
      void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec2 vUv; varying vec3 vW;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
      void main() {
        vec2 p = vec2(vUv.x * 2.0, vUv.y * 0.25 - uTime * 0.25);
        float n = vnoise(p * 3.0) * 0.6 + vnoise(p * 7.0 + 3.1) * 0.4;
        float crust = smoothstep(0.55, 0.75, n);
        vec3 hot = mix(vec3(1.0, 0.35, 0.02), vec3(1.0, 0.85, 0.3), vnoise(p * 5.0 - uTime * 0.2));
        vec3 col = mix(hot * 2.2, vec3(0.12, 0.05, 0.03), crust * 0.85);
        float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
        gl_FragColor = vec4(col, edge);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  });
}

export function energyMaterial(color: number, opacity = 0.6) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: sharedUniforms.uTime, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() { vUv = uv; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        float rim = 1.0 - abs(dot(vN, vV));
        float bands = 0.5 + 0.5 * sin(vUv.y * 40.0 - uTime * 6.0);
        float a = (pow(rim, 1.5) * 0.8 + bands * 0.25) * uOpacity;
        gl_FragColor = vec4(uColor * (1.2 + bands), a);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}
