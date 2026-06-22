# TAKEDA Global Intelligence Grid — Rendering Upgrade Dossier

Cinematic Earth rendering overhaul for `takeda-globe-3d.html`.
Target caliber: NASA SVS · Cesium · SpaceX Mission Control · Palantir Gotham · Apple Vision Pro Earth.

> **Verification note:** this build was authored in a headless environment with no GPU,
> so it has not been visually run in a browser here. Load `takeda-globe-3d.html` in a
> WebGL-capable browser to validate. All code is syntax-checked and structured with
> procedural fallbacks so it degrades gracefully if any CDN texture fails.

---

## PHASE 1 — FULL AUDIT (original build)

| Subsystem | Original state | Problem preventing AAA quality |
|---|---|---|
| **Rendering pipeline** | Single forward pass + Bloom + FXAA | No HDR-correct chain, FXAA softens everything, no color grade / output pass |
| **Materials** | Hand-rolled `ShaderMaterial` for Earth | Not PBR — no energy conservation, flat response, no IBL participation |
| **Lighting** | One directional + ambient, `useLegacyLights` default | Non-physical intensities, no environment fill, dull terminator |
| **Shaders** | Custom day/night blend | Day texture darkened by clouds + warm tint → "not faithful to Blue Marble" |
| **Textures** | day / night / water / clouds only (2K), no normal/rough/displacement | No surface relief, no real roughness → plastic look, no zoom fidelity |
| **Camera** | OrbitControls + linear fly | Damping only; no modes, no cinematic easing/momentum framing |
| **Atmosphere** | Fresnel shell `R·1.16` + halo `R·1.42` | Halo **oversized** ("imenso"), atmosphere thin/weak, not sun-reactive scattering |
| **Clouds** | Single Lambert shell, opacity 0.42 | Flat, no lighting, no thickness/shadow, no depth |
| **Performance** | Fixed quality, no governor | No mobile path, no LOD, no adaptive degradation |
| **GPU** | 12 separate marker draw calls, per-frame line math | Avoidable draw calls; no instancing |
| **Visual** | Strong scanlines (.06) + grain (.05), neon palette | Reads as a *Three.js demo / toy*, not enterprise software |

**Root cause of "infidelity":** custom shader washed the Blue Marble albedo and there was
no relief (normal/displacement), so even when the texture loaded it looked synthetic.

---

## PHASE 2–10 — WHAT WAS IMPLEMENTED

### Phase 2 · Photorealistic Earth (PBR)
- Replaced the custom Earth shader with **`MeshPhysicalMaterial`**.
- Maps wired: `map` (Blue Marble albedo), `roughnessMap`, `metalnessMap`, `normalMap`,
  `displacementMap`, `emissiveMap` (night lights).
- `normalMap` is **derived from the real NASA elevation (topology) map** via a Sobel pass
  on a canvas — real terrain relief, **no extra CDN dependency**.
- `roughnessMap` = inverted ocean/specular map (oceans glossy, land matte).
- `metalnessMap` keeps water a low dielectric bias (physically correct — water is not metal).
- `displacementMap` at a **physically-scaled** `0.006` (real Everest ≈ 0.0014·R) so relief
  reads on zoom **without clipping the cloud deck**.
- `onBeforeCompile` injection makes **city lights emit only on the night hemisphere**,
  driven by the live sun direction.

### Phase 3 · Cinematic atmosphere (scattering approximation)
- New back-side scattering shell at a **tight `R·1.025`** (no more giant halo).
- Fragment model: **Rayleigh** blue limb + **Mie** forward-scatter glow toward the sun +
  **terminator / sunset** warm band, all **reacting to live sun position**.
- A subtle outer halo trimmed from `1.42 → 1.07` purely to feed bloom on the limb.

### Phase 4 · Volumetric-style clouds
- Replaced the flat shell with **multi-layer parallax cloud shells** (2 on desktop, 1 mobile)
  at different radii/speeds, **sun-lit** with a **self-shadow / thickness approximation**.
- *Honest scope:* this is a performant parallax stand-in, **not** a true ray-marched
  volumetric — full volumetrics at 60 fps in a single file is out of scope.

### Phase 5 · HDR / IBL pipeline
- **PMREM** environment generated from a procedural space scene → physically-correct fill
  and ocean reflections. `renderer.useLegacyLights = false` (the modern name for the old
  `physicallyCorrectLights = true`, and the r160 default — set explicitly for intent).

### Phase 6 · Cinematic post-processing
- `EffectComposer`: **RenderPass → SMAA → UnrealBloom → Grade → OutputPass(ACES)**.
- **SMAA** replaces FXAA (sharper). **Grade pass** does cool-shadow/warm-highlight color
  grading, **procedural lens dirt**, **vignette**, and **film grain** — restrained, no gaming look.
- Tone mapping centralized in `OutputPass` (ACES Filmic).

### Phase 7 · Cinematic camera
- OrbitControls inertia/damping + eased fly-to. Three **modes** cycled on the first control
  button: **ORBIT → EXECUTIVE** (slow showcase + gentle bob) **→ MISSION** (fixed 3/4 framing).
