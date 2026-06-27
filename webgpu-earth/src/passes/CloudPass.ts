// =============================================================================
// CloudPass.ts  (Pass 3 — Volumetric Clouds)
// Full-screen ray-march, alpha-blended ("over") onto the HDR target. Depth is
// read (to occlude behind the limb is handled analytically in-shader), but NOT
// written, so it never disturbs the data pass depth buffer.
// =============================================================================

import { Shaders, createModule } from '../core/ShaderLoader';
import { UniformBuffers } from '../core/Uniforms';
import { HDR_FORMAT, DEPTH_FORMAT } from './TerrainPass';

export class CloudPass {
  private pipeline: GPURenderPipeline;
  private sceneBindGroup: GPUBindGroup;
  private volBindGroup: GPUBindGroup;

  constructor(
    device: GPUDevice,
    uniforms: UniformBuffers,
    volumeView: GPUTextureView,
    volumeSampler: GPUSampler,
    lutView: GPUTextureView,
    lutSampler: GPUSampler
  ) {
    const mod = createModule(device, Shaders.clouds, 'clouds');

    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      label: 'cloud_pipeline',
      vertex: { module: mod, entryPoint: 'vs' },
      fragment: {
        module: mod,
        entryPoint: 'fs',
        targets: [
          {
            format: HDR_FORMAT,
            // Premultiplied "over": dst = src.rgb + dst.rgb*(1-src.a)
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: DEPTH_FORMAT,
        depthWriteEnabled: false, // read-only; preserve terrain depth for data pass
        depthCompare: 'less-equal',
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
    this.volBindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: volumeView },
        { binding: 1, resource: volumeSampler },
        { binding: 2, resource: lutView },
        { binding: 3, resource: lutSampler },
      ],
    });
  }

  draw(pass: GPURenderPassEncoder): void {
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.sceneBindGroup);
    pass.setBindGroup(1, this.volBindGroup);
    pass.draw(3); // full-screen triangle
  }
}
