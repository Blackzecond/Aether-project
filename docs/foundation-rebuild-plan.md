# Aether Foundation Rebuild Plan

Status: proposed architecture and implementation plan  
Scope: procedural landscape foundation, with contracts reusable by later 2D / 2.5D / 3D generators  
Decision rule: preserve working project infrastructure; replace the current landscape representation behind a versioned boundary rather than patching the existing renderer.

## 1. Executive decision

Aether should move from **silhouette/layer composition** to a **world-space surface pipeline**.

The current generator has a 2D elevation array, but it does not render that field as a continuous surface. It samples three fixed depth rows into three screen-space silhouettes, places vegetation against those silhouettes, and separately projects a drainage path. The three systems therefore do not share a common geometric surface or a real depth test.

There is also a concrete parameter wiring defect: `octaves` is passed into `LandscapeOptions` but `terrainElevation()` uses hard-coded octave counts (4 and 3). The detail control therefore cannot reliably change the terrain as its label implies. The current `scale` and `roughness` controls also affect only selected noise terms/ridge widths, not clearly separated landform properties. These are architectural issues, not values to tune.

**Chosen first representation:** a 2.5D heightfield surface (world X/Z plus elevation Y), rendered as a triangulated mesh with a depth buffer. This is the right complexity/performance balance for rolling terrain, ridges, valleys, forests and rivers. It is not a universal representation: heightfields cannot represent caves, arches, vertical overhangs or multiple surfaces at one X/Z coordinate. A later volumetric/density-field representation can be added for those needs without replacing the world-coordinate, material, ecology, hydrology or renderer contracts.

Do not begin with a full voxel world or a full fluid simulation. Both add cost before the basic geometry is correct.

## 2. Non-negotiable design principles

1. **One coordinate system.** Generators produce world-space data only. They never calculate screen pixels or use camera projection.
2. **One terrain surface.** Every terrain-attached feature samples the same final, post-erosion heightfield and its derived normal/slope.
3. **Explicit dependency order.** Landform -> drainage -> channel carving/erosion -> final surface derivatives -> biomes -> placements -> rendering.
4. **No screen-space placement.** Trees, rocks, river banks and other features are positioned in world coordinates and projected only by the renderer.
5. **Deterministic independent streams.** Changing forest density must not reshuffle mountains or rivers. Use stable hash-derived random streams per subsystem and stable feature IDs.
6. **Parameters must have measurable meaning.** Every user control has a documented mathematical effect and automated sensitivity tests.
7. **Renderer-independent core.** Pure TypeScript generators return typed data. Rendering backends consume it.
8. **Budgeted by design.** Resolution, memory, instance count, generation time and render time have explicit limits.
9. **Debuggability is a feature.** Every intermediate field can be visualized independently.
10. **No visual milestone passes on unit tests alone.** Each stage needs deterministic fixtures and actual screenshot/device review.

## 3. Proposed architecture

```text
Friendly Controls / Advanced Node Graph / Code Parameters
                         |
                 Project + Parameter API
                         |
                Versioned World Recipe
                         |
               Dependency / Cache Graph
                         |
                 WORLD GENERATION
  ┌──────────────────────────────────────────────────────┐
  │ 1. Landform model                                    │
  │ 2. Elevation field + masks                           │
  │ 3. Hydrology / drainage network                      │
  │ 4. Channel incision + optional erosion               │
  │ 5. Surface derivatives (normal, slope, curvature)    │
  │ 6. Climate / moisture / biome fields                 │
  │ 7. Feature placement (trees, rocks, grass, etc.)     │
  │ 8. Mesh / instance data                               │
  └──────────────────────────────────────────────────────┘
                         |
                 Renderer-independent World
                         |
          ┌──────────────┴──────────────┐
          |                             |
     Canvas 2D backend             WebGL2 backend
     (flat 2D tools)               (2.5D / 3D scenes)
                                        |
                               optional WebGPU later
```

### Suggested module boundaries

