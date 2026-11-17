# World V2: Phase 0–1 Implementation Notes

## Scope

This branch introduces a parallel terrain foundation and a dedicated Terrain Lab. The existing landscape generator and production homepage remain untouched. The new system is not yet the production renderer and deliberately contains no water, trees, fog or erosion.

## Phase 0 contracts

- Canonical right-handed world coordinates: X and Z are horizontal axes; Y is elevation.
- `TerrainRecipe` is versioned, serializable, deterministic input. Dimensions and all exposed parameters are range-validated before allocation.
- Dense fields use `Float32Array`; semantic world structures will use sparse typed records/graphs.
- A generator never receives canvas dimensions and never returns screen-space coordinates.
- Subsystem seeds are derived from the root seed plus a stable subsystem name, so adding forest generation cannot perturb terrain generation.
- Heightfield operations provide bilinear elevation sampling, finite-difference gradients, normalized surface normals, slope and curvature.
- A generated terrain returns diagnostics (range, mean, variance and mean slope) so parameter changes can be tested quantitatively.

## Phase 1 terrain model

The first landform model separates:
- Macro ridge geometry, defined by a continuous ridge spine and distance profile.
- Broad-scale variation, from low-frequency gradient fBm.
- Ridge character, controlled by a rounded-to-sharp profile blend.
- Ridge irregularity, which warps the spine at low frequency.
- Surface roughness, which controls the amplitude of higher-frequency detail.
- Detail scale and octave count, which control the size and number of detail bands.

The output is a continuous 2D heightfield. `buildHeightfieldMesh` converts it into an indexed triangle grid with world-space positions and per-vertex normals. It does not project to screen space.

## Terrain Lab

Open `/terrain-lab.html` on the deployed preview or run `npm run dev` and visit that path.

Available debug views:
- Shaded surface
- Elevation ramp
- Slope
- Surface normals
- Wireframe topology

The Lab exposes each landform parameter independently and displays field diagnostics. The production homepage still uses the legacy generator until visual acceptance and a later migration phase.

## Automated acceptance tests

The new tests verify:
- Byte-for-byte deterministic field output for an identical recipe.
- Non-zero 2D relief and measurable variance.
- Independent observable effects from relief, roughness and peak sharpness.
- Finite, normalized surface normals and finite curvature.
- Expected mesh vertex/triangle counts and finite normals.
- Recipe dimension validation.
- Stable, isolated subsystem seed derivation.

## Known limitations / not yet accepted

- The first landform formula is a procedural baseline, not a geologically complete model.
- Terrain Lab currently uses a fixed orthographic camera; interactive orbit/pan and chunk LOD are later work.
- No river network, channel carving, ecological placement, atmospheric model or erosion is included.
- Visual appearance must still be checked in a real browser and on an Android device. Passing TypeScript/tests/build is not visual acceptance.
- Heightfield representation cannot express caves, overhangs or multiple elevations at one X/Z coordinate.

## Exit criteria before Phase 2

1. Verify terrain shape and all parameter controls visually at multiple seeds.
2. Verify elevation, slope, normal and wireframe debug views.
3. Inspect mobile GPU load, memory and canvas resizing on an actual phone.
4. Fix any winding, clipping, normal or projection defects found in visual review.
5. Only then proceed to the next rendering/occlusion milestones.
