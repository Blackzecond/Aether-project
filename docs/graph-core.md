# Graph Core

The first Graph Core milestone provides a small, renderer-independent execution engine.

## Current scope

- Graph documents contain nodes and directed edges.
- Node definitions are registered by type and declare input/output ports.
- Evaluation uses a stable topological order.
- Invalid node references, duplicate IDs, invalid ports, multiple connections to one input, missing outputs, and cycles produce explicit errors.
- Built-in nodes cover numeric constants, addition, multiplication, and clamping.

## Design constraints

- The graph model has no dependency on Canvas, WebGL, WebGPU, or a UI framework.
- Evaluation is synchronous for now; costly procedural work should later use a worker adapter.
- The engine does not yet include editor state, visual layout, caching, or async nodes.
- Versioned JSON serialization is provided separately by `graph-document.ts`; version 1 validates document structure, limits resource use, and rejects executable/unknown fields.
- Graph values are JSON-like so documents can be saved and moved between visual editor and parameter/code modes.

## Validation and interchange

Run `npm run test` to execute graph-engine and document-format tests. The interchange format is documented in [Graph Document Format](./graph-document-format.md).

## Example

A constant node with value 2 connected to both inputs of an addition node evaluates to 4.
