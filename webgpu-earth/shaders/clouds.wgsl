// =============================================================================
// clouds.wgsl  (Pass 3 — Volumetric Clouds)
// Full-screen ray-march through a spherical cloud shell using the baked 3D
// Perlin-Worley volume. Output is premultiplied RGBA for over-compositing on
// the terrain pass. Opacity is hard-capped (10%-35%) so data nodes never occlude.
// Prepended at load time with: scene.wgsl
// =============================================================================

@group(1) @binding(0) var volTex     : texture_3d<f32>;
@group(1) @binding(1) var volSampler : sampler;
@group(1) @binding(2) var lutTex     : texture_2d<f32>;
@group(1) @binding(3) var lutSampler : sampler;

struct VSOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) ndc : vec2<f32>,
};

// Full-screen triangle — no vertex buffer.
@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VSOut {
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0)
  );
  var out: VSOut;
  out.clip = vec4<f32>(p[vid], 0.0, 1.0);
  out.ndc  = p[vid];
  return out;
}

// Ray-sphere intersection; returns vec2(tNear, tFar), tNear<0 if inside.
fn raySphere(ro: vec3<f32>, rd: vec3<f32>, radius: f32) -> vec2<f32> {
  let b = dot(ro, rd);
  let c = dot(ro, ro) - radius * radius;
  let disc = b * b - c;
  if (disc < 0.0) { return vec2<f32>(1.0, -1.0); }   // miss (near>far)
  let s = sqrt(disc);
  return vec2<f32>(-b - s, -b + s);
}

// Sample cloud density at a world point inside the shell.
fn cloudDensity(worldPos: vec3<f32>, shellInner: f32, shellOuter: f32) -> f32 {
  let r = length(worldPos);
  // Height fraction within the shell (0 base .. 1 top).
  let hf = clamp((r - shellInner) / max(shellOuter - shellInner, 1e-4), 0.0, 1.0);
  // Vertical coverage profile: rounded base, eroded anvil top.
  let profile = smoothstep(0.0, 0.15, hf) * (1.0 - smoothstep(0.55, 1.0, hf));

  // Map world direction to volume coords (rotate into model space, then sample
  // by direction + slow drift for moving weather).
  let modelDir = normalize((uPlanet.invRotation * vec4<f32>(worldPos, 0.0)).xyz);
  let drift = vec3<f32>(uStyle.params.x * 0.003, 0.0, uStyle.params.x * 0.001);
  let uvw = modelDir * 0.5 + vec3<f32>(0.5) + drift;
  let raw = textureSampleLevel(volTex, volSampler, fract(uvw), 0.0).r;

  // Coverage threshold from style (cloudCoverage in params2.z).
  let cov = uStyle.params2.z;
  let shaped = clamp(remap(raw, 1.0 - cov, 1.0, 0.0, 1.0), 0.0, 1.0);
  return shaped * profile;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  // Reconstruct world-space ray from clip coordinates.
  let nearClip = uCamera.invViewProj * vec4<f32>(in.ndc, 0.0, 1.0);
  let farClip  = uCamera.invViewProj * vec4<f32>(in.ndc, 1.0, 1.0);
  let nearW = nearClip.xyz / nearClip.w;
  let farW  = farClip.xyz / farClip.w;
  let ro = uCamera.position.xyz;
  let rd = normalize(farW - nearW);

  let Rp        = uPlanet.radii.x;                       // surface radius
  let shellH    = uStyle.params2.w;                      // cloud layer height
  let inner     = Rp + shellH * 0.4;
  let outer     = Rp + shellH * 1.4;

  // March only the segment of the ray inside the outer shell and in front of
  // the solid planet (analytic occlusion — clouds never draw behind the globe).
  let hitOuter = raySphere(ro, rd, outer);
  if (hitOuter.x > hitOuter.y) { return vec4<f32>(0.0); } // missed atmosphere
  let hitPlanet = raySphere(ro, rd, Rp);

  var tStart = max(hitOuter.x, 0.0);
  var tEnd   = hitOuter.y;
  if (hitPlanet.x <= hitPlanet.y && hitPlanet.x > 0.0) {
    tEnd = min(tEnd, hitPlanet.x);                        // stop at the surface
  }
  if (tEnd <= tStart) { return vec4<f32>(0.0); }

  // Skip the empty inner core: clamp start to the inner shell entry if ahead.
  let hitInner = raySphere(ro, rd, inner);
  if (hitInner.x > 0.0 && hitInner.x < tEnd) { tStart = max(tStart, 0.0); }

  let L = normalize(uSun.direction.xyz);
  let STEPS = 48;
  let dt = (tEnd - tStart) / f32(STEPS);

  var transmittance = 1.0;
  var scattered = vec3<f32>(0.0);
  let sunCol = uSun.color.rgb * uSun.color.a;
  // Henyey-Greenstein-ish forward scatter toward the sun.
  let cosA = dot(rd, L);
  let g = 0.35;
  let phase = (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g - 2.0 * g * cosA, 1.5));

  for (var i = 0; i < STEPS; i = i + 1) {
    let t = tStart + (f32(i) + 0.5) * dt;
    let pos = ro + rd * t;
    let dens = cloudDensity(pos, inner, outer);
    if (dens <= 0.001) { continue; }

    // Soft self-shadow: 3 light taps toward the sun.
    var shadow = 1.0;
    let ls = (outer - inner) / 4.0;
    for (var k = 1; k <= 3; k = k + 1) {
      let sp = pos + L * (ls * f32(k));
      shadow = shadow * exp(-cloudDensity(sp, inner, outer) * ls * 2.0);
    }

    let sigma = dens * 3.0;                               // extinction
    let stepT = exp(-sigma * dt);
    // In-scattered light this step (Beer-Lambert + powder sugar edge).
    let powder = 1.0 - exp(-sigma * 2.0);
    let lightE = sunCol * shadow * phase * powder * dens;
    scattered = scattered + transmittance * lightE * dt * 2.0;
    transmittance = transmittance * stepT;
    if (transmittance < 0.02) { break; }
  }

  var alpha = 1.0 - transmittance;
  // Hard cap so clouds never dominate the data layers.
  let maxOpacity = uStyle.params.y;                       // 0.10 .. 0.35
  alpha = min(alpha, maxOpacity);

  // Tint shadowed cloud bodies toward the atmosphere ambient.
  let amb = textureSampleLevel(lutTex, lutSampler, vec2<f32>(0.5, 0.6), 0.0).rgb;
  let color = scattered + amb * alpha * 0.25;

  // Premultiplied output for straightforward "over" compositing.
  return vec4<f32>(color, alpha);
}
