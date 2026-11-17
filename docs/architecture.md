# Aether architecture — first iteration

## Direction

Aether is a small procedural creation tool, not a browser-based replacement for a full 3D suite. The first goal is a dependable procedural core and a fast 2D preview. 2.5D and 3D are added behind separate render backends.

## Layers

```text
UI (Visual controls / future Node Editor / Code & Parameters)
                  |
             Project API
                  |
       Graph + Parameter Model
                  |
       Evaluation / Cache Layer
                  |
        Procedural Core (pure TS)
          /        |         \
       2D data   Fields    3D data
          \        |         /
             Render Backends
       Canvas2D / WebGL2 / optional WebGPU
```

## Rules

- Core generators must not import UI or renderer modules.
- A generator takes explicit inputs and returns data; no hidden global random state.
- The same seed and parameters must reproduce the same result.
- Large collections use typed arrays rather than nested objects where practical.
- Preview quality is bounded by a pixel and work budget.
- Heavy tasks can move to a Worker without changing generator APIs.
- Optional render backends must not be required to open a 2D project.

## Initial stack

- Vite + TypeScript: small static application and fast development loop.
- Canvas 2D: first preview backend; broad support and low setup cost.
- No runtime math/noise dependency in the first prototype.
- WebGL2: planned 3D baseline after the core is validated.
- WebGPU: optional compute/render acceleration, not a hard requirement.
- Three.js: candidate scene layer, loaded only when a 3D workspace is opened.

## Initial data contracts

A graph node is data, not a UI component. A node has a stable id, type, version, input connections and parameter values. Evaluation returns a typed output and a cache key derived from node version, inputs and parameters.

Future graph types should explicitly distinguish scalar, vector, color, curve, geometry, field, material, texture, transform, animation and scene data. Add types only when a real generator needs them.

## First milestone

1. A working 2D procedural preview.
2. Deterministic random and noise functions.
3. Conservative mobile render sizing.
4. Build and typecheck scripts.
5. Research notes and performance decisions kept in the repository.


## Shared landscape world model

The Canvas landscape currently uses a lightweight 2.5D renderer with layered terrain profiles. River routing is a separate, bounded 2D elevation-field calculation shared by the world-generation pass.

- Terrain profiles are sampled once and reused by terrain rendering and vegetation placement.
- River routing builds a compact seeded 2D elevation field, then solves a constrained path between seed-stable endpoints.
- The route cost combines sampled elevation, lateral movement, and change in direction. This favors lower terrain while discouraging long detours and sharp turns.
- A short smoothing pass reduces grid-like bends. River width is controlled globally, while perspective widening is applied independently.
- The channel is rendered as overlapping round line segments instead of offset left/right polygons, avoiding the self-intersections that caused spikes.
- The route is deterministic for a given seed and responds to terrain scale and roughness. Its endpoints remain fixed for that seed.

This is a stable path-planning approximation, not full hydrology: it does not yet calculate water accumulation, drainage basins, erosion, or true 3D occlusion. Those require a shared 2D terrain height field used by all world elements, followed by flow accumulation and depth-aware rendering.