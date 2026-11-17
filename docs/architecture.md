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
