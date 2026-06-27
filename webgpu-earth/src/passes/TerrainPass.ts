// =============================================================================
// TerrainPass.ts  (Pass 1 — Opaque & Terrain)
// Renders the WGS84 ellipsoid with the procedural PBR + bathymetry shader into
// the HDR target with depth write ON. Records a RenderBundle so the per-frame
// draw is a single CPU-cheap replay.
// =============================================================================

import { Shaders, createModule } from '../core/ShaderLoader';
import { buildEllipsoid, EllipsoidMesh } from '../geometry/EllipsoidGeometry';
import { UniformBuffers } from '../core/Uniforms';

export const HDR_FORMAT: GPUTextureFormat = 'rgba16float';
export const DEPTH_FORMAT: GPUTextureFormat = 'depth24plus';

export class TerrainPass {
  readonly mesh: EllipsoidMesh;
  private vbo: GPUBuffer;
  private ibo: GPUBuffer;
  private pipeline: GPURenderPipeline;
  private sceneBindGroup: GPUBindGroup;
  private lutBindGroup: GPUBindGroup;
  private bundle: GPURenderBundle;

  constructor(
    private device: GPUDevice,
    uniforms: UniformBuffers,
    lutView: GPUTextureView,
    lutSampler: GPUSampler,
    lonSeg = 512,
    latSeg = 256
  ) {
    this.mesh = buildEllipsoid(lonSeg, latSeg);

    this.vbo = device.createBuffer({
      size: this.mesh.vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      label: 'ellipsoid_vbo',
    });
    device.queue.writeBuffer(this.vbo, 0, this.mesh.vertices);

    this.ibo = device.createBuffer({
      size: this.mesh.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      label: 'ellipsoid_ibo',
    });
    device.queue.writeBuffer(this.ibo, 0, this.mesh.indices);

    const vs = createModule(device, Shaders.terrainVertex, 'terrain_vs');
    const fs = createModule(device, Shaders.terrainFragment, 'terrain_fs');

    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      label: 'terrain_pipeline',
      vertex: {
        module: vs,
        entryPoint: 'main',
        buffers: [
          {
            arrayStride: 5 * 4,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' }, // unitPos
              { shaderLocation: 1, offset: 12, format: 'float32x2' }, // uv
            ],
          },
        ],
      },
      fragment: {
        module: fs,
        entryPoint: 'main',
        targets: [{ format: HDR_FORMAT }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
      depthStencil: {
        format: DEPTH_FORMAT,
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    this.sceneBindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniforms.camera } },
        { binding: 1, resource: { buffer: uniforms.planet } },
        { binding: 2, resource: { buffer: uniforms.sun } },
        { binding: 3, resource: { buffer: uniforms.style } },
      ],
    });
    this.lutBindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: lutView },
        { binding: 1, resource: lutSampler },
      ],
    });

    this.bundle = this.record();
  }

  private record(): GPURenderBundle {
    const enc = this.device.createRenderBundleEncoder({
      colorFormats: [HDR_FORMAT],
      depthStencilFormat: DEPTH_FORMAT,
    });
    enc.setPipeline(this.pipeline);
    enc.setBindGroup(0, this.sceneBindGroup);
    enc.setBindGroup(1, this.lutBindGroup);
    enc.setVertexBuffer(0, this.vbo);
    enc.setIndexBuffer(this.ibo, 'uint32');
    enc.drawIndexed(this.mesh.indexCount);
    return enc.finish({ label: 'terrain_bundle' });
  }

  get renderBundle(): GPURenderBundle {
    return this.bundle;
  }
}
