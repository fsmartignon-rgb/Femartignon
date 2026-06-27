# TAKEDA Cinematic Earth — WebGPU / WGSL Architecture (v4.0)

A production-ready, fully procedural AAA Earth for the **Takeda Global
Intelligence Grid**. Every environmental element — continents, terrain relief,
ocean bathymetry, volumetric clouds, and atmospheric scattering — is generated
**natively on the GPU**. No external textures or asset files are used.

The globe is a high-fidelity *visual foundation*: the data layers (nodes, arcs,
telemetry, HUD) remain dominant, performant, and perfectly composited via an
explicit depth-stencil contract (Pass 4).

> WebGL fallback: `../takeda-globe-3d.html` (Three.js build) for browsers
> without WebGPU.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| GPU API | **Raw WebGPU** | Direct control over multi-pass scheduling, RenderBundles, and depth-stencil state — none of which need a scene-graph abstraction here. |
| Shading | **WGSL** | Compute (LUTs, noise volume) + render in one language. |
| App framework | Component-based TypeScript modules | One responsibility per file; passes are independently testable. |
| Math | `gl-matrix` | Battle-tested mat4/vec3. |
| Bundler | **Vite** (`esnext`) | `.wgsl?raw` includes, top-level await, fast HMR. |

```
npm install
npm run dev      # http://localhost:5173  (Chrome/Edge 113+, Safari 18+)
npm run build    # tsc --noEmit + vite build -> dist/
```

---

## 1 · Procedural asset generation (no textures)

| Element | Technique | File |
|---|---|---|
| Continents / land mask | Domain-warped **fBm** gradient noise | `shaders/common/noise.wgsl` → `fbm3`, `shaders/common/scene.wgsl` → `surfaceElevation` |
| Terrain relief & normals | **Ridged fBm** + finite-difference normals on the displaced surface | `shaders/terrain.vertex.wgsl` |
| Ocean bathymetry | Negative branch of the shared elevation field + mid-ocean ridge detail | `scene.wgsl` → `surfaceElevation` |
| 3D cloud density | **Perlin-Worley** baked into a 128³ volume by a compute shader | `shaders/cloud_noise.compute.wgsl` → `CloudVolumePass` |
| Sphere geometry | WGS84 ellipsoidal equirectangular lattice generated in TypeScript | `src/geometry/EllipsoidGeometry.ts` |

The vertex displacement and the fragment albedo read from the **same**
`surfaceElevation()` function, so relief and shading can never disagree.

---

## 2 · Pipeline architecture

```
[ init once ]  CloudVolumePass.bake()              compute → 128³ Perlin-Worley volume
[ on sun Δ ]   AtmosphereComputePass.execute()     compute → 256×64 Rayleigh/Mie LUT
──────────────────────────────────────────────────────────────────── per frame
 Pass A · HDR scene target (rgba16float) + depth24plus
   1. TerrainPass   — RenderBundle replay, depth WRITE on            (Pass 1)
   2. CloudPass     — full-screen ray-march, depth READ, "over" blend (Pass 3)
   3. DataPass      — instanced nodes, depth TEST only, additive glow  (Pass 4 data)
 Pass B · Swapchain
   4. CompositePass — ACES tonemap + grade + vignette + sRGB encode    (Pass 4 present)
```

- **RenderBundles** (`TerrainPass.record()`) collapse the heavy ellipsoid draw
  to a single CPU-cheap `executeBundles` replay each frame.
- The **atmosphere LUT** is recomputed only when the sun direction changes by
  more than ~1.8° (`RenderGraph.maybeUpdateLUT`), so the scattering compute pass
  is effectively free during interaction.
- The cloud volume is baked **once** (re-bake on a slow timer for evolving
  weather is a one-line call to `CloudVolumePass.bake`).

### Depth-stencil contract (the Pass 4 requirement)

| Pass | `depthCompare` | `depthWriteEnabled` | Rationale |
|---|---|---|---|
| Terrain | `less` | **true** | Establishes the canonical depth buffer. |
| Clouds | `less-equal` | **false** | Occluded by the globe (analytically + via depth) but must not overwrite terrain depth. |
| **Data / UI** | `less-equal` | **false** | Screen-space data is **depth-tested** so it hides behind the front of the planet, yet **write-disabled** so high-altitude terrain and clouds can never clip into or z-fight the nodes. Additive blending keeps the network reading brightly over any surface. |

This is the explicit rule requested: *data layers utilize depth-testing but
write-disabled states to prevent data from clipping into high-altitude terrain.*

---

