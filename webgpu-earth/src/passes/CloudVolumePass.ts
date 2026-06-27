// =============================================================================
// CloudVolumePass.ts  (Pass 3 prerequisite)
// Bakes the tiling 3D Perlin-Worley cloud density volume once at init.
// =============================================================================

import { Shaders, createModule } from '../core/ShaderLoader';

const VOL = 128; // 128³ rgba8 = 8 MB (r8unorm is not storage-capable in core WebGPU)

export class CloudVolumePass {
  readonly volume: GPUTexture;
  readonly volumeView: GPUTextureView;
  private pipeline: GPUComputePipeline;
  private params: GPUBuffer;
  private bindGroup: GPUBindGroup;

  constructor(device: GPUDevice) {
    this.volume = device.createTexture({
      size: [VOL, VOL, VOL],
      dimension: '3d',
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      label: 'cloud_volume',
    });
    this.volumeView = this.volume.createView();

    this.params = device.createBuffer({
      size: 4 * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // baseFreq, detailFreq, seed, unused
    device.queue.writeBuffer(
      this.params, 0, new Float32Array([4.0, 16.0, 7.13, 0.0])
    );

    const module = createModule(device, Shaders.cloudNoise, 'cloud_noise');
    this.pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });
    this.bindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.params } },
        { binding: 1, resource: this.volumeView },
      ],
    });
  }

  /** One-shot bake (call inside an encoder at startup, or to re-roll weather). */
  bake(encoder: GPUCommandEncoder): void {
    const pass = encoder.beginComputePass({ label: 'cloud_bake' });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    const g = Math.ceil(VOL / 4);
    pass.dispatchWorkgroups(g, g, g);
    pass.end();
  }
}
