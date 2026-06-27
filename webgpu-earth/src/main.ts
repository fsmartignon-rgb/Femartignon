// =============================================================================
// main.ts — application bootstrap. Wires the WebGPU context, render graph,
// camera, and the live sun model, then drives the frame loop. The existing
// Takeda HUD (DOM overlay) sits above the canvas unchanged; node screen
// positions are projected each frame for label placement.
// =============================================================================

import { vec3, mat4 } from 'gl-matrix';
import { initWebGPU } from './core/Device';
import { CameraController } from './core/CameraController';
import { RenderGraph, QualityTier } from './pipeline/RenderGraph';
import { SceneState } from './core/Uniforms';

function pickTier(): QualityTier {
  const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
  return mobile
    ? { dprCap: 1.5, lonSeg: 192, latSeg: 96 }
    : { dprCap: 2, lonSeg: 512, latSeg: 256 };
}

/** Sub-solar direction from a real timestamp (simplified solar position). */
function sunDirection(date: Date): vec3 {
  const dayMs = 86400000;
  const dayOfYear =
    (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) -
      Date.UTC(date.getUTCFullYear(), 0, 0)) / dayMs;
  const decl = -23.44 * Math.cos(((2 * Math.PI) / 365) * (dayOfYear + 10)) * (Math.PI / 180);
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60;
  const hourAngle = ((utcHours / 24) * 2 - 1) * Math.PI; // noon = 0
  const x = Math.cos(decl) * Math.sin(-hourAngle);
  const y = Math.sin(decl);
  const z = Math.cos(decl) * Math.cos(-hourAngle);
  const out = vec3.create();
  return vec3.normalize(out, vec3.fromValues(x, y, z));
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('gfx') as HTMLCanvasElement;
  const gpu = await initWebGPU(canvas);
  const tier = pickTier();
  const graph = new RenderGraph(gpu, tier);
  const camera = new CameraController(canvas);

  const planetRotation = mat4.create();
  const Rp = 6.378137;

  let last = performance.now();
  let spin = 0;
  let fpsEma = 60;

  function frame(now: number): void {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (dt > 0) fpsEma = fpsEma * 0.92 + (1 / dt) * 0.08;
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    camera.update(dt, aspect);

    // Sidereal spin (slow, cinematic).
    spin += dt * 0.01;
    mat4.fromYRotation(planetRotation, spin);

    const state: SceneState = {
      view: camera.view,
      proj: camera.proj,
      eye: camera.eye,
      near: camera.near,
      far: camera.far,
      fovY: camera.fovY,
      aspect,
      exposure: 1.1,

      planetRotation,
      radii: [Rp, Rp, 6.356752],
      atmosphereTop: Rp + 0.6,

      sunDir: sunDirection(new Date()),
      sunColor: [1.0, 0.97, 0.92],
      sunIntensity: 22,

      time: now / 1000,
      cloudMaxOpacity: 0.28, // within the required 0.10–0.35 cap
      cityIntensity: 1.6,
      seaLevel: 0.52,
      terrainAmp: 0.06, // scene-unit relief (~Everest scale, no cloud clip)
      rimStrength: 1.4,
      cloudCoverage: 0.42,
      cloudHeight: 0.12,
    };

    graph.render(state);
    updateHud(Math.round(fpsEma));
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.addEventListener('webgpu-device-lost', () => {
    location.reload();
  });
}

/** Refresh the existing HUD readouts (FPS, node count). */
function updateHud(fps: number): void {
  const fpsEl = document.getElementById('fps');
  if (fpsEl) fpsEl.textContent = String(fps);
}

boot().catch((err) => {
  const el = document.getElementById('fallback');
  if (el) {
    el.style.display = 'grid';
    el.querySelector('.msg')!.textContent = String(err?.message ?? err);
  }
  console.error(err);
});
