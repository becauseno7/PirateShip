// Lush wind-blown grass around the camera. Blades live on a wrapping tile that follows the
// camera, so they stay put in the world; each blade samples the active island's height/mask
// texture in the vertex shader to sit on the terrain and to skip paths, sand and rock.
import * as THREE from 'three';
import { GLSL_NOISE, sharedUniforms, worldGradient } from './materials';
import type { Island } from './Island';

const TILE = 76;

export class Grass {
  mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private uniforms = {
    uTime: sharedUniforms.uTime,
    uCenter: { value: new THREE.Vector2() },
    uSize: { value: TILE },
    uHeight: { value: null as THREE.Texture | null },
    uIslMin: { value: new THREE.Vector2() },
    uCell: { value: 1 },
    uRes: { value: 1 },
    uColA: { value: new THREE.Color() },
    uColB: { value: new THREE.Color() },
    uBladeH: { value: 0.85 },
  };
  private max: number;

  constructor(scene: THREE.Scene, max = 90000) {
    this.max = max;
    // One blade: a tapered 3-segment strip, base at y=0, tip at y=1, shaded dark at the root.
    const segs = 3, w = 0.085;
    const pos: number[] = [], col: number[] = [], nrm: number[] = [], idx: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const hw = w * (1 - t * 0.92);
      const shade = 0.5 + 0.55 * Math.pow(t, 0.8);
      if (i < segs) {
        pos.push(-hw, t, 0, hw, t, 0);
        col.push(shade, shade, shade, shade, shade, shade);
        nrm.push(0, 1, 0, 0, 1, 0);
      } else {
        pos.push(0, 1, 0);
        col.push(shade, shade, shade);
        nrm.push(0, 1, 0);
      }
    }
    for (let i = 0; i < segs - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const last = (segs - 1) * 2;
    idx.push(last, last + 1, last + 2);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    this.geo.setIndex(idx);
    const off = new Float32Array(max * 3);
    for (let i = 0; i < max; i++) { off[i * 3] = Math.random(); off[i * 3 + 1] = Math.random(); off[i * 3 + 2] = Math.random(); }
    this.geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 3));
    this.geo.instanceCount = max;

    const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: worldGradient(), side: THREE.DoubleSide });
    const U = this.uniforms;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; uniform vec2 uCenter; uniform float uSize; uniform sampler2D uHeight;
          uniform vec2 uIslMin; uniform float uCell; uniform float uRes; uniform float uBladeH;
          attribute vec3 aOff; varying float vMix; varying float vTip;
          ${GLSL_NOISE}`)
        .replace('#include <begin_vertex>', `
          vec2 gp = aOff.xy * uSize;
          vec2 rel = mod(gp - uCenter + uSize * 0.5, uSize) - uSize * 0.5;
          vec2 world = uCenter + rel;
          vec2 tuv = ((world - uIslMin) / uCell + 0.5) / uRes;
          vec4 hm = texture2D(uHeight, tuv);
          float inside = step(0.0, tuv.x) * step(tuv.x, 1.0) * step(0.0, tuv.y) * step(tuv.y, 1.0);
          float fade = 1.0 - smoothstep(0.3, 1.0, length(rel) / (uSize * 0.5));
          float clump = wNoise(world * 0.35);
          float hgt = uBladeH * (0.45 + aOff.z * 0.55 + clump * 0.6) * fade * smoothstep(0.45, 0.8, hm.g) * inside;
          float ang = aOff.z * 43.98;
          float cs = cos(ang), sn = sin(ang);
          float t = position.y;
          vec3 lp = vec3(position.x * (0.8 + clump * 0.5), t * hgt, 0.0);
          float wind = sin(uTime * 1.7 + world.x * 0.13 + world.y * 0.09) * 0.55 + sin(uTime * 3.3 + world.x * 0.45 + world.y * 0.3) * 0.18;
          vec3 transformed = vec3(lp.x * cs, lp.y, lp.x * sn);
          transformed.x += (wind + 0.35) * t * t * hgt * 0.55;
          transformed.z += (aOff.z - 0.5) * t * t * hgt * 0.5;
          transformed += vec3(world.x, hm.r - 0.05, world.y);
          vMix = wFbm(world * 0.045);
          vTip = t;`)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uColA; uniform vec3 uColB; varying float vMix; varying float vTip;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 gc = mix(uColA, uColB, smoothstep(0.3, 0.75, vMix));
          gc = mix(gc, gc * vec3(1.18, 1.1, 0.7), smoothstep(0.62, 0.85, vMix) * 0.6);
          diffuseColor.rgb *= gc;
          diffuseColor.rgb += vec3(0.05, 0.06, 0.02) * vTip * vTip;`);
    };
    mat.customProgramCacheKey = () => 'grass-v1';
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  setQuality(q: 'low' | 'medium' | 'high') {
    this.geo.instanceCount = q === 'high' ? this.max : q === 'medium' ? Math.floor(this.max * 0.5) : 0;
  }

  update(camera: THREE.Camera, isl: Island | null) {
    const U = this.uniforms;
    const show = !!isl && !!isl.grassTex && this.geo.instanceCount > 0;
    this.mesh.visible = show;
    if (!show) return;
    U.uHeight.value = isl!.grassTex;
    U.uIslMin.value.set(isl!.cx - isl!.half, isl!.cz - isl!.half);
    U.uCell.value = isl!.cell;
    U.uRes.value = isl!.N + 1;
    U.uColA.value.copy(isl!.grassColors[0]);
    U.uColB.value.copy(isl!.grassColors[1]);
    U.uCenter.value.set(camera.position.x, camera.position.z);
  }
}
