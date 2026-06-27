// =============================================================================
// Device.ts — WebGPU adapter/device acquisition + canvas context configuration.
// =============================================================================

export interface GpuContext {
  adapter: GPUAdapter;
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat; // preferred swapchain format (*-srgb)
  canvas: HTMLCanvasElement;
}

export async function initWebGPU(canvas: HTMLCanvasElement): Promise<GpuContext> {
  if (!navigator.gpu) {
    throw new Error('WebGPU is not available in this browser.');
  }
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) throw new Error('No suitable GPUAdapter found.');

  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageTexturesPerShaderStage: 4,
      maxComputeWorkgroupStorageSize: 16384,
    },
  });

  device.lost.then((info) => {
    // Surface device loss to the app shell for a clean re-init.
    console.error('WebGPU device lost:', info.message, info.reason);
    window.dispatchEvent(new CustomEvent('webgpu-device-lost', { detail: info }));
  });

  const context = canvas.getContext('webgpu') as GPUCanvasContext;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: 'opaque',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });

  return { adapter, device, context, format, canvas };
}

/** Resize backing store to device pixels with a DPR cap (perf governor hook). */
export function resizeCanvas(
  canvas: HTMLCanvasElement,
  dprCap = 2
): { width: number; height: number; changed: boolean } {
  const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
  const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  const changed = canvas.width !== width || canvas.height !== height;
  if (changed) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height, changed };
}
