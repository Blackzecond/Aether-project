import type { GraphNodeDefinition, GraphValue } from "./graph";

function numberValue(
  values: Readonly<Record<string, GraphValue>>,
  key: string,
  fallback?: number,
): number {
  const value = values[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === undefined && fallback !== undefined) return fallback;
  throw new TypeError('Expected a finite number for input "' + key + '".');
}

export function createCoreNodeRegistry(): ReadonlyMap<string, GraphNodeDefinition> {
  const definitions: GraphNodeDefinition[] = [
    {
      type: "number.constant",
      inputs: [],
      outputs: ["value"],
      evaluate: (_inputs, params) => {
        const value = params.value ?? 0;
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new TypeError('Parameter "value" must be a finite number.');
        }
        return { value };
      },
    },
    {
      type: "math.add",
      inputs: ["a", "b"],
      outputs: ["value"],
      evaluate: (inputs) => ({ value: numberValue(inputs, "a") + numberValue(inputs, "b") }),
    },
    {
      type: "math.multiply",
      inputs: ["a", "b"],
      outputs: ["value"],
      evaluate: (inputs) => ({ value: numberValue(inputs, "a") * numberValue(inputs, "b") }),
    },
    {
      type: "math.clamp",
      inputs: ["value", "min", "max"],
      outputs: ["value"],
      evaluate: (inputs, params) => {
        const value = numberValue(inputs, "value");
        const min = numberValue(inputs, "min", typeof params.min === "number" ? params.min : 0);
        const max = numberValue(inputs, "max", typeof params.max === "number" ? params.max : 1);
        if (min > max) throw new RangeError("Clamp minimum cannot exceed maximum.");
        return { value: Math.min(max, Math.max(min, value)) };
      },
    },
  ];
  return new Map(definitions.map((definition) => [definition.type, definition]));
}
