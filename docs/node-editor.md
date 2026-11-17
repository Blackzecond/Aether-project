# Touch-first Freeform Node Editor

The editor uses a freeform 2D canvas with DOM node cards and an SVG wire layer.

## Interactions
- Drag a node by its header to position it freely.
- Drag the empty canvas area to pan; use zoom controls or the mouse wheel to zoom.
- Drag from an output port to an input port to connect; tap an output then an input as an alternative. Tap a connected input with no output selected to disconnect.
- New connections replace an occupied input and are checked by the graph evaluator before saving.
- Add Number, Add, Multiply, and Clamp nodes; added nodes can be removed while starter nodes remain protected.
- Node positions are saved with the graph and included in JSON export/import.
- Version 1 graph files migrate to version 2 with a stable default layout. Version 2 validates layout IDs and bounds coordinates to 0–10000.
- Graph data remains local to the current browser/device; export/import moves it manually between devices.

## Organization
- Search nodes by display name, internal type, category, or node ID.
- Filter the canvas by Number, Math, or Output category.
- Nodes are automatically grouped by category. Each group header collapses or expands all currently matching nodes in that category; hidden group wires are hidden as well.
- Search and category filtering only affect visibility; they never delete nodes or modify graph connections.

## Implementation
- Node cards are DOM elements; wires are a non-interactive SVG overlay.
- Pointer Events support mouse, pen, and touch. Canvas gestures use pointer capture and `touch-action: none`.
- The graph evaluator remains independent of presentation and layout.
- The canvas uses a fixed logical world size to avoid unbounded rendering surfaces.
