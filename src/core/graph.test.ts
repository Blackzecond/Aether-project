import { describe, expect, it } from "vitest";
import { evaluateGraph, GraphExecutionError, type GraphDocument } from "./graph";
import { createCoreNodeRegistry } from "./nodes";

const registry = createCoreNodeRegistry();

describe("evaluateGraph", () => {
  it("evaluates connected nodes in dependency order", () => {
    const graph: GraphDocument = {
      nodes: [
        { id: "sum", type: "math.add" },
        { id: "left", type: "number.constant", params: { value: 2 } },
        { id: "right", type: "number.constant", params: { value: 3 } },
      ],
      edges: [
        { id: "a", fromNodeId: "left", fromPort: "value", toNodeId: "sum", toPort: "a" },
        { id: "b", fromNodeId: "right", fromPort: "value", toNodeId: "sum", toPort: "b" },
      ],
    };
    const result = evaluateGraph(graph, registry);
    expect(result.values.get("sum")?.value).toBe(5);
    expect(result.order.at(-1)).toBe("sum");
  });

  it("rejects cycles", () => {
    const graph: GraphDocument = {
      nodes: [{ id: "a", type: "math.add" }, { id: "b", type: "math.add" }],
      edges: [
        { id: "ab", fromNodeId: "a", fromPort: "value", toNodeId: "b", toPort: "a" },
        { id: "ba", fromNodeId: "b", fromPort: "value", toNodeId: "a", toPort: "a" },
      ],
    };
    try {
      evaluateGraph(graph, registry);
      throw new Error("Expected cycle validation to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(GraphExecutionError);
      expect((error as GraphExecutionError).code).toBe("cycle");
    }
  });

  it("rejects multiple edges targeting one input", () => {
    const graph: GraphDocument = {
      nodes: [
        { id: "one", type: "number.constant" },
        { id: "two", type: "number.constant" },
        { id: "sum", type: "math.add" },
      ],
      edges: [
        { id: "a", fromNodeId: "one", fromPort: "value", toNodeId: "sum", toPort: "a" },
        { id: "b", fromNodeId: "two", fromPort: "value", toNodeId: "sum", toPort: "a" },
      ],
    };
    expect(() => evaluateGraph(graph, registry)).toThrow(/multiple connections/);
  });

  it("rejects non-finite constant values", () => {
    const graph: GraphDocument = {
      nodes: [{ id: "bad", type: "number.constant", params: { value: Number.NaN } }],
      edges: [],
    };
    expect(() => evaluateGraph(graph, registry)).toThrow(/finite number/);
  });
});
