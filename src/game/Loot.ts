// Treasure chests, floating flotsam and the reward pipeline.
import * as THREE from 'three';
import { ctx } from './ctx';
import { toonGradient } from '../world/materials';
import { rand } from '../core/math';

export interface Reward { gold?: number; wood?: number; iron?: number; cola?: number; xp?: number }

const chestMats = {
  wood: new THREE.MeshToonMaterial({ color: 0x8a5a2a, gradientMap: toonGradient() }),
  band: new THREE.MeshToonMaterial({ color: 0xd8b04a, gradientMap: toonGradient(), emissive: 0x3a2a00 }),
  gold: new THREE.MeshBasicMaterial({ color: 0xffe070 }),
};

export class Chest {
  group = new THREE.Group();
  lid = new THREE.Group();
  opened = false;
  openT = 0;
  private sparkleT = 0;
  constructor(public id: string, public pos: THREE.Vector3, rotY: number, public tier: number, parent?: THREE.Object3D) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.75, 0.85), chestMats.wood);
    base.position.y = 0.38;
    base.castShadow = true;
    const band1 = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.12, 0.89), chestMats.band);
    band1.position.y = 0.55;
    const lidMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 1.3, 12, 1, false, 0, Math.PI), chestMats.wood);
    lidMesh.rotation.z = Math.PI / 2;
    lidMesh.position.set(0, 0, 0.43);
    lidMesh.castShadow = true;
    const lidBand = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.14, 12, 1, false, 0, Math.PI), chestMats.band);
    lidBand.rotation.z = Math.PI / 2;
    lidBand.position.set(0, 0, 0.43);
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, 0.08), chestMats.band);
    lock.position.set(0, 0.0, 0.86);
    this.lid.add(lidMesh, lidBand, lock);
    this.lid.position.set(0, 0.75, -0.43);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 0.65), chestMats.gold);
    glow.position.y = 0.72;
    this.group.add(base, band1, this.lid, glow);
    this.group.position.copy(pos);
    this.group.rotation.y = rotY;
    (parent ?? ctx.scene).add(this.group);
  }
  worldPos() { return this.group.getWorldPosition(new THREE.Vector3()); }
  open(reward: Reward) {
    if (this.opened) return;
    this.opened = true;
    ctx.audio.sfx('chest', this.worldPos());
    const p = this.worldPos().add(new THREE.Vector3(0, 1, 0));
    ctx.particles.burst(p, 40, { speed: 6, up: 6, life: 1.2, size: 0.25, sizeEnd: 0.1, color: 0xffe070, colorEnd: 0xffb020, additive: true, gravity: 12 });
    ctx.fx.light(p, 0xffd070, 30, 1.0, 12);
    ctx.game.giveLoot(reward, p);
  }
  setOpened() { this.opened = true; this.openT = 1; this.lid.rotation.x = -1.9; }
  update(dt: number, camPos: THREE.Vector3) {
    if (this.opened && this.openT < 1) {
      this.openT = Math.min(1, this.openT + dt * 2.5);
      this.lid.rotation.x = -1.9 * (1 - Math.pow(1 - this.openT, 3));
    }
    if (!this.opened) {
      this.sparkleT -= dt;
      const wp = this.worldPos();
      if (this.sparkleT <= 0 && wp.distanceToSquared(camPos) < 90 * 90) {
        this.sparkleT = 0.25;
        ctx.particles.emit({ pos: wp.add(new THREE.Vector3(rand(-0.6, 0.6), rand(0.5, 1.4), rand(-0.4, 0.4))), vel: new THREE.Vector3(0, 0.6, 0), life: 0.9, size: 0.22, sizeEnd: 0.01, color: 0xfff0a0, additive: true });
      }
    }
  }
  dispose() { this.group.parent?.remove(this.group); }
}

const floatGeo = { barrel: new THREE.CylinderGeometry(0.6, 0.6, 1.4, 10), crate: new THREE.BoxGeometry(1.3, 1.3, 1.3) };
const floatMat = new THREE.MeshToonMaterial({ color: 0x9a6a3a, gradientMap: toonGradient() });

export class FloatingLoot {
  mesh: THREE.Mesh;
  collected = false;
  t = rand(0, 10);
  constructor(public pos: THREE.Vector3, public reward: Reward) {
    this.mesh = new THREE.Mesh(Math.random() < 0.5 ? floatGeo.barrel : floatGeo.crate, floatMat);
    this.mesh.castShadow = true;
    this.mesh.position.copy(pos);
    this.mesh.rotation.set(rand(0, 1), rand(0, 6), rand(0, 1));
    ctx.scene.add(this.mesh);
  }
  update(dt: number) {
    this.t += dt;
    const h = ctx.ocean.heightAt(this.pos.x, this.pos.z);
    this.mesh.position.set(this.pos.x, h + 0.1, this.pos.z);
    this.mesh.rotation.x = Math.sin(this.t) * 0.3;
    this.mesh.rotation.z = Math.cos(this.t * 0.8) * 0.3;
    if (Math.random() < dt * 2) ctx.particles.emit({ pos: this.mesh.position.clone().add(new THREE.Vector3(0, 1.2, 0)), vel: new THREE.Vector3(0, 0.8, 0), life: 0.8, size: 0.3, sizeEnd: 0.02, color: 0xfff0a0, additive: true });
    if (!this.collected && ctx.ship.pos.distanceTo(this.mesh.position) < ctx.ship.dims.L * 0.6) {
      this.collected = true;
      ctx.audio.sfx('coin');
      ctx.game.giveLoot(this.reward, this.mesh.position.clone());
      ctx.fx.splash(this.mesh.position, 0.5);
    }
  }
  dispose() { ctx.scene.remove(this.mesh); }
}
