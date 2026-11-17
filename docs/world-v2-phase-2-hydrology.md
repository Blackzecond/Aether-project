# World V2: Phase 2 — Drainage foundation

## Scope

This phase adds a renderer-independent hydrology field derived from the authoritative terrain heightfield. It does not render water, carve channels or modify terrain.

## Pipeline

`Heightfield → multi-outlet Priority-Flood → D8 flow routing → contributing-area accumulation → outlet basin labels`

- Every boundary sample is a valid drainage outlet.
- Priority-Flood raises only the separate `filledElevation` routing buffer to resolve enclosed depressions.
- The source heightfield remains unchanged and remains the only elevation used by terrain rendering.
- D8 routes each cell to an adjacent cell with no higher filled elevation. Flood visitation order resolves equal-height flats and guarantees an acyclic downstream graph.
- Accumulation starts at one per cell and is propagated upstream-to-downstream in reverse flood order.
- Basin IDs identify the boundary outlet reached by each cell.

## API

`buildDrainageField(heightfield)` returns typed arrays:

- `filledElevation`: hydrology-only depression-filled elevation.
- `flowTo`: downstream cell index, or `-1` for a boundary outlet.
- `accumulation`: contributing cell count including the cell itself.
- `basinId`: outlet ID reached by each cell.
- `outletIndices`: boundary outlet indices.
- `diagnostics`: outlet count, number of filled cells and maximum accumulation.

## Automated invariants

- Identical heightfields produce identical drainage outputs.
- Every non-outlet flow edge is adjacent and never rises in filled elevation.
- Flood-order tie-breaking makes the flow graph acyclic.
- The sum of accumulation over all outlets equals the number of source cells.
- Every cell receives a valid outlet basin ID.
- The source terrain buffer is unchanged.

## River channel extraction

`extractRiverNetwork(heightfield, drainage, options)` selects cells by a minimum contributing catchment area in world-space square units. The default threshold scales with cell area and grid size rather than using a fixed pixel count.

- Every selected cell follows its D8 downstream edge to another selected cell, eventually reaching a boundary outlet.
- Headwaters are selected cells with no selected upstream neighbour; junctions are naturally preserved by shared downstream cells.
- Channel width is derived from contributing area with a bounded power relation and a maximum width in grid-cell units.
- The result is a compact, renderer-independent graph: channel mask, channel indices, headwaters, outlets, downstream indices and per-cell widths.

## Deliberate limitations

- D8 is the initial routing model; it can create angular or grid-biased channels.
- Every boundary cell is currently an outlet. Later work may group outlets or use a sea-level mask.
- Channel extraction is threshold-based and D8 inherits grid-direction bias.
- No channel incision or water surface is included. The diagnostic overlay is a view of derived data only; it does not alter terrain.
- Priority-Flood is drainage preprocessing, not a fluid simulation.

## Diagnostic view

Terrain Lab now includes a `การไหลและลำน้ำ` view. It shades the heightfield by logarithmic contributing-cell accumulation (blue through yellow) and overlays extracted channel cells in gold. The view reports channel-cell count, headwaters, outlets and maximum accumulation. Hydrology is computed only when this view is selected and is refreshed after terrain controls settle.

This is a diagnostic visualization, not visual acceptance: deployment is currently blocked by the Vercel build-rate limit, so the view still needs review on the target device. Do not implement channel incision or a water surface until terrain and routing have been visually reviewed.
