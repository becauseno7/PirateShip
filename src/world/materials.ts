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

/** Vertex-colored standard material with optional wind sway. */
export function propMaterial(sway = 0, opts: THREE.MeshStandardMaterialParameters = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, ...opts });
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
