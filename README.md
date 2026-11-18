# Aether — Procedural World Generator

Aether is built around one shared world-space model. The terrain is the authoritative foundation: hydrology, vegetation, atmosphere and lighting must derive from the same surface and coordinates rather than drawing independent scenery layers.

## Active world pipeline

- Deterministic, seeded terrain generation in a dedicated Web Worker
- A 256 × 256 macro heightfield is the authoritative surface for terrain, water and vegetation
- Indexed WebGL2 terrain mesh with per-vertex normals
- Hydrology and vegetation sample the same heightfield used by the rendered terrain
- Terrain controls regenerate the shared world without blocking the UI
- WebGPU is optional; the active macro-terrain path has a WebGL2-compatible CPU baseline

The former global low-resolution density-volume terrain is no longer used for the main mountain surface. It produced coarse vertical sampling and allowed arbitrary ellipsoid unions to create detached summit blobs. The density/SDF code is retained as experimental groundwork; volumetric geometry should be introduced only for localized features that need caves, arches or overhangs, not as a replacement for the entire heightfield.

## Vegetation foundation

- Forest stands use broad and medium-scale habitat masks, clustered candidate placement and local spacing competition
- Tree instances share a procedural tapered trunk and branching skeleton with individual leaf geometry
- Tree orientation, crown width, height and tint vary deterministically by seed
- Ground cover uses curved, tapered grass blades, fern fronds, low moss patches and small stones
- Instanced rendering keeps geometry shared across many vegetation placements
- Ground-cover candidates are sampled across the full world instead of stopping at an arbitrary scan-order limit

This is a procedural foundation, not a claim of final photorealism. Species-specific models, canopy/understory competition, vegetation LOD and wind animation remain future quality work.

## Run locally

\`\`\`bash
npm install
npm run dev
\`\`\`

Open the root page. The production entry point is \`index.html\`.

## Checks

\`\`\`bash
npm test
npm run typecheck
npm run build
\`\`\`

## Development sequence

1. Stabilize the shared macro terrain and add localized volumetric features only where needed.
2. Build believable forest stands, tree species, ground cover and vegetation LOD.
3. Convert drainage into a connected river graph and continuous carved channels.
4. Add atmosphere, lighting and depth-aware rendering.
5. Validate fixed-seed scenes and optimize mobile quality tiers.

Every subsystem must use the same world coordinates and sample the authoritative terrain surface. Changes should pass deterministic/data-integrity tests before visual acceptance on a real device.
