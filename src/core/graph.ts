export type GraphValue =
  | null | boolean | number | string
  | readonly GraphValue[]
  | { readonly [key: string]: GraphValue };

export interface GraphNode {
  readonly id: string;
  readonly type: string;
  readonly params?: Readonly<Record<string, GraphValue>>;
}
export interface GraphEdge {
  readonly id: string;
  readonly fromNodeId: string;
  readonly fromPort: string;
  readonly toNodeId: string;
  readonly toPort: string;
}
export interface GraphDocument {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}
export interface GraphNodeDefinition {
  readonly type: string;
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  evaluate(inputs: Readonly<Record<string, GraphValue>>, params: Readonly<Record<string, GraphValue>>): Readonly<Record<string, GraphValue>>;
}
export type GraphErrorCode =
  | "duplicate-node" | "duplicate-edge" | "unknown-node-type"
  | "missing-node" | "unknown-output" | "unknown-input"
  | "input-already-connected" | "cycle" | "missing-output-value";

export class GraphExecutionError extends Error {
  constructor(readonly code: GraphErrorCode, message: string) {
    super(message);
    this.name = "GraphExecutionError";
  }
}
export interface GraphExecution {
  readonly order: readonly string[];
  readonly values: ReadonlyMap<string, Readonly<Record<string, GraphValue>>>;
}
function fail(code: GraphErrorCode, message: string): never {
  throw new GraphExecutionError(code, message);
}

/** Evaluate a directed graph in stable topological order, independent of renderer/UI. */
export function evaluateGraph(
  graph: GraphDocument,
  registry: ReadonlyMap<string, GraphNodeDefinition>,
): GraphExecution {
  const nodes = new Map<string, GraphNode>();
  const definitions = new Map<string, GraphNodeDefinition>();
  const nodeOrder = new Map<string, number>();

  graph.nodes.forEach((node, index) => {
    if (nodes.has(node.id)) fail("duplicate-node", "Duplicate node id: " + node.id);
    const definition = registry.get(node.type);
    if (!definition) fail("unknown-node-type", "Unknown node type: " + node.type);
    nodes.set(node.id, node);
    definitions.set(node.id, definition);
    nodeOrder.set(node.id, index);
  });

  const outgoing = new Map<string, GraphEdge[]>();
  const indegree = new Map<string, number>();
  const connectedInputs = new Set<string>();
  const edgeIds = new Set<string>();
  for (const node of graph.nodes) {
    outgoing.set(node.id, []);
    indegree.set(node.id, 0);
  }

  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) fail("duplicate-edge", "Duplicate edge id: " + edge.id);
    edgeIds.add(edge.id);
    const source = nodes.get(edge.fromNodeId);
    const target = nodes.get(edge.toNodeId);
    if (!source || !target) fail("missing-node", "Edge " + edge.id + " references a missing node.");

    const sourceDefinition = definitions.get(source.id)!;
    const targetDefinition = definitions.get(target.id)!;
    if (!sourceDefinition.outputs.includes(edge.fromPort)) {
      fail("unknown-output", "Node " + source.id + " has no output port " + edge.fromPort + ".");
    }
    if (!targetDefinition.inputs.includes(edge.toPort)) {
      fail("unknown-input", "Node " + target.id + " has no input port " + edge.toPort + ".");
    }
    const inputKey = edge.toNodeId + ":" + edge.toPort;
    if (connectedInputs.has(inputKey)) {
      fail("input-already-connected", "Input " + inputKey + " has multiple connections.");
    }
    connectedInputs.add(inputKey);
    outgoing.get(source.id)!.push(edge);
    indegree.set(target.id, indegree.get(target.id)! + 1);
  }

  const ready = graph.nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const values = new Map<string, Readonly<Record<string, GraphValue>>>();
  const order: string[] = [];

  while (ready.length > 0) {
    const nodeId = ready.shift()!;
    const node = nodes.get(nodeId)!;
    const definition = definitions.get(nodeId)!;
    const inputValues: Record<string, GraphValue> = {};

    for (const edge of graph.edges) {
      if (edge.toNodeId !== nodeId) continue;
      const sourceValues = values.get(edge.fromNodeId);
      if (!sourceValues) fail("cycle", "Unable to resolve upstream node: " + edge.fromNodeId);
      inputValues[edge.toPort] = sourceValues[edge.fromPort];
    }

    const result = definition.evaluate(inputValues, node.params ?? {});
    for (const port of definition.outputs) {
      if (!Object.prototype.hasOwnProperty.call(result, port)) {
        fail("missing-output-value", "Node " + nodeId + " did not provide output " + port + ".");
      }
    }
    values.set(nodeId, result);
    order.push(nodeId);

    for (const edge of outgoing.get(nodeId)!) {
      const nextDegree = indegree.get(edge.toNodeId)! - 1;
      indegree.set(edge.toNodeId, nextDegree);
      if (nextDegree === 0) {
        ready.push(edge.toNodeId);
        ready.sort((a, b) => nodeOrder.get(a)! - nodeOrder.get(b)!);
      }
    }
  }

  if (order.length !== graph.nodes.length) {
    const blocked = graph.nodes.filter((node) => !order.includes(node.id)).map((node) => node.id);
    fail("cycle", "Graph contains a cycle involving: " + blocked.join(", "));
  }
  return { order, values };
}