- `src/world/coordinates.ts`: world units, axes, bounds, coordinate transforms and typed vector contracts.
- `src/world/recipe.ts`: versioned seed + parameters + generator versions.
- `src/world/fields/heightfield.ts`: elevation storage, sampling, gradients and interpolation.
- `src/world/terrain/landforms.ts`: macro terrain shape and mountain/ridge/valley primitives.
- `src/world/terrain/detail.ts`: multi-scale detail, ridged noise and domain warping.
- `src/world/hydrology/`: depression handling, flow direction, accumulation, watershed labels and channel graph.
- `src/world/erosion/`: optional bake-time hydraulic/thermal erosion.
- `src/world/ecology/`: climate, moisture, biome classification and suitability.
- `src/world/placement/`: deterministic blue-noise/Poisson placement and surface-conforming transforms.
- `src/world/mesh/`: heightfield triangulation, normals, material attributes and chunk boundaries.
- `src/render/canvas2d/`: existing 2D-only renderer, not used to fake a 3D terrain.
- `src/render/webgl2/`: 2.5D/3D renderer with depth testing, camera, lighting and instancing.
- `src/debug/`: field visualizers, overlays, probe inspector and deterministic test scenes.
- `src/workers/`: optional worker entry points for expensive generation.

Keep `src/core/graph.ts`, graph document validation, seeded random and the existing quality budget where useful. Do not make the world generator depend on the Node Editor. The friendly controls and Node Graph should both call the same versioned parameter API.

## 4. Canonical world data contracts

### 4.1 Coordinate convention

Use right-handed world coordinates:
- X: east/west
- Z: north/south (depth on the ground plane)
- Y: elevation / height

The renderer owns camera projection and converts world coordinates to clip/screen coordinates. A generator must never use canvas width/height to decide where a river or tree belongs.

### 4.2 Heightfield

A heightfield contains:
- width, height, world-space origin and sample spacing
- `Float32Array elevation`
- optional masks: land/water/rock/shore
- stable recipe hash and generator version

Required operations:
- bilinear elevation sample
- central-difference gradient
- surface normal
- slope angle / slope percent
- curvature (at least a discrete Laplacian for diagnostics and later erosion)
- world-to-grid and grid-to-world conversion

For grid spacing Δx,Δz, estimate:
`dH/dx = (H[x+1,z] - H[x-1,z]) / (2Δx)`  
`dH/dz = (H[x,z+1] - H[x,z-1]) / (2Δz)`  
A consistent upward normal is proportional to `(-dH/dx, 1, -dH/dz)`, normalized.

All downstream systems sample the same final heightfield, not a hand-selected row or approximate screen curve.

### 4.3 Derived world products

- `DrainageField`: flow direction, contributing area/accumulation, basin ID, outlet ID and channel mask.
- `RiverNetwork`: connected directed graph of world-space channel segments, each with contributing area, bed elevation, width and bank data.
- `SurfaceData`: normals, slope, curvature and optionally material weights.
- `ClimateField`: temperature, moisture and wind exposure, initially stylized rather than meteorologically exact.
- `BiomeField`: discrete biome ID plus continuous suitability weights.
- `PlacementBuffer`: world position, normal, rotation, scale, species/type, stable ID and biome.
- `TerrainMesh`: vertices, indices, normals, material/biome attributes and chunk metadata.

Typed arrays should be preferred for dense grids and instance buffers. Keep object graphs for sparse semantic structures such as river networks and feature IDs.

## 5. Terrain mathematics

Do not use one generic noise function to define the entire mountain range. Build the terrain from scales with distinct jobs.

### Stage A — macro landform

Construct a low-frequency base field from landmass masks and broad elevation functions. Define a small number of explicit landform primitives (ridge axes, mountain massifs, plateaus, basins and foothills) using distances to curves/regions and smooth blending. These establish the silhouette and the location of valleys before fine noise is added.