- **Flyover tour** auto-showcases hubs.

### Phase 8 · Space environment
- Shader-point **starfield** with per-star size/brightness, a **procedural Milky Way band**
  on a far back-side sphere, restrained **nebula** sprites, and **subtle parallax** rotation.

### Phase 9 · Data-viz enhancement
- Arcs are now **shader-driven** with an animated **energy-flow** pulse and faded endpoints.
- **GPU particles** stream along the great-circle routes; **expanding rings** at nodes.
- **GPU instancing** for the 12 node cores (`InstancedMesh`, one draw call, instanced colors).

### Phase 10 · Performance
- **Device tiering** (`Q`): DPR cap, sphere tessellation, cloud-layer count, SMAA/particles,
  star count all scale for mobile.
- **Adaptive governor:** sustained < 45 fps sheds the 2nd cloud layer, lowers bloom, and
  drops pixel ratio — protecting interactivity. Frustum culling is automatic; instancing and
  shared materials cut draw calls.

---

## PHASE 11 — DELIVERABLE

### Change log (high level)
- ❌ removed: custom Earth shader, FXAA, oversized halo, single flat cloud shell, strong scanlines.
- ✅ added: PBR Earth + derived normal/rough/metal maps, scattering atmosphere, multi-layer
  clouds, PMREM/IBL, SMAA + grade/lens-dirt/vignette/grain, Milky Way, shader arcs + particles,
  instanced nodes, camera modes, device tiering + adaptive governor.

### Before → After
| | Before | After |
|---|---|---|
| Earth | custom shader, flat, washed albedo | `MeshPhysicalMaterial`, real relief, faithful Blue Marble |
| Surface maps | 4 (color only) | 7 (albedo, night, clouds + derived normal/rough/metal/displacement) |
| Atmosphere | fresnel shell + huge halo | Rayleigh+Mie scattering, sun-reactive, tight limb |
| Clouds | 1 flat layer | 2 lit, self-shadowed parallax layers |
| AA | FXAA | SMAA |
| Post | Bloom only | Bloom + color grade + lens dirt + vignette + grain + ACES |
| Lighting | non-physical | physically-correct + PMREM IBL |
| Nodes | 12 draw calls | 1 instanced draw call |
| Arcs | static tubes | shader energy-flow + GPU particles |
| Camera | orbit + fly | orbit / executive / mission + showcase |
| Perf | fixed | tiered + adaptive 60-fps governor |

### FPS analysis (expected, hardware-dependent)
- **Desktop (discrete GPU):** 60 fps at DPR≤2, 220² Earth, 2 cloud layers, full post.
- **Integrated GPU:** ~45–60; governor trims 2nd cloud + bloom if it dips.
- **Mobile:** tier drops DPR≤1.5, 96² Earth, 1 cloud, no SMAA/particles → targets 40–60.
- Dominant costs: bloom + scattering fill-rate, then Earth displacement vertex count.

### Visual architecture
```
                       ┌──────────── SCENE GRAPH ────────────┐
  Sun (dir light) ───► │  world(group)                       │
  PMREM env  ─────────►│   ├─ Earth  MeshPhysicalMaterial     │
  Ambient/rim ───────► │   │    (albedo/normal/rough/metal/   │
                       │   │     displacement/emissive+night) │
                       │   ├─ Clouds × N  (lit parallax)      │
                       │   ├─ Atmosphere  (Rayleigh+Mie)      │
                       │   ├─ Halo (limb bloom feed)          │
                       │   ├─ Arcs (energy-flow) + particles  │
                       │   ├─ Nodes (InstancedMesh) + rings   │
                       │   └─ Graticule                       │
                       │  Starfield · Milky Way · Nebula      │
                       └──────────────────────────────────────┘
                                       │
   POST:  RenderPass ─► SMAA ─► Bloom ─► Grade(dirt/vignette/grain) ─► OutputPass(ACES) ─► screen
                                       │
   HTML HUD overlay (labels projected each frame, occlusion-culled)
```

### Every rendering improvement, why it matters
1. **PBR Earth** — energy-conserving response = believable land/ocean under any sun angle.
2. **Derived normal + displacement** — real relief; holds up on zoom (Phase 2 requirement).
3. **Sun-aware night lights** — cities glow only at night, like astronaut photography.
4. **Rayleigh+Mie atmosphere** — blue limb + sunset terminator that tracks the sun.
5. **Lit multi-layer clouds** — depth + shadow instead of a flat decal.
6. **PMREM/IBL + physical lights** — correct reflections and fill, no fake constants.
7. **SMAA + ACES + grade** — film-grade edges, tone, and a restrained corporate color story.
8. **Instancing + adaptive governor** — fewer draw calls, protected 60 fps, mobile path.
9. **Shader arcs + particles** — a living "global intelligence network", not static lines.
10. **Trimmed halo + killed scanlines/neon** — removes the "demo/toy" tells.
