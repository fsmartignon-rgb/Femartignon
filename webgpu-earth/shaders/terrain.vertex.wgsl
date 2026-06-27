// =============================================================================
// terrain.vertex.wgsl  (Pass 1 — Opaque & Terrain)
// Prepended at load time with: noise.wgsl + scene.wgsl
// Transforms a unit-sphere lattice onto the WGS84 ellipsoid, displaces by the
// shared procedural elevation field, and emits a complete TBN + view/light basis.
// =============================================================================

struct VSIn {
  @location(0) unitPos : vec3<f32>,   // point on unit sphere (geocentric direction)
  @location(1) uv       : vec2<f32>,  // equirectangular (lon,lat) parameterisation
};

struct VSOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) worldPos   : vec3<f32>,
  @location(1) normal     : vec3<f32>,
  @location(2) tangent    : vec3<f32>,
  @location(3) bitangent  : vec3<f32>,
  @location(4) viewDir    : vec3<f32>,   // surface -> eye
  @location(5) lightDir   : vec3<f32>,   // surface -> sun
  @location(6) uv         : vec2<f32>,
  @location(7) unitDir    : vec3<f32>,   // model-space geocentric direction
  @location(8) elevation  : f32,
};

// Map a unit direction onto the WGS84 ellipsoid surface (geocentric -> geodetic
// radius). Exact for the ellipsoid: scale each axis by its radius then the point
// lies on the ellipsoid x²/a² + y²/a² + z²/b² = 1 only after renormalisation,
// so we solve the scale t that puts (t·d) on the ellipsoid.
fn ellipsoidPoint(dir: vec3<f32>, radii: vec3<f32>) -> vec3<f32> {
  let q = dir / radii;                 // d / radii
  let t = 1.0 / length(q);             // scale so |q·t / radii|... lands on surface
  return dir * t;
}

// Geodetic (true) surface normal of the ellipsoid at a point = normalize(p / radii²).
fn ellipsoidNormal(p: vec3<f32>, radii: vec3<f32>) -> vec3<f32> {
  let r2 = radii * radii;
  return normalize(p / r2);
}

@vertex
fn main(in: VSIn) -> VSOut {
  let radii = uPlanet.radii.xyz;
  let dir   = normalize(in.unitPos);

  // --- Procedural elevation from the shared field --------------------------
  let elev = surfaceElevation(dir);                 // [-1,1]
  let amp  = uStyle.params2.x;                       // terrain amplitude (scene units)

  // Base ellipsoid surface point, then push along geodetic normal by elevation.
  let basePos   = ellipsoidPoint(dir, radii);
  let geoNormal = ellipsoidNormal(basePos, radii);
  let displaced = basePos + geoNormal * elev * amp;

  // --- Analytic-ish normal via finite differences of the elevation field ----
  // Build an orthonormal tangent frame around the geodetic normal.
  var up = vec3<f32>(0.0, 1.0, 0.0);
  if (abs(geoNormal.y) > 0.99) { up = vec3<f32>(1.0, 0.0, 0.0); }
  let tangent   = normalize(cross(up, geoNormal));
  let bitangent = normalize(cross(geoNormal, tangent));

  // Sample elevation at two angular offsets to recover slope; convert to a
  // perturbed normal in world space (relief shading on the displaced surface).
  let d = 0.0015;
  let eT = surfaceElevation(normalize(dir + tangent   * d));
  let eB = surfaceElevation(normalize(dir + bitangent * d));
  let dHdT = (eT - elev) * amp / (d * length(radii));
  let dHdB = (eB - elev) * amp / (d * length(radii));
  let perturbed = normalize(geoNormal - tangent * dHdT - bitangent * dHdB);

  // --- World transform (model rotation = sidereal spin) --------------------
  let worldPos = (uPlanet.rotation * vec4<f32>(displaced, 1.0)).xyz;
  let worldNrm = normalize((uPlanet.rotation * vec4<f32>(perturbed, 0.0)).xyz);
  let worldTan = normalize((uPlanet.rotation * vec4<f32>(tangent,   0.0)).xyz);
  let worldBit = normalize((uPlanet.rotation * vec4<f32>(bitangent, 0.0)).xyz);

  var out: VSOut;
  out.clip      = uCamera.viewProj * vec4<f32>(worldPos, 1.0);
  out.worldPos  = worldPos;
  out.normal    = worldNrm;
  out.tangent   = worldTan;
  out.bitangent = worldBit;
  out.viewDir   = normalize(uCamera.position.xyz - worldPos);
  out.lightDir  = normalize(uSun.direction.xyz);
  out.uv        = in.uv;
  out.unitDir   = dir;
  out.elevation = elev;
  return out;
}
