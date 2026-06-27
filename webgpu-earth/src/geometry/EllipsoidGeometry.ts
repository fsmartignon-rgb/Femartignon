// =============================================================================
// EllipsoidGeometry.ts
// Procedurally generates a high-density WGS84 ellipsoidal vertex grid (an
// equirectangular UV-sphere). Each vertex carries:
//   - unit geocentric direction (vec3)  -> shader places it on the ellipsoid
//   - equirectangular UV (vec2)          -> (lon,lat) parameterisation
// We deliberately upload *unit directions* (not pre-projected positions) so the
// vertex shader applies the exact WGS84 projection + procedural displacement on
// the GPU and stays consistent with the fragment elevation field.
// =============================================================================

export const WGS84 = {
  // Semi-axes in metres; the scene works in "scene units" = metres / 1e6.
  A_METRES: 6_378_137.0, // equatorial
  B_METRES: 6_356_752.314245, // polar
  SCALE: 1e-6,
} as const;

export interface EllipsoidMesh {
  /** interleaved [dx,dy,dz, u,v] * vertexCount, Float32 */
  vertices: Float32Array<ArrayBuffer>;
  /** triangle indices, Uint32 */
  indices: Uint32Array<ArrayBuffer>;
  vertexCount: number;
  indexCount: number;
  /** scene-unit radii a,a,b for the uniform buffer */
  radii: [number, number, number];
}

/**
 * @param lonSegments longitude divisions (>= 8)
 * @param latSegments latitude divisions (>= 4)
 */
export function buildEllipsoid(
  lonSegments = 512,
  latSegments = 256
): EllipsoidMesh {
  const cols = lonSegments + 1;
  const rows = latSegments + 1;
  const vertexCount = cols * rows;

  // 5 floats per vertex: 3 dir + 2 uv.
  const vertices = new Float32Array(vertexCount * 5);
  let p = 0;

  for (let y = 0; y < rows; y++) {
    // v in [0,1] -> latitude phi in [-PI/2, +PI/2]
    const v = y / latSegments;
    const phi = (v - 0.5) * Math.PI;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);

    for (let x = 0; x < cols; x++) {
      // u in [0,1] -> longitude lambda in [-PI, +PI]
      const u = x / lonSegments;
      const lambda = (u - 0.5) * 2.0 * Math.PI;
      const cosLam = Math.cos(lambda);
      const sinLam = Math.sin(lambda);

      // Geocentric unit direction (Y-up). Longitude wraps around Y.
      const dx = cosPhi * sinLam;
      const dy = sinPhi;
      const dz = cosPhi * cosLam;

      vertices[p++] = dx;
      vertices[p++] = dy;
      vertices[p++] = dz;
      vertices[p++] = u;
      vertices[p++] = v;
    }
  }

  // Two triangles per quad. Skip degenerate polar rows on the seam naturally.
  const quadRows = latSegments;
  const quadCols = lonSegments;
  const indices = new Uint32Array(quadRows * quadCols * 6);
  let i = 0;
  for (let y = 0; y < quadRows; y++) {
    for (let x = 0; x < quadCols; x++) {
      const a = y * cols + x;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      // CCW winding for front faces (outside the sphere).
      indices[i++] = a; indices[i++] = c; indices[i++] = b;
      indices[i++] = b; indices[i++] = c; indices[i++] = d;
    }
  }

  const a = WGS84.A_METRES * WGS84.SCALE;
  const bAxis = WGS84.B_METRES * WGS84.SCALE;

  return {
    vertices,
    indices,
    vertexCount,
    indexCount: indices.length,
    radii: [a, a, bAxis],
  };
}

/**
 * Convert geodetic (lat°, lon°, height m) -> scene-unit world position on/above
 * the WGS84 ellipsoid. Used by the data layer to place nodes & route arcs so
 * they register exactly with the rendered terrain.
 */
export function geodeticToScene(
  latDeg: number,
  lonDeg: number,
  heightM = 0
): [number, number, number] {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const a = WGS84.A_METRES;
  const b = WGS84.B_METRES;
  const e2 = 1 - (b * b) / (a * a); // first eccentricity squared
  const sinLat = Math.sin(lat);
  const N = a / Math.sqrt(1 - e2 * sinLat * sinLat); // prime vertical radius

  const cosLat = Math.cos(lat);
  const X = (N + heightM) * cosLat * Math.sin(lon);
  const Y = (N * (1 - e2) + heightM) * sinLat;
  const Z = (N + heightM) * cosLat * Math.cos(lon);

  return [X * WGS84.SCALE, Y * WGS84.SCALE, Z * WGS84.SCALE];
}
