// =============================================================================
// terrain.fragment.wgsl  (Pass 1 — Cinematic Core)
// Prepended at load time with: noise.wgsl + scene.wgsl
// PBR GGX surface + bathymetry albedo + day/night terminator + golden city
// lights + atmospheric-scattering LUT sampling + premium Fresnel horizon rim.
// =============================================================================

// --- Pass-local bindings (group 1): atmosphere scattering LUT --------------
// LUT authored by atmosphere_lut.compute.wgsl. x axis = view zenith cosine,
// y axis = sun zenith cosine. rgb = in-scattered Rayleigh+Mie, a = transmittance.
@group(1) @binding(0) var lutTex     : texture_2d<f32>;
@group(1) @binding(1) var lutSampler : sampler;

struct FSIn {
  @location(0) worldPos  : vec3<f32>,
  @location(1) normal    : vec3<f32>,
  @location(2) tangent   : vec3<f32>,
  @location(3) bitangent : vec3<f32>,
  @location(4) viewDir   : vec3<f32>,
  @location(5) lightDir  : vec3<f32>,
  @location(6) uv        : vec2<f32>,
  @location(7) unitDir   : vec3<f32>,
  @location(8) elevation : f32,
};

struct FSOut {
  @location(0) color : vec4<f32>,   // HDR linear, premultiplied-free
};

// ---------------------------------------------------------------------------
// PBR — Cook-Torrance GGX
// ---------------------------------------------------------------------------
fn D_GGX(NoH: f32, a: f32) -> f32 {
  let a2 = a * a;
  let d  = (NoH * NoH) * (a2 - 1.0) + 1.0;
  return a2 / max(PI * d * d, 1e-7);
}

fn V_SmithGGX(NoV: f32, NoL: f32, a: f32) -> f32 {
  let a2 = a * a;
  let gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
  let gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
  return 0.5 / max(gv + gl, 1e-5);
}

fn F_Schlick(VoH: f32, f0: vec3<f32>) -> vec3<f32> {
  let f = pow(clamp(1.0 - VoH, 0.0, 1.0), 5.0);
  return f0 + (vec3<f32>(1.0) - f0) * f;
}

// ---------------------------------------------------------------------------
// Surface material assembly from the procedural elevation field
// ---------------------------------------------------------------------------
struct Surface {
  albedo    : vec3<f32>,
  roughness : f32,
  metallic  : f32,
  f0        : vec3<f32>,
  emissive  : vec3<f32>,
  isOcean   : f32,        // 1.0 ocean, 0.0 land
};

fn buildSurface(in: FSIn) -> Surface {
  var s: Surface;
  let elev = in.elevation;

  if (elev < 0.0) {
    // ---- OCEAN: bathymetry-driven albedo, deep indigo -> coastal teal ----
    let depth01 = clamp(-elev, 0.0, 1.0);                  // 0 coast .. 1 abyss
    let shallow = uStyle.oceanShallow.rgb;                 // #48CAE4
    let deep    = uStyle.oceanDeep.rgb;                    // #0B132B
    // Smooth, perceptual interpolation; bias toward teal only very near coast.
    let t = smoothstep(0.0, 0.55, depth01);
    s.albedo    = mix(shallow, deep, t);
    s.roughness = clamp(0.62 + depth01 * 0.18, 0.6, 0.85); // > 0.6 as required
    s.metallic  = 0.0;
    s.f0        = vec3<f32>(0.02);                          // low specular -> minimal glare
    s.isOcean   = 1.0;
  } else {
    // ---- LAND: biome-ish albedo from elevation + latitude + slope ----
    let lat = abs(in.unitDir.y);                           // 0 equator .. 1 pole
    let veg  = vec3<f32>(0.18, 0.32, 0.16);
    let arid = vec3<f32>(0.42, 0.35, 0.22);
    let rock = vec3<f32>(0.34, 0.32, 0.30);
    let snow = vec3<f32>(0.92, 0.94, 0.97);
    let dryness = clamp(fbm3(in.unitDir * 5.0, 4, 2.0, 0.5), 0.0, 1.0);
    var land = mix(veg, arid, dryness);
    land = mix(land, rock, smoothstep(0.25, 0.6, elev));
    // Snow caps at high latitude / high elevation.
    let snowLine = smoothstep(0.72, 0.92, lat) + smoothstep(0.45, 0.75, elev);
    land = mix(land, snow, clamp(snowLine, 0.0, 1.0));
    s.albedo    = land;
    s.roughness = clamp(0.78 - elev * 0.15, 0.45, 0.95);
    s.metallic  = 0.0;
    s.f0        = vec3<f32>(0.035);
    s.isOcean   = 0.0;
  }
  s.emissive = vec3<f32>(0.0);
  return s;
}