A ridge can use a distance-to-centerline profile, for example:
`R(x,z) = A * exp(-d(x,z)^2 / (2*sigma^2))`
where `d` is distance to a curved ridge spine. Multiple ridges should blend with smooth max / smooth union, while valleys are explicit lower corridors rather than accidental gaps between arbitrary noise peaks.

### Stage B — broad natural variation

Use seeded gradient noise or OpenSimplex2/Simplex as a broad perturbation. Use domain warping only at controlled, low frequency so it bends landforms without destroying drainage-scale structure.

### Stage C — mountain character

Use ridged multifractal noise for sharp ridges and alpine crags, with separate controls for ridge sharpness and amplitude. Use ordinary fBm for rolling variation and a higher-frequency detail field for surface texture.

A standard fBm form is:
`F(p) = sum(i=0..n-1) amplitude_i * noise(frequency_i * p)`
with `frequency_i = frequency_0 * lacunarity^i` and `amplitude_i = amplitude_0 * persistence^i`.

Do not expose raw octave count as the only “detail” control. Expose meaningful controls such as:
- Mountain scale / spacing (macro wavelength)
- Relief (vertical height range)
- Peak shape (rounded <-> sharp)
- Ridge irregularity
- Surface roughness (high-frequency amplitude)
- Detail scale (feature size)
- Detail quality (sampling resolution; performance/precision, not shape)

The UI must show a before/after preview or numeric effect for each parameter. A parameter may affect multiple derived fields only when that dependency is intentional and documented.

### Stage D — erosion (bake-time, not every frame)

Add thermal relaxation and hydraulic erosion only after the un-eroded landform and drainage are stable. Hydraulic erosion should update sediment capacity, erosion and deposition using water flux/slope/velocity; it must be a bounded generation/bake operation with iteration and time budgets. It must not run continuously while dragging a slider.

## 6. Hydrology and river construction

The existing Priority-Flood work is a useful algorithmic seed, but the current implementation is not yet a complete river system: it computes a single drainage-parent tree from the bottom edge and then forces a headwater at a hard-coded row. It does not establish a full set of valid outlets, watershed basins or a channel network.

Recommended pipeline:

1. Choose valid boundary outlets from the terrain boundary / sea-level mask.
2. Run Priority-Flood to fill or breach closed depressions according to a selectable policy. Preserve the original elevation separately; filled elevation is a hydrology aid, not the rendered terrain.
3. Compute flow direction. Start with D8 for simplicity and test multi-flow direction (MFD) where D8 produces visibly angular or biased drainage.
4. Accumulate contributing area from upstream cells to downstream cells.
5. Extract channel cells using a scale-aware contributing-area threshold; connect them into a directed river graph.
6. Smooth channel centerlines in world space while constraining them to the channel corridor and preserving downhill bed elevation.
7. Carve a channel into the terrain using a cross-section profile and a width/depth derived from contributing area. Then recompute surface derivatives and, if necessary, hydrology once more.
8. Generate water surface and banks from the same channel geometry. Water must be at or slightly above the carved bed, never a screen-space line.
9. Render with the same depth buffer as terrain so foreground ridges and banks occlude water naturally.

A first-order width relation can be parameterized as `w = k * A^b`, where `A` is contributing area and `k,b` are style/scale parameters. It is a visual model, not a universal river law. River width must be bounded by channel spacing and local valley width.

Priority-Flood is appropriate for depression resolution and drainage preprocessing. It is not, by itself, a realistic fluid simulation. Do not confuse a drainage graph with simulated water dynamics.

## 7. Ecology and object placement

Tree placement must use the final surface and ecological constraints.

For each candidate:
1. Sample final elevation, normal, slope, moisture, temperature and biome at its world coordinate.
2. Reject outside the allowed biome, above/below the species elevation band, too steep, too exposed, underwater, or inside the river/bank exclusion zone.
3. Use deterministic blue-noise / Poisson-disk spacing to avoid clumps and obvious random collisions.
4. Align the trunk base to the sampled surface normal within a species-specific limit. Keep the crown orientation mostly upright.
5. Scale species by biome/elevation and depth only when the camera makes depth scaling meaningful.
6. Store the resulting transform in a placement buffer; render with instancing or batched sprites.

