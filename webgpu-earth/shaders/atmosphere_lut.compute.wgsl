// =============================================================================
// atmosphere_lut.compute.wgsl  (Pass 2 — Compute Atmosphere)
// Precomputes a 2D Rayleigh+Mie single-scattering + transmittance LUT.
//   x (u) = view zenith cosine remapped [0,1]
//   y (v) = sun  zenith cosine remapped [0,1]
//   rgb   = in-scattered radiance toward the viewer
//   a     = average transmittance along the view ray (used for rim falloff)
// Dispatched once per sun-direction change (cheap; 256x64 typical).
// =============================================================================

struct AtmoParams {
  betaRayleigh : vec4<f32>,   // rgb scattering coeff (per scene unit), a=unused
  betaMie      : vec4<f32>,   // rgb scattering coeff, a = Mie g (anisotropy)
  heights      : vec4<f32>,   // x=Rayleigh scale H, y=Mie scale H, z=atmo thickness, w=planetRadius
  sunColor     : vec4<f32>,   // rgb * intensity in a
};

@group(0) @binding(0) var<uniform> P : AtmoParams;
@group(0) @binding(1) var lutOut : texture_storage_2d<rgba16float, write>;

const PI : f32 = 3.141592653589793;
const SAMPLES      : i32 = 32;   // primary ray steps
const LIGHT_STEPS  : i32 = 8;    // optical-depth-to-sun steps

fn rayleighPhase(c: f32) -> f32 {
  return (3.0 / (16.0 * PI)) * (1.0 + c * c);
}

fn miePhase(c: f32, g: f32) -> f32 {
  let g2 = g * g;
  let num = (1.0 - g2) * (1.0 + c * c);
  let den = (2.0 + g2) * pow(1.0 + g2 - 2.0 * g * c, 1.5);
  return (3.0 / (8.0 * PI)) * num / max(den, 1e-5);
}

// Distance from a point along a direction to the outer atmosphere shell.
fn atmosphereDistance(origin: vec3<f32>, dir: vec3<f32>, radius: f32) -> f32 {
  let b = dot(origin, dir);
  let c = dot(origin, origin) - radius * radius;
  let disc = b * b - c;
  if (disc < 0.0) { return 0.0; }
  return -b + sqrt(disc);
}

fn densityAt(h: f32, scaleH: f32) -> f32 {
  return exp(-max(h, 0.0) / scaleH);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(lutOut);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }

  let u = (f32(gid.x) + 0.5) / f32(dims.x);   // view zenith cosine [0,1]
  let v = (f32(gid.y) + 0.5) / f32(dims.y);   // sun  zenith cosine [0,1]

  let muV = u * 2.0 - 1.0;
  let muS = v * 2.0 - 1.0;

  let Rp = P.heights.w;                        // planet radius
  let Ra = Rp + P.heights.z;                   // atmosphere top radius
  let Hr = P.heights.x;
  let Hm = P.heights.y;
  let g  = P.betaMie.a;

  // Viewer just above the surface looking up at zenith angle acos(muV).
  let origin = vec3<f32>(0.0, Rp + 1.0, 0.0);
  let viewDir = normalize(vec3<f32>(sqrt(max(1.0 - muV * muV, 0.0)), muV, 0.0));
  let sunDir  = normalize(vec3<f32>(sqrt(max(1.0 - muS * muS, 0.0)), muS, 0.0));

  let cosVL = dot(viewDir, sunDir);
  let phaseR = rayleighPhase(cosVL);
  let phaseM = miePhase(cosVL, g);

  let tMax = atmosphereDistance(origin, viewDir, Ra);
  let dt   = tMax / f32(SAMPLES);

  var sumR = vec3<f32>(0.0);
  var sumM = vec3<f32>(0.0);
  var odR  = 0.0;   // accumulated optical depth (Rayleigh)
  var odM  = 0.0;   // accumulated optical depth (Mie)

  for (var i = 0; i < SAMPLES; i = i + 1) {
    let t = (f32(i) + 0.5) * dt;
    let pos = origin + viewDir * t;
    let h   = length(pos) - Rp;

    let dR = densityAt(h, Hr) * dt;
    let dM = densityAt(h, Hm) * dt;
    odR = odR + dR;
    odM = odM + dM;

    // Optical depth from sample point to the sun.
    var odRl = 0.0;
    var odMl = 0.0;
    let tl = atmosphereDistance(pos, sunDir, Ra);
    let dtl = tl / f32(LIGHT_STEPS);
    for (var j = 0; j < LIGHT_STEPS; j = j + 1) {
      let pl = pos + sunDir * ((f32(j) + 0.5) * dtl);
      let hl = length(pl) - Rp;
      odRl = odRl + densityAt(hl, Hr) * dtl;
      odMl = odMl + densityAt(hl, Hm) * dtl;
    }

    // Combined transmittance (view path so far + light path).
    let tau = P.betaRayleigh.rgb * (odR + odRl)
            + P.betaMie.rgb      * 1.1 * (odM + odMl);
    let transmittance = exp(-tau);

    sumR = sumR + transmittance * dR;
    sumM = sumM + transmittance * dM;
  }

  let inscatter = (sumR * P.betaRayleigh.rgb * phaseR
                 + sumM * P.betaMie.rgb      * phaseM) * P.sunColor.rgb * P.sunColor.a;

  // Average view-ray transmittance for the rim falloff term.
  let viewTau = P.betaRayleigh.rgb * odR + P.betaMie.rgb * 1.1 * odM;
  let viewTrans = exp(-dot(viewTau, vec3<f32>(0.3333)));

  textureStore(lutOut, vec2<i32>(gid.xy), vec4<f32>(inscatter, viewTrans));
}
