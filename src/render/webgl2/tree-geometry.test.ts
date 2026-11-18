import { describe, expect, it } from "vitest";
import { buildProceduralTreeGeometry } from "./tree-geometry";

describe("procedural tree geometry", () => {
  it("builds deterministic finite geometry at each LOD", () => {
    for (const detail of ["high", "medium", "low"] as const) {
      const first = buildProceduralTreeGeometry(detail);
      const second = buildProceduralTreeGeometry(detail);
      expect(first.length).toBeGreaterThan(0);
      expect(first.length % 9).toBe(0);
      expect(first).toEqual(second);
      expect(Array.from(first).every(Number.isFinite)).toBe(true);
    }
  });

  it("reduces geometry monotonically across LODs", () => {
    const high = buildProceduralTreeGeometry("high");
    const medium = buildProceduralTreeGeometry("medium");
    const low = buildProceduralTreeGeometry("low");
    expect(high.length).toBeGreaterThan(medium.length);
    expect(medium.length).toBeGreaterThan(low.length);
  });

  it("contains both bark and cutout leaf surfaces", () => {
    const geometry = buildProceduralTreeGeometry("high");
    const parts = new Set<number>();
    for (let offset = 8; offset < geometry.length; offset += 9) parts.add(geometry[offset]);
    expect(parts.has(0)).toBe(true);
    expect(parts.has(1)).toBe(true);
  });
});
