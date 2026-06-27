// =============================================================================
// DataLayers.ts  (Pass 4 — Data & UI compositing)
// The network nodes + cold-chain arcs are the DOMINANT layer. They render into
// the HDR target AFTER terrain+clouds with:
//   depthCompare: 'less-equal'  (occluded correctly by the front of the globe)
//   depthWriteEnabled: false    (never clip into high-altitude terrain/clouds)
//   additive blend              (glow that reads over any surface)
// This is the explicit depth-stencil rule requested: data is depth-TESTED but
// depth-WRITE-disabled so it composites cleanly without z-fighting the relief.
// =============================================================================

import { geodeticToScene } from '../geometry/EllipsoidGeometry';
import { UniformBuffers } from '../core/Uniforms';
import { HDR_FORMAT, DEPTH_FORMAT } from '../passes/TerrainPass';

export interface Site {
  id: string;
  city: string;
  lat: number;
  lon: number;
  role: string;
  color: [number, number, number];
}

export interface Route {
  from: string;
  to: string;
}

// Ported from the existing Takeda Global Intelligence Grid dataset.
export const SITES: Site[] = [
  { id: 'tok', city: 'Tokyo', lat: 35.68, lon: 139.69, role: 'GLOBAL HQ', color: [0.882, 0.145, 0.106] },
  { id: 'bos', city: 'Boston', lat: 42.36, lon: -71.06, role: 'R&D HUB', color: [0.224, 0.84, 1.0] },
  { id: 'zur', city: 'Zürich', lat: 47.37, lon: 8.54, role: 'EU OPS', color: [0.224, 0.84, 1.0] },
  { id: 'sgp', city: 'Singapore', lat: 1.35, lon: 103.82, role: 'APAC DC', color: [0.224, 0.84, 1.0] },
  { id: 'sao', city: 'São Paulo', lat: -23.55, lon: -46.63, role: 'LATAM', color: [1.0, 0.72, 0.01] },
  { id: 'osa', city: 'Osaka', lat: 34.69, lon: 135.5, role: 'MFG', color: [1.0, 0.72, 0.01] },
];

export const ROUTES: Route[] = [
  { from: 'tok', to: 'bos' }, { from: 'tok', to: 'sgp' }, { from: 'tok', to: 'osa' },
  { from: 'bos', to: 'zur' }, { from: 'zur', to: 'sgp' }, { from: 'sao', to: 'bos' },
];

const NODE_WGSL = /* wgsl */ `
struct Camera { viewProj: mat4x4<f32>, invViewProj: mat4x4<f32>, view: mat4x4<f32>, position: vec4<f32>, nearFar: vec4<f32> };
@group(0) @binding(0) var<uniform> cam : Camera;
@group(0) @binding(1) var<uniform> uTime : vec4<f32>;

struct Instance { @location(0) center: vec3<f32>, @location(1) color: vec3<f32> };
struct VSOut { @builtin(position) clip: vec4<f32>, @location(0) uv: vec2<f32>, @location(1) color: vec3<f32> };

@vertex
fn vs(@builtin(vertex_index) vid: u32, inst: Instance) -> VSOut {
  // Camera-facing quad (billboard) sized in world units.
  var corners = array<vec2<f32>,6>(
    vec2(-1.,-1.), vec2(1.,-1.), vec2(-1.,1.), vec2(-1.,1.), vec2(1.,-1.), vec2(1.,1.));
  let c = corners[vid];
  let right = vec3(cam.view[0].x, cam.view[1].x, cam.view[2].x);
  let up    = vec3(cam.view[0].y, cam.view[1].y, cam.view[2].y);
  let size = 0.05;
  let world = inst.center + (right * c.x + up * c.y) * size;
  var o: VSOut;
  o.clip = cam.viewProj * vec4(world, 1.0);
  o.uv = c;
  o.color = inst.color;
  return o;
}

@fragment
fn fs(i: VSOut) -> @location(0) vec4<f32> {
  let d = length(i.uv);
  if (d > 1.0) { discard; }
  let core = smoothstep(1.0, 0.0, d);
  let pulse = 0.6 + 0.4 * sin(uTime.x * 3.0);
  let glow = pow(core, 2.5) * pulse;
  return vec4(i.color * glow * 3.0, glow);
}
`;

export class DataPass {
  private pipeline: GPURenderPipeline;
  private instanceBuf: GPUBuffer;
  private timeBuf: GPUBuffer;
  private bindGroup: GPUBindGroup;
  private count: number;
  private sceneById = new Map<string, [number, number, number]>();

  constructor(private device: GPUDevice, uniforms: UniformBuffers) {
    // Build instance buffer: [cx,cy,cz, r,g,b] per node.
    const data = new Float32Array(SITES.length * 6);
    SITES.forEach((s, i) => {
      const p = geodeticToScene(s.lat, s.lon, 80_000); // 80 km above surface
      this.sceneById.set(s.id, p);
      data.set([p[0], p[1], p[2], s.color[0], s.color[1], s.color[2]], i * 6);
    });
    this.count = SITES.length;

    this.instanceBuf = device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.instanceBuf, 0, data);

    this.timeBuf = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const mod = device.createShaderModule({ code: NODE_WGSL, label: 'data_nodes' });
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      label: 'data_pipeline',
      vertex: {
        module: mod,
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: 6 * 4,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x3' },
            ],
          },
        ],
      },
      fragment: {
        module: mod,
        entryPoint: 'fs',
        targets: [
          {
            format: HDR_FORMAT,
            // Additive glow — data reads brightly over terrain & clouds.
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: DEPTH_FORMAT,
        depthWriteEnabled: false, // <-- key rule: test only, never write
        depthCompare: 'less-equal',
      },
    });

    this.bindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniforms.camera } },
        { binding: 1, resource: { buffer: this.timeBuf } },
      ],
    });
  }

  /** Route endpoints in scene space — consumed by an arc renderer / HUD projector. */
  routeEndpoints(): Array<{ a: [number, number, number]; b: [number, number, number] }> {
    return ROUTES.flatMap((r) => {
      const a = this.sceneById.get(r.from);
      const b = this.sceneById.get(r.to);
      return a && b ? [{ a, b }] : [];
    });
  }

  draw(pass: GPURenderPassEncoder, time: number): void {
    this.device.queue.writeBuffer(this.timeBuf, 0, new Float32Array([time, 0, 0, 0]));
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.instanceBuf);
    pass.draw(6, this.count); // 1 instanced draw call for all nodes
  }
}
