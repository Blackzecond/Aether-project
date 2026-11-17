import { describe, expect, it } from "vitest";
import { parseGraphDocument, serializeGraphDocument, GraphDocumentFormatError } from "./graph-document";
import type { GraphDocument } from "./graph";

const sample: GraphDocument = {
  nodes: [
    { id: "seed", type: "number.constant", params: { value: 42, metadata: { label: "seed", enabled: true } } },
    { id: "sum", type: "math.add" },
  ],
  edges: [
    { id: "edge-1", fromNodeId: "seed", fromPort: "value", toNodeId: "sum", toPort: "a" },
  ],
};

describe("graph document interchange", () => {
  it("round-trips a graph with a version marker", () => {
    const source = serializeGraphDocument(sample);
    expect(JSON.parse(source).version).toBe(1);
    expect(parseGraphDocument(source)).toEqual(sample);
  });

  it("rejects unsupported versions", () => {
    expect(() => parseGraphDocument('{"version":2,"nodes":[],"edges":[]}'))
      .toThrow(GraphDocumentFormatError);
  });

  it("rejects duplicate IDs and unknown fields", () => {
    const duplicate = '{"version":1,"nodes":[{"id":"x","type":"number.constant"},{"id":"x","type":"number.constant"}],"edges":[]}';
    const extra = '{"version":1,"nodes":[],"edges":[],"executable":"alert(1)"}';
    expect(() => parseGraphDocument(duplicate)).toThrow(/Duplicate node id/);
    expect(() => parseGraphDocument(extra)).toThrow(/unknown field/);
  });

  it("rejects unsafe object keys and non-finite numbers", () => {
    const unsafe = '{"version":1,"nodes":[{"id":"x","type":"number.constant","params":{"__proto__":{"polluted":true}}}],"edges":[]}';
    const tooLargeNumber = '{"version":1,"nodes":[{"id":"x","type":"number.constant","params":{"value":1e400}}],"edges":[]}';
    expect(() => parseGraphDocument(unsafe)).toThrow(/reserved object key/);
    expect(() => parseGraphDocument(tooLargeNumber)).toThrow(/finite numbers/);
  });

  it("rejects non-finite values when serializing", () => {
    const invalid: GraphDocument = {
      nodes: [{ id: "bad", type: "number.constant", params: { value: Number.NaN } }],
      edges: [],
    };
    expect(() => serializeGraphDocument(invalid)).toThrow(/finite numbers/);
  });

  it("rejects edges that reference missing nodes", () => {
    const invalid = '{"version":1,"nodes":[],"edges":[{"id":"e","fromNodeId":"missing","fromPort":"value","toNodeId":"also-missing","toPort":"a"}]}';
    expect(() => parseGraphDocument(invalid)).toThrow(/node that does not exist/);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseGraphDocument("{")).toThrow(/valid JSON/);
  });
});
