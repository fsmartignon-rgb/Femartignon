// =============================================================================
// noise.wgsl — GPU procedural noise primitives
// fBm gradient noise (continents / terrain / bathymetry) + Perlin-Worley (clouds)
// Self-contained: no external textures. Included via string concatenation by the
// shader loader before any module that calls these functions.
// =============================================================================

// --- Integer hashing (PCG-style, deterministic, no trig) ---------------------
fn hash_u(p: u32) -> u32 {
  var v = p * 747796405u + 2891336453u;
  v = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u;
  return (v >> 22u) ^ v;
}

fn hash3i(c: vec3<i32>) -> u32 {
  let x = u32(c.x) * 1934371u;
  let y = u32(c.y) * 2654435761u;
  let z = u32(c.z) * 805459861u;
  return hash_u(x ^ y ^ z);
}

// Unit-range hash in [0,1)
fn hash3f(c: vec3<i32>) -> f32 {
  return f32(hash3i(c)) * (1.0 / 4294967296.0);
}

// Generic value remap helper used across passes.
fn remap(v: f32, inMin: f32, inMax: f32, outMin: f32, outMax: f32) -> f32 {
  return outMin + (v - inMin) * (outMax - outMin) / max(inMax - inMin, 1e-5);
}

// Random gradient unit vector for a lattice cell (Perlin gradient noise).
fn grad3(c: vec3<i32>) -> vec3<f32> {
  let h = hash3i(c);
  // Decorrelate three axes from a single 32-bit hash.
  let gx = f32((h        ) & 1023u) * (1.0 / 1023.0) * 2.0 - 1.0;
  let gy = f32((h >> 10u ) & 1023u) * (1.0 / 1023.0) * 2.0 - 1.0;
  let gz = f32((h >> 20u ) & 1023u) * (1.0 / 1023.0) * 2.0 - 1.0;
  let g  = vec3<f32>(gx, gy, gz);
  let l  = max(length(g), 1e-5);
  return g / l;
}

// Quintic smootherstep fade (C2 continuous) for artifact-free interpolation.
fn fade3(t: vec3<f32>) -> vec3<f32> {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

// --- Perlin gradient noise in [-1,1] -----------------------------------------
fn perlin3(p: vec3<f32>) -> f32 {
  let pi = floor(p);
  let pf = p - pi;
  let ci = vec3<i32>(pi);
  let w  = fade3(pf);

  // Eight corner dot products of gradient and offset.
  let n000 = dot(grad3(ci + vec3<i32>(0,0,0)), pf - vec3<f32>(0.0,0.0,0.0));
  let n100 = dot(grad3(ci + vec3<i32>(1,0,0)), pf - vec3<f32>(1.0,0.0,0.0));
  let n010 = dot(grad3(ci + vec3<i32>(0,1,0)), pf - vec3<f32>(0.0,1.0,0.0));
  let n110 = dot(grad3(ci + vec3<i32>(1,1,0)), pf - vec3<f32>(1.0,1.0,0.0));
  let n001 = dot(grad3(ci + vec3<i32>(0,0,1)), pf - vec3<f32>(0.0,0.0,1.0));
  let n101 = dot(grad3(ci + vec3<i32>(1,0,1)), pf - vec3<f32>(1.0,0.0,1.0));
  let n011 = dot(grad3(ci + vec3<i32>(0,1,1)), pf - vec3<f32>(0.0,1.0,1.0));
  let n111 = dot(grad3(ci + vec3<i32>(1,1,1)), pf - vec3<f32>(1.0,1.0,1.0));

  let nx00 = mix(n000, n100, w.x);
  let nx10 = mix(n010, n110, w.x);
  let nx01 = mix(n001, n101, w.x);
  let nx11 = mix(n011, n111, w.x);
  let nxy0 = mix(nx00, nx10, w.y);
  let nxy1 = mix(nx01, nx11, w.y);
  return mix(nxy0, nxy1, w.z);
}

// --- Worley / cellular noise (returns nearest feature distance F1 in [0,1]) ---
fn worley3(p: vec3<f32>, freq: f32) -> f32 {
  let pp = p * freq;
  let pi = floor(pp);
  let pf = pp - pi;
  var f1 = 1.0e9;
  for (var k = -1; k <= 1; k = k + 1) {
    for (var j = -1; j <= 1; j = j + 1) {
      for (var i = -1; i <= 1; i = i + 1) {
        let g = vec3<i32>(i, j, k);
        let cell = vec3<i32>(pi) + g;
        // Jittered feature point inside the neighbour cell.
        let jitter = vec3<f32>(
          hash3f(cell * 3 + vec3<i32>(0,11,23)),
          hash3f(cell * 3 + vec3<i32>(37,0,5)),
          hash3f(cell * 3 + vec3<i32>(17,29,0))
        );
        let feature = vec3<f32>(g) + jitter - pf;
        f1 = min(f1, dot(feature, feature));
      }
    }
  }
  return sqrt(f1);
}

// --- Fractional Brownian Motion (continents, terrain relief, bathymetry) -----
// octaves summed with lacunarity 2.0, gain 0.5; remapped to [0,1].
fn fbm3(p: vec3<f32>, octaves: i32, lacunarity: f32, gain: f32) -> f32 {
  var sum  = 0.0;
  var amp  = 0.5;
  var freq = 1.0;
  var norm = 0.0;
  for (var o = 0; o < octaves; o = o + 1) {
    sum  = sum + amp * perlin3(p * freq);
    norm = norm + amp;
    freq = freq * lacunarity;
    amp  = amp * gain;
  }
  return (sum / max(norm, 1e-5)) * 0.5 + 0.5;
}

// Ridged fBm — sharp ridge lines for mountain spines / coastlines.
fn ridged3(p: vec3<f32>, octaves: i32) -> f32 {
  var sum  = 0.0;
  var amp  = 0.5;
  var freq = 1.0;
  var norm = 0.0;
  for (var o = 0; o < octaves; o = o + 1) {
    let n = 1.0 - abs(perlin3(p * freq));
    sum  = sum + amp * n * n;
    norm = norm + amp;
    freq = freq * 2.0;
    amp  = amp * 0.5;
  }
  return sum / max(norm, 1e-5);
}

// --- Perlin-Worley remap (cloud base density) --------------------------------
// Billowy Worley layered over Perlin gives the characteristic cumulus look.
fn perlinWorley(p: vec3<f32>) -> f32 {
  let pn = fbm3(p, 5, 2.0, 0.5);                  // [0,1] billows
  let w0 = 1.0 - worley3(p, 1.0);
  let w1 = 1.0 - worley3(p, 2.0);
  let w2 = 1.0 - worley3(p, 4.0);
  let wfbm = w0 * 0.625 + w1 * 0.25 + w2 * 0.125; // worley fBm
  // Remap perlin by worley to dilate billows (Schneider / Horizon technique).
  return clamp(remap(pn, wfbm - 1.0, 1.0, 0.0, 1.0), 0.0, 1.0);
}
