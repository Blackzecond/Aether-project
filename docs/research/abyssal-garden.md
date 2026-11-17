# Abyssal Garden — technical study

Reference: [Noniv/abyssal-garden](https://github.com/Noniv/abyssal-garden)  
Live demo: https://noniv.github.io/abyssal-garden/  
License observed in the repository: MIT.

This document records observations from the readable source in `source/src/`. It is a design study, not a plan to copy the project wholesale.

## What the project is made of

| File | Responsibility |
|---|---|
| `world.js` | Hand-authored layout data and procedural placement of kelp, rocks, corals, sponges, fish, mantas and set pieces |
| `shaders.js` | WGSL: density field, noise, water, terrain and object shading, light rays and post-processing helpers |
| `main.js` | WebGPU device, buffers, textures, pipelines, camera, input, rendering, GPU timing and dynamic resolution |
| `math.js` | Seeded random numbers, integer hashes, value noise, fBm, quaternion helpers, Surface Nets and mesh builders |
| `quality.js` | Low / Medium / High presets and remembered device settings |
| `audio.js` | Procedural soundscape using Web Audio API |
| `dev.js` | Camera fly-through and repeatable frame/GPU benchmark |
| `template.html` | Minimal loading, menu, controls and page styling |
| `build.mjs` | Bundles readable source into a compact standalone HTML file |

There are no image, model or audio files required by the runtime scene. The repository does contain screenshots for documentation.

## Techniques worth learning from

### 1. GPU density-field terrain

The seabed is represented as a scalar density field. A WGSL compute shader evaluates the field in parallel. The field combines:

- Fractal Brownian Motion (fBm) for broad terrain variation.
- Worley/Voronoi-style distance noise for rocky surface detail.
- Smooth minimum / maximum operations to blend and carve shapes.
- Distance to line segments for cliffs, arches and tunnels.
- Domain warping to break up overly regular forms.

The source uses a large fixed grid (512 × 80 × 512 samples). This is effective for a fixed showcase world, but it creates a large working set and is not a good default for a general-purpose mobile editor.

### 2. Surface Nets mesh extraction

The source includes a CPU Surface Nets implementation that scans the density grid, places one vertex in each active cell near the average of its edge crossings, and builds triangle indices.

It is a good fit for soft, organic terrain. It is not the best universal extractor: sharp features and topology guarantees require other approaches.

### 3. Instanced procedural vegetation and props

Repeated leaves and objects share a small number of base meshes. Per-instance data carries position, rotation, scale, type and variation. The renderer groups instances into spatial cells and submits only visible / nearby cell ranges.

This reduces duplicated geometry and draw-call overhead. The world generator also uses independent seeded random streams so changing one category does not reshuffle every other category.

### 4. Level of detail and adaptive rendering

The project offers Low, Medium and High modes. Lower modes thin out leaves and particles, reduce shadow work, simplify meshes and reduce post-processing quality.

The main loop also adjusts internal render resolution and draw distance using timing information. The source includes GPU timestamp-query support where available and a fly-through benchmark for repeatable measurement.

### 5. Compact rendering and procedural audio

The renderer uses WebGPU and WGSL directly instead of a general 3D engine. The scene includes custom shadowing, water, light rays, bloom and post-processing. Audio is synthesized from oscillators, filters, noise buffers and envelopes with Web Audio API.

## What Aether should improve

Abyssal Garden is a carefully tuned single scene. Aether is an editor, so it needs bounded, reusable systems rather than one huge fixed world.

1. **Chunked fields instead of one giant volume.** Generate only the chunks needed for the current preview. Use a small border/halo around chunks for continuous gradients and normals. Cache chunks by graph hash + parameters + seed.
2. **Move expensive generation off the UI thread.** Use Web Workers for CPU generation and OffscreenCanvas where supported. Keep a main-thread fallback. Do not create workers for tiny jobs where messaging overhead costs more than the work.
3. **Separate generation from rendering.** A generator should return typed data; renderers consume it. This keeps 2D, 2.5D and 3D backends independent.
4. **Use typed arrays and capacity reuse.** Avoid nested JavaScript arrays for large point/instance sets. Allocate predictable buffers, grow geometrically, and release large temporary arrays as soon as GPU upload completes.
5. **Use spatial chunks and frustum/distance culling.** Avoid submitting off-screen objects. Add LOD based on screen size and distance, not only a global quality switch.
6. **Adaptive preview budgets.** Cap pixel count, instance count and generation time. Lower render resolution or detail before the device becomes unresponsive.
7. **Make algorithms interchangeable.** Keep Surface Nets for smooth organic forms; evaluate Marching Cubes for robust closed surfaces and Dual Contouring for sharp features. Benchmark quality, topology, memory and time before choosing defaults.
8. **Profile before adding libraries.** Keep the initial core dependency-light. Add a math or noise package only if a benchmark shows a clear benefit or it avoids substantial maintenance.

## Candidate mathematics and libraries

| Need | Candidate | Aether decision |
|---|---|---|
| Seeded randomness | Small local PRNG + integer hash | Keep local; tiny, deterministic and easy to test |
| Smooth noise | Quintic value noise; compare with Simplex / OpenSimplex2 | Local baseline first; benchmark alternatives later |
| Fractal detail | fBm, ridged multifractal, domain warping | Implement as composable functions |
| Vector / matrix math | gl-matrix | Consider if Aether owns a low-level WebGL/WebGPU renderer; do not duplicate Three.js math |
| 3D scene abstraction | Three.js | Load lazily when the 3D workspace is opened; start with WebGL2 |
| Repeated geometry | Instancing (custom or Three.js InstancedMesh) | Core rendering requirement for repeated objects |
| Worker rendering | Web Workers + OffscreenCanvas | Add for heavy preview jobs with fallback |
| Volume meshing | Surface Nets / Marching Cubes / Dual Contouring | Pluggable extractors; no universal winner |

## Mobile-first recommendations

- Do not require WebGPU for the first usable release. Browser and device support is uneven; use Canvas 2D first and WebGL2 as the initial 3D baseline.
- Treat WebGPU as an optional accelerator after feature detection and device testing.
- Avoid full-resolution multi-pass effects by default. Bloom, volumetric rays and large shadow maps are optional quality features.
- Use a pixel budget and dynamic resolution. A lower-resolution preview often matters more than reducing a few arithmetic operations.
- Batch objects by geometry/material and use instancing. Minimize draw calls and CPU-to-GPU uploads.
- Keep large calculations out of the animation frame. Generate on demand, cache results and update only changed graph branches.
- Measure frame-time percentiles and memory, not just average FPS.

## Important limitation

The README's reported performance numbers are author-reported results on specific hardware, not a guarantee for other phones. In particular, the README reports roughly 20 FPS on a Samsung Galaxy A16 at Low settings. Aether should set its own targets only after testing on actual target devices.
