import { describe, expect, it } from "vitest";
import { createLandscapeWorld } from "./world";

const baseOptions = {
  seed: 417,
  scale: 1.2,
  roughness: 0.55,
  octaves: 4,
  mist: 0.3,
  forest: 0.5,
  water: 0.7,
};

describe("shared terrain, hydrology and ecology", () => {
  it("reproduces the complete world deterministically", () => {
    const first = createLandscapeWorld(640, 360, baseOptions);
    const second = createLandscapeWorld(640, 360, baseOptions);
    expect(Array.from(first.elevation)).toEqual(Array.from(second.elevation));
    expect(Array.from(first.moisture)).toEqual(Array.from(second.moisture));
    expect(first.river).toEqual(second.river);
    expect(Array.from(first.layers[2].surface)).toEqual(Array.from(second.layers[2].surface));
  });

  it("builds a real 2D elevation field with connected mountain and valley variation", () => {
    const world = createLandscapeWorld(640, 360, baseOptions);
    expect(world.fieldWidth).toBeGreaterThan(32);
    expect(world.fieldHeight).toBeGreaterThan(32);
    expect(Math.max(...world.elevation)).toBeGreaterThan(Math.min(...world.elevation) + 0.2);
    expect(world.layers[0].surface).not.toEqual(world.layers[1].surface);
    expect(world.layers[1].surface).not.toEqual(world.layers[2].surface);
  });

  it("keeps its headwater anchor stable when the terrain changes", () => {
    const calm = createLandscapeWorld(640, 360, baseOptions);
    const rugged = createLandscapeWorld(640, 360, { ...baseOptions, roughness: 0.95, scale: 1.8 });
    expect(calm.river[0].x).toBe(rugged.river[0].x);
    expect(calm.river[0].depth).toBe(rugged.river[0].depth);
  });

  it("routes the river from the upper landscape toward the downstream edge", () => {
    const world = createLandscapeWorld(640, 360, baseOptions);
    expect(world.river.length).toBeGreaterThan(8);
    expect(world.river[0].depth).toBeLessThan(0.3);
    expect(world.river.at(-1)!.depth).toBeGreaterThan(0.95);
    expect(world.river.every((point) => point.y > 0 && point.y < 360 * 1.2)).toBe(true);
    expect(world.river.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
  });

  it("projects river height from terrain instead of a flat screen-space line", () => {
    const world = createLandscapeWorld(640, 360, baseOptions);
    const point = world.river[Math.floor(world.river.length * 0.4)];
    const flatOverlayY = 360 * (0.30 + point.depth * 0.62);
    expect(Math.abs(point.y - flatOverlayY)).toBeGreaterThan(0.5);
  });

  it("scales river width globally while keeping its route unchanged", () => {
    const narrow = createLandscapeWorld(640, 360, { ...baseOptions, water: 0.35 });
    const wide = createLandscapeWorld(640, 360, { ...baseOptions, water: 0.7 });
    expect(narrow.river).toHaveLength(wide.river.length);
    for (let index = 0; index < narrow.river.length; index += 1) {
      expect(narrow.river[index].x).toBe(wide.river[index].x);
      expect(narrow.river[index].y).toBe(wide.river[index].y);
      expect(narrow.river[index].width).toBeCloseTo(wide.river[index].width * 0.5, 5);
    }
  });

  it("does not create a river when water is disabled", () => {
    const world = createLandscapeWorld(640, 360, { ...baseOptions, water: 0 });
    expect(world.river).toHaveLength(0);
  });

  it("changes shared terrain and drainage when mountain parameters change", () => {
    const calm = createLandscapeWorld(640, 360, baseOptions);
    const rugged = createLandscapeWorld(640, 360, { ...baseOptions, roughness: 0.95, scale: 1.8 });
    expect(Array.from(calm.elevation)).not.toEqual(Array.from(rugged.elevation));
    expect(calm.river.map((point) => [point.x, point.y]))
      .not.toEqual(rugged.river.map((point) => [point.x, point.y]));
  });
});
