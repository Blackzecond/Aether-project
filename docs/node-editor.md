# Touch-first Node Editor

The first interactive editor milestone uses a compact, vertical node list rather than a large free-pan canvas.

## Interactions

- Add Number, Add, Multiply, or Clamp nodes from the node type selector.
- Tap an output port, then tap an input port to create a connection.
- Tap an already-connected input without selecting an output to disconnect it.
- Connecting to an occupied input replaces its previous connection.
- Added nodes can be removed; the four starter nodes are protected.
- Number nodes expose an editable value. Starter values stay synchronized with the landscape controls.
- Move nodes up and down to change the visual order without changing their IDs or connections.
- Export the graph as JSON or import a compatible JSON file. Imports are size-limited, parsed as data (never executed), checked against the available node registry, and evaluated before replacing the current graph.
- Graph edits are stored locally on the current device using the versioned graph document format.

## Deliberate first-release limits

- Connections are made by tap-to-select, not by dragging wires.
- Nodes use a vertical list; free positioning, panning, zooming, and wire routing are not implemented yet.
- The editor is intentionally limited to the core numeric nodes and the landscape output.
- Graph data is stored in this browser/device only. Export/import files can be moved between devices manually; cloud sync is future work.

This keeps the first editor usable on narrow touch screens while the graph model remains independent of the UI.
