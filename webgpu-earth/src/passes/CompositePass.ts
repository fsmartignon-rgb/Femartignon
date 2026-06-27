// =============================================================================
// CompositePass.ts  (Pass 4 — Tonemap / grade / present)
// Resolves the HDR target (terrain + clouds + data) into the sRGB swapchain.
// =============================================================================

import { Shaders, createModule } from '../core/ShaderLoader';

export class CompositePass {
  private pipeline: GPURenderPipeline;
  private params: GPUBuffer;
  private sampler: GPUSampler;
  private bindGroup: GPUBindGroup | null = null;

  constructor(private device: GPUDevice, swapFormat: GPUTextureFormat) {
    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });
    this.params = device.createBuffer({
      size: 4 * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // exposure, bloom, vignette, grain
    device.queue.writeBuffer(this.params, 0, new Float32Array([1.1, 0.85, 0.35, 0.02]));

    const mod = createModule(device, Shaders.composite, 'composite');
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      label: 'composite_pipeline',
      vertex: { module: mod, entryPoint: 'vs' },
      fragment: {
        module: mod,
        entryPoint: 'fs',
        targets: [{ format: swapFormat }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  /** Rebuild the bind group when the HDR/bloom views change (resize). */
  setInputs(hdrView: GPUTextureView, bloomView: GPUTextureView): void {
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: hdrView },
        { binding: 1, resource: bloomView },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: { buffer: this.params } },
      ],
    });
  }

  draw(pass: GPURenderPassEncoder): void {
    if (!this.bindGroup) throw new Error('CompositePass.setInputs() not called');
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);
  }
}
