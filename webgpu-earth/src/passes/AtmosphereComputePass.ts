// =============================================================================
// AtmosphereComputePass.ts  (Pass 2)
// Computes the Rayleigh/Mie scattering + transmittance LUT into an rgba16float
// storage texture. Re-dispatched only when the sun moves materially.
// =============================================================================

import { Shaders, createModule } from '../core/ShaderLoader';

const LUT_W = 256;
const LUT_H = 64;

export class AtmosphereComputePass {
  readonly lut: GPUTexture;
  readonly lutView: GPUTextureView;
  private pipeline: GPUComputePipeline;
  private params: GPUBuffer;
  private bindGroup: GPUBindGroup;

  constructor(private device: GPUDevice, planetRadius: number, atmoThickness: number) {
    this.lut = device.createTexture({
      size: [LUT_W, LUT_H, 1],
      format: 'rgba16float',
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
      label: 'atmosphere_lut',
    });
    this.lutView = this.lut.createView();

    this.params = device.createBuffer({
      size: 4 * 4 * 4, // 4 vec4
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'atmo_params',
    });
    this.writeParams(planetRadius, atmoThickness);

    const module = createModule(device, Shaders.atmosphereLUT, 'atmosphere_lut');
    this.pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
      label: 'atmosphere_pipeline',
    });

    this.bindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.params } },
        { binding: 1, resource: this.lutView },
      ],
    });
  }

  private writeParams(Rp: number, thickness: number): void {
    // Wavelength-dependent Rayleigh (~1/λ⁴) tuned for scene-unit scale.
    const betaR = [5.8e-3, 1.35e-2, 3.31e-2];
    const betaM = 4.0e-3;
    const data = new Float32Array([
      betaR[0] * 12, betaR[1] * 12, betaR[2] * 12, 0,
      betaM, betaM, betaM, 0.76, // Mie g (anisotropy) in .a
      Rp * 0.025, Rp * 0.004, thickness, Rp, // Hr, Hm, thickness, planetRadius
      1.0, 0.98, 0.95, 22.0, // sun color * intensity
    ]);
    this.device.queue.writeBuffer(this.params, 0, data);
  }

  /** Encode the compute dispatch. */
  execute(encoder: GPUCommandEncoder): void {
    const pass = encoder.beginComputePass({ label: 'atmosphere_lut_pass' });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(LUT_W / 8), Math.ceil(LUT_H / 8), 1);
    pass.end();
  }
}
