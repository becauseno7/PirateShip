// Shared game context. Systems are attached at startup by Game; modules
// import this object (type-only references) to avoid circular imports.
import type * as THREE from 'three';
import type { Input } from '../core/input';
import type { Audio } from '../core/audio';
import type { Progress, Settings } from './state';
import type { World } from '../world/World';
import type { Ocean } from '../world/Ocean';
import type { Player } from '../entities/Player';
import type { Companion } from '../entities/Companion';
import type { Ship } from '../entities/Ship';
import type { Combat } from '../combat/Combat';
import type { Particles } from '../fx/Particles';
import type { Effects } from '../fx/Effects';
import type { UI } from '../ui/UI';
import type { Game } from './Game';
import type { Projectiles } from '../combat/Projectiles';
import type { Encounters } from './Encounters';
import type { Environment } from '../world/Environment';
import type { CameraRig } from './CameraRig';

export interface Ctx {
  game: Game;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  input: Input;
  audio: Audio;
  progress: Progress;
  settings: Settings;
  world: World;
  ocean: Ocean;
  env: Environment;
  player: Player;
  companion: Companion;
  ship: Ship;
  combat: Combat;
  particles: Particles;
  fx: Effects;
  ui: UI;
  projectiles: Projectiles;
  encounters: Encounters;
  cam: CameraRig;
  time: number; // scaled game time
  dt: number;
  timeScale: number;
}

export const ctx = {} as Ctx;