Important: a mountain peak is not automatically a suitable planting surface. A slope threshold alone is insufficient; biome, substrate, elevation band and moisture also matter.

Start with a small set of stylized species and explicit ecological rules. Add richer climate simulation later.

## 8. Renderer decision

### Current 2D preview

Keep Canvas 2D for genuinely flat 2D generators and lightweight UI overlays. Do not try to make it behave like a 3D depth renderer by manually drawing three silhouettes.

### Landscape 2.5D / 3D preview

Use WebGL2 as the baseline graphics capability, with a depth buffer and a camera. A small Three.js scene layer is the preferred first implementation candidate because it provides camera, mesh, material, depth testing, raycasting and instancing without Aether owning all low-level rendering code. Load it only when a 2.5D/3D workspace is opened. Keep the generator output independent so a custom WebGL2 renderer can replace it if profiling justifies that.

WebGPU is optional future acceleration, not a startup requirement. Do not build the core around WebGPU availability.

For the first heightfield mesh, use a regular grid with indexed triangles. Compute normals from the final heightfield. Use a simple orthographic camera initially for a controllable stylized 2.5D look; add perspective camera modes after depth, scale and clipping are validated.

### Future representation

A heightfield cannot represent caves, arches, overhangs or stacked surfaces. If Aether later needs those, introduce a separate volumetric scalar/density field and a pluggable surface extractor:
- Surface Nets: smooth organic surfaces and a simpler mesh.
- Marching Cubes: established triangle extraction with well-understood trade-offs.
- Dual Contouring: candidate for preserving sharper features when a reliable Hermite-data pipeline is available.

Do not promote voxel/density terrain to the first milestone. It is a separate representation, not a patch to heightfield.

## 9. Performance and mobile strategy

- Keep the first terrain grid modest and benchmark 128², 192² and 256² rather than assuming one resolution.
- Use chunked heightfields only when world size or editing locality requires them. Chunks need a one-cell or larger halo for gradients/normals and identical shared-edge samples to prevent cracks.
- Use screen-space error / distance-based LOD later; avoid arbitrary “more detail everywhere”.
- Use typed arrays and reuse buffers. Cache each pipeline stage by dependency hash so changing forest density does not regenerate terrain or hydrology.
- Move expensive CPU generation to a Web Worker after the synchronous reference implementation is correct. Keep the same pure generator API and a main-thread fallback.
- Use instancing for repeated trees/rocks; cull by chunk and distance.
- Use conservative render pixel budgets, adaptive quality and explicit WebGL context-loss handling.
- Avoid readbacks and synchronous GPU queries in the interactive path.
- Measure generation time, frame-time percentiles, memory and instance counts on actual phones. Do not claim mobile performance based on desktop tests.

Initial preview budgets are hypotheses, not promises: aim for a 128²–192² heightfield, bounded vegetation count and a single directional light on low-tier mobile; increase only after device profiling.

## 10. Debug and verification system

Build these debug views before adding decorative content:

- Elevation heatmap
- Surface normal visualization
- Slope heatmap
- Curvature heatmap
- Hydrology filled-elevation view
- Flow-direction arrows
- Flow-accumulation heatmap
- Basin/outlet labels
- Channel mask and river cross-section
- Biome/suitability map
- Tree candidate / accepted / rejected points with rejection reason
- Mesh wireframe and triangle density
- Depth-buffer view / occlusion IDs
- World-space probe showing X/Z, elevation, slope, normal, biome and nearest river

### Automated invariants

- Same recipe + same generator versions => byte-identical field and placement output.
- Changing forest density cannot change terrain, drainage or river geometry.
- Changing water appearance cannot change terrain or drainage.
- Changing terrain relief/shape must change elevation statistics and mesh geometry by a measurable amount.
- Every river segment is connected and its bed elevation is downhill within tolerance, except explicit lakes/waterfalls.
- River channel samples remain within the carved valley corridor.
- Every tree base samples the final terrain within a small vertical tolerance.
- Every accepted tree satisfies its species slope/elevation/biome rules.
- No chunk seams: shared boundary samples and normals agree within tolerance.
- Depth test produces expected front/behind ordering in a small deterministic occlusion fixture.
- Parameter boundary tests reject NaN, infinity, negative resolutions and excessive allocation requests.

