// =============================================================================
// RenderGraph.ts — owns the framebuffers and the multi-pass schedule.
//
//   [once ]  CloudVolumePass.bake          (3D Perlin-Worley volume)
//   [/sun ]  AtmosphereComputePass.execute (Rayleigh/Mie LUT)  -- compute
//   ──────────────────────────────────────────────────────────── per frame
//   Pass A (HDR render pass, load=clear, depth write):
//     1. TerrainPass.renderBundle    (opaque ellipsoid, depth WRITE)
//     2. CloudPass.draw              (volumetrics, depth READ, blended)
//     3. DataPass.draw               (nodes/arcs, depth TEST only, additive)
//   Pass B (swapchain):
//     4. CompositePass.draw          (ACES tonemap + grade -> sRGB)
//
// RenderBundles keep the heavy terrain draw a single CPU replay; the LUT is only
// recomputed when the sun direction changes materially.
// =============================================================================

import { GpuContext, resizeCanvas } from '../core/Device';
import { UniformBuffers, SceneState } from '../core/Uniforms';
import { AtmosphereComputePass } from '../passes/AtmosphereComputePass';
import { CloudVolumePass } from '../passes/CloudVolumePass';
import { TerrainPass, HDR_FORMAT, DEPTH_FORMAT } from '../passes/TerrainPass';
import { CloudPass } from '../passes/CloudPass';
import { CompositePass } from '../passes/CompositePass';
import { DataPass } from '../data/DataLayers';

export interface QualityTier {
  dprCap: number;
  lonSeg: number;
  latSeg: number;
}

export class RenderGraph {
  private uniforms: UniformBuffers;
  private atmosphere: AtmosphereComputePass;
  private cloudVolume: CloudVolumePass;
  private terrain: TerrainPass;
  private clouds: CloudPass;
  private data: DataPass;
  private composite: CompositePass;

  private hdr!: GPUTexture;
  private hdrView!: GPUTextureView;
  private depth!: GPUTexture;
  private depthView!: GPUTextureView;
  private bloom!: GPUTexture; // placeholder bright-pass target (also feeds limb glow)
  private bloomView!: GPUTextureView;

  private linearSampler: GPUSampler;
  private volumeSampler: GPUSampler;
  private lastSunDir = new Float32Array(3);
  private baked = false;

  constructor(private gpu: GpuContext, tier: QualityTier) {
    const { device } = gpu;
    this.uniforms = new UniformBuffers(device);

    this.linearSampler = device.createSampler({
      magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
    });
    this.volumeSampler = device.createSampler({
      magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear',
      addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat',
    });

    // Planet radius in scene units (~6.378), atmosphere ~0.5 thick.
    const Rp = 6.378137;
    this.atmosphere = new AtmosphereComputePass(device, Rp, 0.6);
    this.cloudVolume = new CloudVolumePass(device);

    this.terrain = new TerrainPass(
      device, this.uniforms, this.atmosphere.lutView, this.linearSampler,
      tier.lonSeg, tier.latSeg
    );
    this.clouds = new CloudPass(
      device, this.uniforms,
      this.cloudVolume.volumeView, this.volumeSampler,
      this.atmosphere.lutView, this.linearSampler
    );
    this.data = new DataPass(device, this.uniforms);
    this.composite = new CompositePass(device, gpu.format);
  }

  resize(): void {
    const { changed, width, height } = resizeCanvas(this.gpu.canvas, 2);
    if (!changed && this.hdr) return;
    const device = this.gpu.device;

    const mk = (format: GPUTextureFormat, usage: number, label: string) =>
      device.createTexture({ size: [width, height, 1], format, usage, label });

    this.hdr?.destroy();
    this.depth?.destroy();
    this.bloom?.destroy();

    this.hdr = mk(HDR_FORMAT,
      GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING, 'hdr');
    this.bloom = mk(HDR_FORMAT,
      GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING, 'bloom');
    this.depth = mk(DEPTH_FORMAT, GPUTextureUsage.RENDER_ATTACHMENT, 'depth');

    this.hdrView = this.hdr.createView();
    this.bloomView = this.bloom.createView();
    this.depthView = this.depth.createView();
    this.composite.setInputs(this.hdrView, this.bloomView);
  }

  /** Re-run the atmosphere LUT only when the sun has moved enough to matter. */
  private maybeUpdateLUT(encoder: GPUCommandEncoder, sunDir: Float32Array): void {
    const dot =
      this.lastSunDir[0] * sunDir[0] +
      this.lastSunDir[1] * sunDir[1] +
      this.lastSunDir[2] * sunDir[2];
    if (dot < 0.9995 || !this.baked) {
      this.atmosphere.execute(encoder);
      this.lastSunDir.set(sunDir);
    }
  }

  render(state: SceneState): void {
    const device = this.gpu.device;
    this.resize();
    this.uniforms.update(state);

    const encoder = device.createCommandEncoder({ label: 'frame' });

    if (!this.baked) {
      this.cloudVolume.bake(encoder);
      this.baked = true;
    }
    this.maybeUpdateLUT(
      encoder,
      new Float32Array([state.sunDir[0], state.sunDir[1], state.sunDir[2]])
    );

    // ---- Pass A: HDR scene (terrain -> clouds -> data) ----
    const scenePass = encoder.beginRenderPass({
      label: 'hdr_scene',
      colorAttachments: [
        {
          view: this.hdrView,
          clearValue: { r: 0.004, g: 0.008, b: 0.02, a: 1 }, // deep space
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: this.depthView,
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    scenePass.executeBundles([this.terrain.renderBundle]); // 1) terrain
    this.clouds.draw(scenePass); // 2) volumetric clouds
    this.data.draw(scenePass, state.time); // 3) dominant data layer
    scenePass.end();

    // ---- Pass B: composite to swapchain ----
    const swapView = this.gpu.context.getCurrentTexture().createView();
    const present = encoder.beginRenderPass({
      label: 'composite',
      colorAttachments: [
        { view: swapView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' },
      ],
    });
    this.composite.draw(present);
    present.end();

    device.queue.submit([encoder.finish()]);
  }

  /** Scene-space route endpoints for the HTML HUD overlay projector. */
  get routes() {
    return this.data.routeEndpoints();
  }

  destroy(): void {
    this.uniforms.destroy();
    this.hdr?.destroy();
    this.depth?.destroy();
    this.bloom?.destroy();
  }
}
