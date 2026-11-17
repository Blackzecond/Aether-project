# Graph Document Format

Aether graph files use a versioned JSON interchange format so the same graph can be used by the visual editor, parameter mode, and future worker-based execution.

## Version 1

```json
{
  "version": 1,
  "nodes": [
    { "id": "source", "type": "number.constant", "params": { "value": 2 } },
    { "id": "sum", "type": "math.add" }
  ],
  "edges": [
    {
      "id": "edge-1",
      "fromNodeId": "source",
      "fromPort": "value",
      "toNodeId": "sum",
      "toPort": "a"
    }
  ]
}
```

## Safety and validation

- Parsing accepts JSON text only; it never evaluates executable code.
- Unknown fields and unsupported versions are rejected rather than silently ignored.
- Node and edge IDs must be unique. Edge endpoints must refer to existing nodes.
- Parameters must be JSON-compatible and finite; reserved object keys are rejected.
- Documents are limited to 1 MB, 10,000 nodes, 20,000 edges, and 32 nested parameter levels.
- Node types and port compatibility are validated by the graph registry during execution.

Version changes must use an explicit migration path. Do not reinterpret an older document as a newer version.
