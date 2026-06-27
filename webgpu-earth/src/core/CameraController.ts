// =============================================================================
// CameraController.ts — orbiting cinematic camera with inertial damping and an
// auto-orbit showcase mode. Produces view/proj matrices for SceneState.
// =============================================================================

import { mat4, vec3 } from 'gl-matrix';

export class CameraController {
  yaw = 0.6;
  pitch = 0.3;
  distance = 18;
  target: vec3 = [0, 0, 0];

  private velYaw = 0;
  private velPitch = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  autoOrbit = true;

  readonly view = mat4.create();
  readonly proj = mat4.create();
  readonly eye: vec3 = [0, 0, 0];

  fovY = (45 * Math.PI) / 180;
  near = 0.05;
  far = 200;

  constructor(canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.autoOrbit = false;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.velYaw -= dx * 0.005;
      this.velPitch -= dy * 0.005;
    });
    const stop = () => (this.dragging = false);
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.distance = Math.min(120, Math.max(8, this.distance * (1 + e.deltaY * 0.0008)));
    }, { passive: false });
  }

  update(dt: number, aspect: number): void {
    if (this.autoOrbit) this.velYaw += dt * 0.04;
    this.yaw += this.velYaw;
    this.pitch += this.velPitch;
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch));
    // Inertial damping.
    this.velYaw *= 0.9;
    this.velPitch *= 0.9;

    const cp = Math.cos(this.pitch);
    this.eye[0] = this.target[0] + this.distance * cp * Math.sin(this.yaw);
    this.eye[1] = this.target[1] + this.distance * Math.sin(this.pitch);
    this.eye[2] = this.target[2] + this.distance * cp * Math.cos(this.yaw);

    mat4.lookAt(this.view, this.eye, this.target, [0, 1, 0]);
    mat4.perspective(this.proj, this.fovY, aspect, this.near, this.far);
  }
}
