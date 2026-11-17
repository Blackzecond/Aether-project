import type { GraphDocument, GraphEdge, GraphNode, GraphValue } from "./graph";

export const GRAPH_DOCUMENT_VERSION = 1;
const MAX_DOCUMENT_LENGTH = 1_000_000;
const MAX_NODES = 10_000;
const MAX_EDGES = 20_000;
const MAX_DEPTH = 32;
const MAX_KEY_LENGTH = 128;

export class GraphDocumentFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphDocumentFormatError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new GraphDocumentFormatError(label + " contains an unknown field: " + key);
  }
}

function readId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_KEY_LENGTH) {
    throw new GraphDocumentFormatError(label + " must be a non-empty string of at most " + MAX_KEY_LENGTH + " characters.");
  }
  return value;
}

function assertJsonValue(value: unknown, path: string, depth: number): asserts value is GraphValue {
  if (depth > MAX_DEPTH) throw new GraphDocumentFormatError(path + " exceeds the maximum nesting depth.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new GraphDocumentFormatError(path + " must contain only finite numbers.");
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, path + "[" + index + "]", depth + 1));
    return;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        throw new GraphDocumentFormatError(path + " contains a reserved object key.");
      }
      assertJsonValue(item, path + "." + key, depth + 1);
    }
    return;
  }
  throw new GraphDocumentFormatError(path + " contains a value that is not JSON-compatible.");
}

function validateDocument(value: unknown): GraphDocument {
  if (!isRecord(value)) throw new GraphDocumentFormatError("Graph document must be an object.");
  assertKeys(value, ["version", "nodes", "edges"], "Graph document");
  if (value.version !== GRAPH_DOCUMENT_VERSION) {
    throw new GraphDocumentFormatError("Unsupported graph document version: " + String(value.version));
  }
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new GraphDocumentFormatError("Graph document must contain nodes and edges arrays.");
  }
  if (value.nodes.length > MAX_NODES) throw new GraphDocumentFormatError("Graph contains too many nodes.");
  if (value.edges.length > MAX_EDGES) throw new GraphDocumentFormatError("Graph contains too many edges.");

  const nodeIds = new Set<string>();
  const nodes: GraphNode[] = value.nodes.map((item, index) => {
    const label = "nodes[" + index + "]";
    if (!isRecord(item)) throw new GraphDocumentFormatError(label + " must be an object.");
    assertKeys(item, ["id", "type", "params"], label);
    const id = readId(item.id, label + ".id");
    const type = readId(item.type, label + ".type");
    if (nodeIds.has(id)) throw new GraphDocumentFormatError("Duplicate node id: " + id);
    nodeIds.add(id);

    let params: Readonly<Record<string, GraphValue>> | undefined;
    if (item.params !== undefined) {
      if (!isRecord(item.params)) throw new GraphDocumentFormatError(label + ".params must be an object.");
      assertJsonValue(item.params, label + ".params", 0);
      params = item.params as Record<string, GraphValue>;
    }
    return params === undefined ? { id, type } : { id, type, params };
  });

  const edgeIds = new Set<string>();
  const edges: GraphEdge[] = value.edges.map((item, index) => {
    const label = "edges[" + index + "]";
    if (!isRecord(item)) throw new GraphDocumentFormatError(label + " must be an object.");
    assertKeys(item, ["id", "fromNodeId", "fromPort", "toNodeId", "toPort"], label);
    const id = readId(item.id, label + ".id");
    if (edgeIds.has(id)) throw new GraphDocumentFormatError("Duplicate edge id: " + id);
    edgeIds.add(id);
    const fromNodeId = readId(item.fromNodeId, label + ".fromNodeId");
    const toNodeId = readId(item.toNodeId, label + ".toNodeId");
    if (!nodeIds.has(fromNodeId) || !nodeIds.has(toNodeId)) {
      throw new GraphDocumentFormatError(label + " references a node that does not exist.");
    }
    return {
      id,
      fromNodeId,
      fromPort: readId(item.fromPort, label + ".fromPort"),
      toNodeId,
      toPort: readId(item.toPort, label + ".toPort"),
    };
  });

  return { nodes, edges };
}

/** Parse and structurally validate a versioned graph document from untrusted text. */
export function parseGraphDocument(source: string): GraphDocument {
  if (source.length > MAX_DOCUMENT_LENGTH) {
    throw new GraphDocumentFormatError("Graph document exceeds the 1 MB size limit.");
  }
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    throw new GraphDocumentFormatError("Graph document is not valid JSON.");
  }
  return validateDocument(value);
}

/** Serialize a graph using the current versioned interchange format. */
export function serializeGraphDocument(graph: GraphDocument): string {
  const normalized = validateDocument({
    version: GRAPH_DOCUMENT_VERSION,
    nodes: graph.nodes,
    edges: graph.edges,
  });
  try {
    return JSON.stringify({
      version: GRAPH_DOCUMENT_VERSION,
      nodes: normalized.nodes,
      edges: normalized.edges,
    }, null, 2);
  } catch {
    throw new GraphDocumentFormatError("Graph document could not be serialized.");
  }
}