### Visual acceptance scenes

Keep at least four fixed seeds:
1. Broad rounded mountain range with one major river.
2. Sharp alpine ridge with tributaries.
3. Forested foothills with a broad valley.
4. Dry rocky terrain with sparse vegetation.

For each scene capture: beauty render, wireframe, elevation, slope, flow accumulation, biome and placement debug views. Review on a desktop browser and at least one representative Android phone before accepting a milestone.

## 11. Migration plan

Do not delete the current generator immediately. Freeze it as a legacy preview while the new pipeline is built in parallel.

### Phase 0 — Contract and baseline
- Record current live screenshots and current generation timings.
- Add architecture contracts and test fixtures.
- Fix or explicitly deprecate misleading UI controls; do not silently leave no-op parameters.
- Create a new `world-v2` path without changing the existing production preview.

Exit: data contracts, coordinate convention and parameter semantics are reviewed and tests run.

### Phase 1 — Terrain only
- Implement heightfield sampling, macro landforms, multi-scale noise and derivatives.
- Implement grid mesh and WebGL2 depth-tested preview.
- Add camera controls limited to orbit/zoom/pan appropriate for mobile.

Exit: mountains visibly change in macro silhouette, relief, peak shape and roughness independently; no river, trees or fog yet.

### Phase 2 — Surface correctness
- Add normal/slope/curvature debug views.
- Validate world-to-screen projection, mesh winding, normals, camera and occlusion.
- Add chunk seams tests even if the first preview is one chunk.

Exit: a probe on any visible surface returns the correct world position and normal; front terrain reliably occludes back terrain.

### Phase 3 — Hydrology
- Add outlets, Priority-Flood, flow direction, accumulation, basins and connected channel graph.
- Carve channels into the heightfield and rebuild mesh.
- Add river water mesh and banks.

Exit: all river segments follow the terrain, downhill, in valleys; ridges occlude the river naturally. No forced headwater coordinates.

### Phase 4 — Ecology
- Add moisture/climate fields and biome suitability.
- Add deterministic placement and surface-conforming trees/rocks.
- Add instanced rendering and rejection debug overlays.

Exit: no accepted tree floats or sits on unsuitable steep peaks; forest density changes only placement density.

### Phase 5 — Atmosphere
- Add elevation/depth-aware fog, lighting, color by altitude/material and optional shadows.
- Atmosphere samples world/camera data rather than screen-wide decorative bands.

Exit: atmospheric depth and lighting remain coherent when camera and terrain parameters change.

### Phase 6 — Performance and integration
- Add dependency cache, worker generation, chunk LOD and mobile quality tiers based on measurements.
- Connect friendly controls and advanced graph to the same parameter model.
- Keep old graph documents loadable through explicit migrations.

Exit: stable performance on target phones and no regressions in 2D workspaces.

## 12. Existing code: keep, replace, or defer

Keep:
- Seed/hash utilities, with independent subsystem streams.
- Graph evaluator, graph document validation and import/export.
- Vite/TypeScript/Vitest/CI.
- Existing mobile pixel budget as a starting policy (revisit after WebGL2 profiling).
- Canvas2D for flat 2D tools.
- Research on Abyssal Garden for density fields, Surface Nets, instancing, culling, adaptive quality and worker ideas.

Replace behind a new path:
- `src/generators/world.ts` current 96×72 world model and three depth-row sampling.
- `src/generators/landscape.ts` current three-silhouette composition, screen-space river strokes and tree placement on silhouette rows.
- `projectPoint()` in generator code; projection belongs to renderer/camera.