## 3 · Vertex shader (`terrain.vertex.wgsl`)

- Projects a unit geocentric direction onto the **exact WGS84 ellipsoid**
  (`ellipsoidPoint` solves the scale `t` that lands `t·d` on
  `x²/a² + y²/a² + z²/b² = 1`).
- Displaces along the **geodetic** normal (`normalize(p / radii²)`) by the shared
  procedural elevation.
- Recovers a perturbed normal from finite differences of the elevation field and
  emits a full **TBN basis**, plus **view dir**, **light dir**, **UV**, and the
  raw geocentric direction for the fragment stage.

---

## 4 · Fragment shader (the cinematic core, `terrain.fragment.wgsl`)

- **PBR BRDF** — Cook-Torrance GGX (`D_GGX`, `V_SmithGGX`, `F_Schlick`).
- **Bathymetry albedo** — ocean lerps from deep indigo `#0B132B` → coastal teal
  `#48CAE4` by `smoothstep` over depth; ocean **roughness clamped > 0.6** and
  `f0 = 0.02` so specular glare never competes with the data layers.
- **Day/night terminator** — sharp-yet-soft `smoothstep(-0.06, 0.06, N·L)`.
- **Golden city lights** `#FFB703` — a high-frequency Worley "settlement" field,
  gated to the **night** hemisphere and clustered near procedural **coastlines**
  (`|elevation|` small), with a gentle twinkle.
- **Atmospheric scattering** — samples the precomputed Rayleigh/Mie LUT for
  ambient sky-fill and aerial perspective.
- **Premium Fresnel rim** — `pow(1−N·V, 5)` modulated by LUT transmittance, so
  the horizon blends into space with **no banding or hard cutoff**.

Volumetric clouds (`clouds.wgsl`) ray-march the baked 3D volume through a
spherical shell, apply **soft self-shadowing** (3 light taps) and
Henyey-Greenstein forward scatter, and **hard-cap opacity** to the configurable
`cloudMaxOpacity` uniform (default 0.28, within the required 0.10–0.35) so data
nodes are never occluded.

---

## 5 · Data layer integration

`src/data/DataLayers.ts` ports the Takeda site/route dataset and places nodes
with `geodeticToScene()` (full WGS84 geodetic→ECEF with prime-vertical radius),
so markers register exactly with the rendered terrain. Nodes draw in **one
instanced call**. `routeEndpoints()` exposes scene-space arc endpoints for the
HTML HUD projector.

---

## File map

```
webgpu-earth/
├─ index.html                         HUD overlay + canvas + WebGPU fallback
├─ src/
│  ├─ main.ts                         bootstrap, frame loop, solar position
│  ├─ core/
│  │  ├─ Device.ts                    adapter/device/context + DPR resize
│  │  ├─ ShaderLoader.ts              resolves WGSL includes, compile diagnostics
│  │  ├─ Uniforms.ts                  std140 packing of Camera/Planet/Sun/Style
│  │  └─ CameraController.ts          inertial orbit + auto-showcase
│  ├─ geometry/EllipsoidGeometry.ts   WGS84 lattice + geodetic→scene
│  ├─ passes/
│  │  ├─ AtmosphereComputePass.ts     Pass 2 — Rayleigh/Mie LUT
│  │  ├─ CloudVolumePass.ts           3D Perlin-Worley bake
│  │  ├─ TerrainPass.ts               Pass 1 — RenderBundle
│  │  ├─ CloudPass.ts                 Pass 3 — volumetrics
│  │  └─ CompositePass.ts             Pass 4 — tonemap/grade
│  ├─ data/DataLayers.ts              Pass 4 — dominant nodes/arcs
│  └─ pipeline/RenderGraph.ts         framebuffers + multi-pass schedule
└─ shaders/
   ├─ common/{noise,scene}.wgsl       fBm / Perlin-Worley + shared uniforms
   ├─ terrain.vertex.wgsl             WGS84 projection + displacement
   ├─ terrain.fragment.wgsl          PBR + bathymetry + terminator + rim
   ├─ atmosphere_lut.compute.wgsl     scattering LUT
   ├─ cloud_noise.compute.wgsl        3D density volume
   ├─ clouds.wgsl                     ray-march pass
   └─ composite.wgsl                  ACES + grade + sRGB
```

## Verification

- `npm run build` — TypeScript `--noEmit` clean, Vite bundle succeeds.
- All six WGSL modules parse under `wgsl_reflect`.
- Authored headless (no GPU in CI): load in a WebGPU browser to validate
  visually. Color is encoded for the non-sRGB swapchain in `composite.wgsl`.
