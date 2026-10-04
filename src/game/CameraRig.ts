// Third-person orbit camera with terrain/sea collision, ship mode, shake and
// scripted cutscene shots.
import * as THREE from 'three';
import { ctx } from './ctx';
import { clamp, damp, lerp } from '../core/math';

export interface Shot { pos: THREE.Vector3; look: THREE.Vector3; fov?: number }

export class CameraRig {
  yaw = Math.PI;
  pitch = 0.25;
  dist = 7;
  distTarget = 7;
  minDist = 3;
  maxDist = 14;
  target = new THREE.Vector3();
  private smoothTarget = new THREE.Vector3();
  mode: 'follow' | 'ship' | 'shot' = 'follow';
  shot: Shot | null = null;
  private shotPos = new THREE.Vector3();
  private shotLook = new THREE.Vector3();
  fov = 62;
  heightOffset = 1.6;
  lookAhead = new THREE.Vector3();
  private initialized = false;

  constructor(private camera: THREE.PerspectiveCamera) {}

  setMode(m: 'follow' | 'ship') {
    if (this.mode === m) return;
    this.mode = m;
    if (m === 'ship') { this.minDist = 18; this.maxDist = 70; this.distTarget = clamp(this.distTarget * 4, 30, 45); }
    else { this.minDist = 3; this.maxDist = 16; this.distTarget = 7.5; }
  }

  setShot(s: Shot | null, snap = false) {
    this.shot = s;
    if (s) {
      if (snap || this.mode !== 'shot') { this.shotPos.copy(s.pos); this.shotLook.copy(s.look); }
      this.mode = 'shot';
    } else {
      this.mode = 'follow';
      this.initialized = false;
    }
  }

  /** Camera-forward direction flattened onto the ground plane. */
  flatForward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
  }
  flatRight(out = new THREE.Vector3()) {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();
  }
  aimDir(out = new THREE.Vector3()) {
    return this.camera.getWorldDirection(out);
  }

  /** Where the crosshair points on the ground (raymarch), within maxDist. */
  aimPoint(maxDist: number, from: THREE.Vector3) {
    const dir = this.aimDir(new THREE.Vector3());
    const o = this.camera.position.clone();
    const p = new THREE.Vector3();
    const camToFrom = o.distanceTo(from);
    for (let t = camToFrom; t < camToFrom + maxDist; t += 1.5) {
      p.copy(o).addScaledVector(dir, t);
      const h = Math.max(ctx.world.terrainHeight(p.x, p.z), ctx.ocean.heightAt(p.x, p.z));
      if (p.y <= h) { p.y = h; return p; }
    }
    p.copy(from).addScaledVector(this.flatForward(new THREE.Vector3()), maxDist);
    p.y = Math.max(ctx.world.terrainHeight(p.x, p.z), 0);
    return p;
  }

  update(dt: number, mouse: { dx: number; dy: number }, wheel: number, focus: THREE.Vector3) {
    const cam = this.camera;
    if (this.mode === 'shot' && this.shot) {
      this.shotPos.lerp(this.shot.pos, 1 - Math.exp(-4 * dt));
      this.shotLook.lerp(this.shot.look, 1 - Math.exp(-5 * dt));
      cam.position.copy(this.shotPos);
      cam.lookAt(this.shotLook);
      const f = this.shot.fov ?? 55;
      cam.fov = damp(cam.fov, f, 4, dt);
      cam.updateProjectionMatrix();
      this.applyShake();
      return;
    }
    this.yaw -= mouse.dx * 0.0024;
    this.pitch = clamp(this.pitch + mouse.dy * 0.0022, -0.9, 1.25);
    if (wheel) this.distTarget = clamp(this.distTarget * (wheel > 0 ? 1.12 : 0.89), this.minDist, this.maxDist);
    this.dist = damp(this.dist, this.distTarget, 6, dt);
    const tgt = focus.clone();
    tgt.y += this.mode === 'ship' ? 6 : this.heightOffset;
    if (!this.initialized) { this.smoothTarget.copy(tgt); this.initialized = true; }
    this.smoothTarget.x = damp(this.smoothTarget.x, tgt.x, 18, dt);
    this.smoothTarget.z = damp(this.smoothTarget.z, tgt.z, 18, dt);
    this.smoothTarget.y = damp(this.smoothTarget.y, tgt.y, 10, dt);
    const off = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    let d = this.dist;
    // Pull in if terrain blocks the view.
    for (let k = 1; k <= 8; k++) {
      const t = (k / 8) * d;
      const p = this.smoothTarget.clone().addScaledVector(off, t);
      if (ctx.world.terrainHeight(p.x, p.z) > p.y - 0.4) { d = Math.max(1.6, t - 0.8); break; }
    }
    const pos = this.smoothTarget.clone().addScaledVector(off, d);
    const minY = Math.max(ctx.world.terrainHeight(pos.x, pos.z), ctx.ocean.heightAt(pos.x, pos.z)) + 0.7;
    if (pos.y < minY) pos.y = minY;
    cam.position.copy(pos);
    cam.lookAt(this.smoothTarget);
    cam.fov = damp(cam.fov, this.fov, 5, dt);
    cam.updateProjectionMatrix();
    this.applyShake();
  }

  private applyShake() {
    const s = ctx.fx.shakeAmt;
    if (s <= 0) return;
    const c = this.camera;
    c.position.x += (Math.random() - 0.5) * s * 0.6;
    c.position.y += (Math.random() - 0.5) * s * 0.6;
    c.position.z += (Math.random() - 0.5) * s * 0.6;
  }
}