// ---------------------------------------------------------------------------
// Golden city lights — clustered near coastlines on the night hemisphere.
// ---------------------------------------------------------------------------
fn cityLights(in: FSIn, NoL: f32) -> vec3<f32> {
  // Coastline proximity: |elevation| small => near sea level => more habitation.
  let coast = 1.0 - smoothstep(0.0, 0.08, abs(in.elevation));
  if (coast <= 0.0001 || in.elevation < 0.0) { return vec3<f32>(0.0); }

  // High-frequency cellular field -> discrete settlement "grains".
  let cells = 1.0 - worley3(in.unitDir * 90.0, 1.0);
  let grain = smoothstep(0.78, 0.96, cells);
  // Population density falloff away from coast and toward poles.
  let lat   = abs(in.unitDir.y);
  let dens  = coast * (1.0 - smoothstep(0.55, 0.95, lat));
  let twinkle = 0.85 + 0.15 * sin(uStyle.params.x * 2.0 + cells * 40.0);

  // Only on the night side; smooth across the terminator.
  let night = smoothstep(0.08, -0.12, NoL);
  let glow  = grain * dens * twinkle * night;
  return uStyle.cityLight.rgb * glow * uStyle.params.z;   // cityIntensity
}

// ---------------------------------------------------------------------------
// Atmospheric scattering — sample precomputed Rayleigh/Mie LUT.
// ---------------------------------------------------------------------------
fn sampleAtmosphere(N: vec3<f32>, V: vec3<f32>, L: vec3<f32>) -> vec4<f32> {
  let muV = clamp(dot(N, V) * 0.5 + 0.5, 0.0, 1.0);
  let muS = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);
  return textureSample(lutTex, lutSampler, vec2<f32>(muV, muS));
}

@fragment
fn main(in: FSIn) -> FSOut {
  let N = normalize(in.normal);
  let V = normalize(in.viewDir);
  let L = normalize(in.lightDir);
  let H = normalize(V + L);

  let NoL = dot(N, L);
  let NoV = max(dot(N, V), 1e-4);
  let NoH = max(dot(N, H), 0.0);
  let VoH = max(dot(V, H), 0.0);
  let NoLc = max(NoL, 0.0);

  let surf = buildSurface(in);

  // --- Direct PBR lighting ---------------------------------------------------
  let a = surf.roughness * surf.roughness;
  let D = D_GGX(NoH, a);
  let Vis = V_SmithGGX(NoV, NoLc, a);
  let F = F_Schlick(VoH, surf.f0);
  let spec = D * Vis * F;

  let kd = (vec3<f32>(1.0) - F) * (1.0 - surf.metallic);
  let diffuse = kd * surf.albedo * INV_PI;

  let sunRadiance = uSun.color.rgb * uSun.color.a;
  var lit = (diffuse + spec) * sunRadiance * NoLc;

  // --- Soft terminator wrap + ambient sky fill ------------------------------
  // Physically-motivated sharp-yet-soft terminator: smoothstep over a narrow
  // band around NoL = 0 keeps the day/night line crisp without aliasing.
  let term = smoothstep(-0.06, 0.06, NoL);
  let atmo = sampleAtmosphere(N, V, L);
  let skyFill = atmo.rgb * surf.albedo * 0.12;             // bluish ambient bounce
  lit = lit * term + skyFill * term;

  // --- Night side: golden city lights ---------------------------------------
  let cities = cityLights(in, NoL);
  lit = lit + cities;

  // --- Aerial perspective: blend in-scattered light toward the limb ---------
  // Fresnel rim: thin premium horizon glow that fades into space artifact-free.
  let fres = pow(1.0 - NoV, 5.0);
  let rim  = fres * uStyle.params2.y * atmo.a;             // rimStrength * transmittance
  let rimColor = atmo.rgb * (0.6 + 0.4 * max(NoL, 0.0));
  lit = lit + rimColor * rim;

  // Subtle ocean sun-glint suppression already handled by low f0 + high rough.
  var out: FSOut;
  out.color = vec4<f32>(lit, 1.0);
  return out;
}
