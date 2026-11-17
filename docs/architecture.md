# Aether architecture — World Foundation

## Core rule

The world model is authoritative. Rendering consumes world data; it must not invent separate screen-space terrain for individual systems.

## Current data flow

`TerrainRecipe → generateTerrain() → Heightfield → surface sampling / mesh → WebGL2 renderer`

Hydrology is a separate derived stage: `Heightfield → buildDrainageField() → filled elevation + D8 flow + accumulation + basin labels → extractRiverNetwork() → thresholded channel graph + headwaters + outlets + width estimates`. Depression filling never mutates the source terrain and is not used as rendered elevation.

- `src/world/coordinates.ts`: canonical world-space bounds and coordinate contracts.
- `src/world/recipe.ts`: versioned, validated generation parameters.
- `src/world/terrain/noise.ts`: deterministic gradient noise and fBm.
- `src/world/terrain/landforms.ts`: seeded terrain generation and diagnostics.
- `src/world/fields/heightfield.ts`: elevation sampling, normals, slope and curvature.
- `src/world/mesh/heightfield-mesh.ts`: indexed mesh and vertex normals.
- `src/render/webgl2/terrain-preview.ts`: GPU rendering and diagnostic modes.
- `src/terrain-lab.ts`: UI bindings; the root `index.html` is the production entry point.

## Coordinate convention

- X: horizontal world axis.
- Y: elevation.
- Z: depth / second horizontal world axis.
- Terrain is represented as a sampled scalar field `h(x,z)`.
- Surface normal, slope and curvature are derived from that same field.

## Extension contract

Water, vegetation, atmosphere and other systems must receive the same world model (or query its fields). They must not create unrelated screen-space coordinates or independent terrain profiles.

## Current limitation

The present terrain generator is an initial landform model, not an accepted final mountain synthesis system. The Terrain Lab is the acceptance surface. Do not proceed to hydrology or ecology until mountain geometry, parameter response, camera framing and mobile rendering are visually accepted.
