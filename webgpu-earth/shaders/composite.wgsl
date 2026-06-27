// =============================================================================
// composite.wgsl  (Pass 4 — Final tonemap / grade / output)
// Combines the HDR scene target (terrain + clouds + data, already blended into
// one HDR attachment) into the swapchain with ACES tonemap, a restrained
// cool-shadow/warm-highlight grade and a soft vignette. Bloomed limb is fed by
// an optional bright-pass mip chain bound as bloomTex.
// getPreferredCanvasFormat() returns a NON-sRGB format, so we apply the sRGB
// OETF here ourselves rather than relying on the swapchain to encode.
// =============================================================================

@group(0) @binding(0) var hdrTex     : texture_2d<f32>;
@group(0) @binding(1) var bloomTex   : texture_2d<f32>;
@group(0) @binding(2) var samp       : sampler;
@group(0) @binding(3) var<uniform> uExposure : vec4<f32>; // x=exposure y=bloom z=vignette w=grain

struct VSOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VSOut {
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0)
  );
  var out: VSOut;
  out.clip = vec4<f32>(p[vid], 0.0, 1.0);
  out.uv   = p[vid] * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5);
  return out;
}

// ACES filmic tonemap (Narkowicz fit).
fn aces(x: vec3<f32>) -> vec3<f32> {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn hash21(p: vec2<f32>) -> f32 {
  var h = dot(p, vec2<f32>(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

// Linear -> sRGB OETF (per channel).
fn linearToSrgb(c: vec3<f32>) -> vec3<f32> {
  let lo = c * 12.92;
  let hi = 1.055 * pow(max(c, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3<f32>(0.0031308));
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  var hdr = textureSample(hdrTex, samp, in.uv).rgb;
  let bloom = textureSample(bloomTex, samp, in.uv).rgb;
  hdr = hdr + bloom * uExposure.y;

  // Exposure.
  hdr = hdr * uExposure.x;

  // Restrained corporate grade: lift shadows cool, push highlights warm.
  let luma = dot(hdr, vec3<f32>(0.2126, 0.7152, 0.0722));
  let coolShadow = vec3<f32>(0.95, 0.98, 1.06);
  let warmHigh   = vec3<f32>(1.05, 1.0, 0.95);
  hdr = hdr * mix(coolShadow, warmHigh, smoothstep(0.0, 0.6, luma));

  // ACES filmic tonemap (operates in linear HDR).
  var col = aces(hdr);

  // Soft vignette.
  let d = distance(in.uv, vec2<f32>(0.5));
  col = col * (1.0 - smoothstep(0.55, 0.95, d) * uExposure.z);

  // Subtle film grain (temporal seed packed in grain.w upstream if desired).
  let g = (hash21(in.uv * 1024.0) - 0.5) * uExposure.w;
  col = col + vec3<f32>(g);

  // Encode to sRGB for the non-sRGB swapchain.
  col = linearToSrgb(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)));
  return vec4<f32>(col, 1.0);
}
