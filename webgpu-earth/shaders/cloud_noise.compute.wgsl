// =============================================================================
// cloud_noise.compute.wgsl  (Pass 3 prerequisite)
// Bakes a tiling 3D Perlin-Worley density volume into an r8unorm storage
// texture, sampled by the volumetric cloud ray-march. Dispatched once at init
// (and optionally re-baked on a slow timer for evolving weather).
// Prepended at load time with: noise.wgsl
// =============================================================================

struct CloudBake {
  params : vec4<f32>,   // x=baseFreq y=detailFreq z=seed w=unused
};

@group(0) @binding(0) var<uniform> B : CloudBake;
// rgba8unorm is a core storage-capable format (r8unorm is not); density in .r.
@group(0) @binding(1) var volOut : texture_storage_3d<rgba8unorm, write>;

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(volOut);
  if (gid.x >= dims.x || gid.y >= dims.y || gid.z >= dims.z) { return; }

  // Normalised volume coordinate in [0,1)^3, tileable.
  let p = (vec3<f32>(gid) + vec3<f32>(0.5)) / vec3<f32>(dims);
  let seed = vec3<f32>(B.params.z);

  // Low-frequency Perlin-Worley base shape.
  let base = perlinWorley(p * B.params.x + seed);

  // High-frequency Worley detail to erode the base edges (wispy borders).
  let d0 = 1.0 - worley3(p * B.params.y + seed,        1.0);
  let d1 = 1.0 - worley3(p * B.params.y * 2.0 + seed,  1.0);
  let d2 = 1.0 - worley3(p * B.params.y * 4.0 + seed,  1.0);
  let detail = d0 * 0.625 + d1 * 0.25 + d2 * 0.125;

  // Erode base by detail near its low-density fringes (Schneider remap).
  var density = remap(base, detail * 0.35, 1.0, 0.0, 1.0);
  density = clamp(density, 0.0, 1.0);

  textureStore(volOut, vec3<i32>(gid), vec4<f32>(density, 0.0, 0.0, 0.0));
}
