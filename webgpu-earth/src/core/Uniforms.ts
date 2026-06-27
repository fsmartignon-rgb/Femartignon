// =============================================================================
// Uniforms.ts — CPU-side packing of the group(0) uniform blocks declared in
// scene.wgsl. Layout matches WGSL std140-style alignment (vec4 granularity).
// =============================================================================

import { mat4, vec3 } from 'gl-matrix';

// Byte sizes (floats * 4). Keep in lockstep with scene.wgsl.
const CAMERA_FLOATS = 16 + 16 + 16 + 4 + 4; // 56
const PLANET_FLOATS = 4 + 16 + 16; // 36
const SUN_FLOATS = 4 + 4; // 8
const STYLE_FLOATS = 4 + 4 + 4 + 4 + 4; // 20

export interface SceneState {
  view: mat4;
  proj: mat4;
  eye: vec3;
  near: number;
  far: number;
  fovY: number;
  aspect: number;
  exposure: number;

  planetRotation: mat4;
  radii: [number, number, number];
  atmosphereTop: number;

  sunDir: vec3; // world dir TO sun
  sunColor: [number, number, number];
  sunIntensity: number;

  time: number;
  cloudMaxOpacity: number; // 0.10 .. 0.35
  cityIntensity: number;
  seaLevel: number;
  terrainAmp: number;
  rimStrength: number;
  cloudCoverage: number;
  cloudHeight: number;
}

const hexToRgbLinear = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16);
  const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
  // sRGB -> linear.
  return srgb.map((c) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  ) as [number, number, number];
};

export const Palette = {
  oceanDeep: hexToRgbLinear('#0B132B'),
  oceanShallow: hexToRgbLinear('#48CAE4'),
  cityLight: hexToRgbLinear('#FFB703'),
} as const;

export class UniformBuffers {
  readonly camera: GPUBuffer;
  readonly planet: GPUBuffer;
  readonly sun: GPUBuffer;
  readonly style: GPUBuffer;

  private camData = new Float32Array(CAMERA_FLOATS);
  private planetData = new Float32Array(PLANET_FLOATS);
  private sunData = new Float32Array(SUN_FLOATS);
  private styleData = new Float32Array(STYLE_FLOATS);

  private invViewProj = mat4.create();
  private viewProj = mat4.create();
  private invRotation = mat4.create();

  constructor(private device: GPUDevice) {
    const mk = (size: number, label: string) =>
      device.createBuffer({
        size: size * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label,
      });
    this.camera = mk(CAMERA_FLOATS, 'u_camera');
    this.planet = mk(PLANET_FLOATS, 'u_planet');
    this.sun = mk(SUN_FLOATS, 'u_sun');
    this.style = mk(STYLE_FLOATS, 'u_style');
  }

  update(s: SceneState): void {
    mat4.multiply(this.viewProj, s.proj, s.view);
    mat4.invert(this.invViewProj, this.viewProj);

    // --- Camera ---
    let o = 0;
    this.camData.set(this.viewProj, o); o += 16;
    this.camData.set(this.invViewProj, o); o += 16;
    this.camData.set(s.view, o); o += 16;
    this.camData.set([s.eye[0], s.eye[1], s.eye[2], s.exposure], o); o += 4;
    this.camData.set(
      [s.near, s.far, Math.tan(s.fovY * 0.5), s.aspect], o
    );
    this.device.queue.writeBuffer(this.camera, 0, this.camData);

    // --- Planet ---
    mat4.invert(this.invRotation, s.planetRotation);
    o = 0;
    this.planetData.set(
      [s.radii[0], s.radii[1], s.radii[2], s.atmosphereTop], o
    ); o += 4;
    this.planetData.set(s.planetRotation, o); o += 16;
    this.planetData.set(this.invRotation, o);
    this.device.queue.writeBuffer(this.planet, 0, this.planetData);

    // --- Sun ---
    this.sunData.set([s.sunDir[0], s.sunDir[1], s.sunDir[2], 0], 0);
    this.sunData.set(
      [s.sunColor[0], s.sunColor[1], s.sunColor[2], s.sunIntensity], 4
    );
    this.device.queue.writeBuffer(this.sun, 0, this.sunData);

    // --- Style ---
    o = 0;
    this.styleData.set([...Palette.oceanDeep, 1], o); o += 4;
    this.styleData.set([...Palette.oceanShallow, 1], o); o += 4;
    this.styleData.set([...Palette.cityLight, 1], o); o += 4;
    this.styleData.set(
      [s.time, s.cloudMaxOpacity, s.cityIntensity, s.seaLevel], o
    ); o += 4;
    this.styleData.set(
      [s.terrainAmp, s.rimStrength, s.cloudCoverage, s.cloudHeight], o
    );
    this.device.queue.writeBuffer(this.style, 0, this.styleData);
  }

  destroy(): void {
    this.camera.destroy();
    this.planet.destroy();
    this.sun.destroy();
    this.style.destroy();
  }
}
