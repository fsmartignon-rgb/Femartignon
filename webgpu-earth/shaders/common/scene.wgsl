// =============================================================================
// scene.wgsl — shared uniform layouts (group 0) for every render pass.
// std140-compatible packing: vec4 alignment, scalars packed into vec4 tails.
// =============================================================================

struct Camera {
  viewProj      : mat4x4<f32>,   // world -> clip
  invViewProj   : mat4x4<f32>,   // clip  -> world (ray reconstruction)
  view          : mat4x4<f32>,
  position      : vec4<f32>,     // xyz = eye world pos, w = exposure
  nearFar       : vec4<f32>,     // x=near y=far z=tanHalfFovY w=aspect
};

struct Planet {
  // WGS84 ellipsoid radii in scene units (km / 1000). x=a(equatorial) y=b(polar)
  radii         : vec4<f32>,     // xyz = a,a,b  w = atmosphere top radius
  rotation      : mat4x4<f32>,   // model rotation (sidereal spin)
  invRotation   : mat4x4<f32>,
};

struct Sun {
  direction     : vec4<f32>,     // xyz = world-space dir TO sun (normalised)
  color         : vec4<f32>,     // rgb radiance, a = intensity
};

struct Style {
  oceanDeep     : vec4<f32>,     // #0B132B deep indigo
  oceanShallow  : vec4<f32>,     // #48CAE4 coastal teal
  cityLight     : vec4<f32>,     // #FFB703 golden city glow
  params        : vec4<f32>,     // x=time y=cloudMaxOpacity z=cityIntensity w=seaLevel
  params2       : vec4<f32>,     // x=terrainAmp y=rimStrength z=cloudCoverage w=cloudHeight
};

@group(0) @binding(0) var<uniform> uCamera : Camera;
@group(0) @binding(1) var<uniform> uPlanet : Planet;
@group(0) @binding(2) var<uniform> uSun    : Sun;
@group(0) @binding(3) var<uniform> uStyle  : Style;

const PI      : f32 = 3.141592653589793;
const INV_PI  : f32 = 0.3183098861837907;
const EPS     : f32 = 1.0e-4;

// WGS84 surface height field shared by vertex displacement and fragment shading
// so relief and albedo are derived from the *same* procedural source of truth.
// Returns signed elevation in [-1,1]: <0 ocean bathymetry, >0 land terrain.
fn surfaceElevation(unitPos: vec3<f32>) -> f32 {
  let seaLevel = uStyle.params.w;
  // Continental mask: low-frequency fBm warped by a second fBm (domain warp).
  let warp = vec3<f32>(
    fbm3(unitPos * 1.7 + vec3<f32>(13.1, 0.0, 0.0), 4, 2.0, 0.5),
    fbm3(unitPos * 1.7 + vec3<f32>(0.0, 27.3, 0.0), 4, 2.0, 0.5),
    fbm3(unitPos * 1.7 + vec3<f32>(0.0, 0.0, 41.7), 4, 2.0, 0.5)
  ) - 0.5;
  let continents = fbm3(unitPos * 2.1 + warp * 0.9, 6, 2.0, 0.5);
  let land = continents - seaLevel;            // >0 land, <0 ocean
  if (land >= 0.0) {
    // Land: add ridged mountain detail scaled by how far inland.
    let mountains = ridged3(unitPos * 9.0, 5);
    let detail    = fbm3(unitPos * 22.0, 5, 2.0, 0.5) - 0.5;
    return clamp(land * 3.0 + mountains * 0.35 * smoothstep(0.0, 0.15, land) + detail * 0.05, 0.0, 1.0);
  }
  // Ocean: bathymetry deepens away from coast, with mid-ocean ridge detail.
  let depth = land;                            // negative
  let ridge = ridged3(unitPos * 6.0, 4) * 0.15;
  return clamp(depth * 2.5 + ridge - 0.02, -1.0, 0.0);
}
