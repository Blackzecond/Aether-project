# Aether — Procedural World Generator

Aether is being rebuilt around a shared world-space model. Terrain is the authoritative foundation: every later system (water, vegetation, atmosphere, lighting) will derive from the same sampled world rather than drawing independent screen-space layers.

## Current foundation

- Canonical X/Y/Z world coordinates and validated, versioned terrain recipes
- Deterministic seeded gradient noise and fBm
- 2D heightfield sampling with bilinear elevation, finite-difference normals, slope and curvature
- Indexed heightfield mesh with per-vertex normals
- WebGL2 terrain renderer with shaded, elevation, slope, normal and wireframe diagnostic views
- Terrain controls update the generated world immediately
- Automated tests for determinism, parameter response, surface sampling and mesh integrity

## Run locally

```bash
npm install
npm run dev
```

Open the root page. The production entry point is `index.html`.

## Checks

```bash
npm test
npm run typecheck
npm run build
```

## Development sequence

1. Accept and validate the terrain shape and controls.
2. Derive drainage and water flow from terrain.
3. Derive biome and vegetation suitability from terrain and hydrology.
4. Add atmosphere, lighting and depth-aware rendering.
5. Optimize quality levels and mobile performance.

Do not add independent screen-space scenery layers. New systems must query the shared world model.
