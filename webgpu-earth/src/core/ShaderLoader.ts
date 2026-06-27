// =============================================================================
// ShaderLoader.ts — assembles WGSL modules from the shared includes.
// WGSL has no native #include, so we concatenate the common chunks ahead of
// each entry-point module. Vite's `?raw` import keeps the .wgsl as source text.
// =============================================================================

import noise from '../../shaders/common/noise.wgsl?raw';
import scene from '../../shaders/common/scene.wgsl?raw';
import terrainVS from '../../shaders/terrain.vertex.wgsl?raw';
import terrainFS from '../../shaders/terrain.fragment.wgsl?raw';
import atmosphereCS from '../../shaders/atmosphere_lut.compute.wgsl?raw';
import cloudNoiseCS from '../../shaders/cloud_noise.compute.wgsl?raw';
import cloudsWGSL from '../../shaders/clouds.wgsl?raw';
import compositeWGSL from '../../shaders/composite.wgsl?raw';

const join = (...parts: string[]) => parts.join('\n\n');

/** Final WGSL source per pipeline stage, with includes resolved. */
export const Shaders = {
  // scene.wgsl calls fbm3/ridged3 from noise.wgsl, so noise must come first.
  terrainVertex: join(noise, scene, terrainVS),
  terrainFragment: join(noise, scene, terrainFS),
  atmosphereLUT: atmosphereCS, // self-contained (declares its own helpers)
  cloudNoise: join(noise, cloudNoiseCS),
  // clouds.wgsl uses remap() (noise) + scene structs; noise must precede scene.
  clouds: join(noise, scene, cloudsWGSL),
  composite: compositeWGSL,
} as const;

export function createModule(
  device: GPUDevice,
  code: string,
  label: string
): GPUShaderModule {
  const mod = device.createShaderModule({ code, label });
  // Surface compilation diagnostics early in dev.
  if (import.meta.env?.DEV) {
    mod.getCompilationInfo().then((info) => {
      for (const m of info.messages) {
        const where = `${label}:${m.lineNum}:${m.linePos}`;
        if (m.type === 'error') console.error(`[WGSL] ${where} ${m.message}`);
        else if (m.type === 'warning') console.warn(`[WGSL] ${where} ${m.message}`);
      }
    });
  }
  return mod;
}
