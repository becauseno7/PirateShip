// Keyboard / mouse state with per-frame "pressed" edges and pointer lock.
export class Input {
  private down = new Set<string>();
  private pressedSet = new Set<string>();
  private releasedSet = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  mouseX = 0;
  mouseY = 0;
  locked = false;
  enabled = true;
  sensitivity = 1;
  invertY = false;
  private canvas: HTMLElement;
  onLockChange: ((locked: boolean) => void) | null = null;

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = this.norm(e.code);
      if (!this.down.has(k)) this.pressedSet.add(k);
      this.down.add(k);
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'AltLeft', 'Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      const k = this.norm(e.code);
      this.down.delete(k);
      this.releasedSet.add(k);
    });
    window.addEventListener('blur', () => this.down.clear());
    window.addEventListener('mousedown', (e) => {
      const k = 'Mouse' + e.button;
      if (!this.down.has(k)) this.pressedSet.add(k);
      this.down.add(k);
    });
    window.addEventListener('mouseup', (e) => {
      const k = 'Mouse' + e.button;
      this.down.delete(k);
      this.releasedSet.add(k);
    });
    window.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      if (this.locked) {
        // Clamp spikes some browsers emit on lock changes.
        this.mouseDX += Math.max(-250, Math.min(250, e.movementX));
        this.mouseDY += Math.max(-250, Math.min(250, e.movementY));
      }
    });
    window.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      this.onLockChange?.(this.locked);
    });
  }

  private norm(code: string) {
    if (code === 'ShiftRight') return 'ShiftLeft';
    if (code === 'ControlRight') return 'ControlLeft';
    return code;
  }

  requestLock() {
    if (!this.locked && this.canvas.requestPointerLock) {
      try {
        const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
        p?.catch?.(() => {});
      } catch { /* ignore */ }
    }
  }
  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(k: string) { return this.enabled && this.down.has(k); }
  pressed(k: string) { return this.enabled && this.pressedSet.has(k); }
  released(k: string) { return this.enabled && this.releasedSet.has(k); }
  /** Raw edge check that ignores the enabled flag (menus, cutscene skip). */
  rawPressed(k: string) { return this.pressedSet.has(k); }

  axis(neg: string, pos: string, neg2?: string, pos2?: string) {
    let v = 0;
    if (this.isDown(neg) || (neg2 && this.isDown(neg2))) v -= 1;
    if (this.isDown(pos) || (pos2 && this.isDown(pos2))) v += 1;
    return v;
  }

  consumeMouse() {
    const dx = this.mouseDX * this.sensitivity, dy = this.mouseDY * this.sensitivity * (this.invertY ? -1 : 1);
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }

  endFrame() {
    this.pressedSet.clear();
    this.releasedSet.clear();
    this.wheel = 0;
  }
}