Defer:
- Full 3D voxel terrain.
- Real-time fluid simulation.
- Large-scale streaming worlds and geometry clipmaps until camera/world scale requires them.
- Advanced weather simulation and physically based atmosphere.
- Complex Node Editor UX; keep it advanced and let friendly controls lead.

## 13. Research references and what Aether should take from them

1. **GPU Gems 2 — Terrain Rendering Using GPU-Based Geometry Clipmaps**  
   https://developer.nvidia.com/gpugems/gpugems2/part-i-geometric-complexity/chapter-2-terrain-rendering-using-gpu-based-geometry  
   Take: heightfields as 2D elevation data, regular grids, multiresolution levels, smooth LOD transitions and normal maps. Do not implement full geometry clipmaps until Aether has a moving large-world camera.

2. **Génevaux et al. (2013), Terrain generation using procedural models based on hydrology, ACM TOG**  
   https://doi.org/10.1145/2461912.2461996  
   Take: hierarchical drainage networks and terrain construction where rivers are first-class modeling elements, not decorative strokes.

3. **Barnes et al. (2014), Priority-Flood: An optimal depression-filling and watershed-labeling algorithm for digital elevation models**  
   https://doi.org/10.1016/j.cageo.2013.04.024  
   Take: principled depression filling and drainage preprocessing; do not mistake it for full water simulation.

4. **Sebastian Weiss, Procedural Terrain (Georgia Tech project)**  
   https://www.sebastian-weiss.eu/programming/procedural-terrain/  
   Take: coarse landform definition -> user sculpting -> hydraulic erosion -> biome-aware vegetation. This order is directly relevant to Aether's pipeline.

5. **Sebastian Lague, Hydraulic Erosion**  
   https://github.com/SebLague/Hydraulic-Erosion  
   Take: a practical, inspectable erosion experiment and useful learning reference. Treat erosion as a bake step with bounded iterations.

6. **Mei, Decaudin and Hu (2007), Fast Hydraulic Erosion Simulation and Visualization on GPU**  
   https://doi.org/10.1109/PG.2007.15  
   Take: velocity/water-flow-driven erosion and sediment transport as a later GPU/bake optimization, not a prerequisite for the first terrain surface.

7. **MDN — WebGL best practices**  
   https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices  
   Take: conservative GPU memory budgets, context-loss handling, batching, reduced back-buffer resolution and avoiding blocking GPU readbacks.

8. **Abyssal Garden (existing Aether research)**  
   https://github.com/Noniv/abyssal-garden  
   Take: density fields, Surface Nets, instancing, culling, worker-friendly generation and adaptive quality. Its volumetric approach is a future representation option, not the default for the first landscape rebuild.

## 14. Risks and explicit trade-offs

- A heightfield cannot represent overhangs/caves. Accepted for the first landscape milestone; world contracts must not assume all future geometry is a heightfield.
- D8 flow can create grid bias. Begin with D8 for testability, compare MFD and use a graph representation so the algorithm can be replaced.
- Erosion can be expensive and can destroy intentional art direction. Make it optional, bounded and reproducible.
- Three.js adds bundle weight. Lazy-load the 2.5D/3D workspace and measure; do not load it into flat 2D-only sessions.
- A dense mesh can overwhelm low-end phones. Use quality tiers, screen-space LOD and actual-device profiling.
- More physically plausible algorithms do not guarantee attractive art direction. Keep high-level shape controls and curated presets on top of mathematically sound fields.

## 15. Definition of a solid foundation

The foundation is considered stable only when:
- geometry is represented continuously in world space;
- every placed object can query the surface it stands on;
- hydrology derives from terrain and modifies the same terrain;
- renderer projection and depth are separate from generation;
- parameter changes have tested, observable effects;
- generation is deterministic, cacheable and worker-portable;
- debug views can identify which stage caused a visual defect;
- a new feature can be added by consuming world contracts instead of inventing another independent coordinate system.

This plan is intentionally conservative: establish a correct heightfield world first, then expand the representation when a concrete feature requires it.
