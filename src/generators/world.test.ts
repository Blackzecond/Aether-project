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

describe("shared landscape world", () => {
  it("reproduces terrain and river paths for the same seed", () => {
    const first = createLandscapeWorld(640, 360, baseOptions);
    const second = createLandscapeWorld(640, 360, baseOptions);
    expect(Array.from(first.layers[2].surface)).toEqual(Array.from(second.layers[2].surface));
    expect(first.river).toEqual(second.river);
  });

  it("keeps river endpoints anchored when terrain parameters change", () => {
    const calm = createLandscapeWorld(640, 360, baseOptions);
    const rugged = createLandscapeWorld(640, 360, { ...baseOptions, roughness: 0.95, scale: 1.8 });
    expect(calm.river[0].x).toBe(rugged.river[0].x);
    expect(calm.river.at(-1)?.x).toBe(rugged.river.at(-1)?.x);
    expect(calm.river[0].y).toBe(rugged.river[0].y);
  });

  it("keeps the river path continuous without abrupt lateral jumps", () => {
    const world = createLandscapeWorld(640, 360, baseOptions);
    const largestStep = Math.max(...world.river.slice(1).map((point, index) =>
      Math.abs(point.x - world.river[index].x)));
    expect(largestStep).toBeLessThan(640 * 0.075);
    expect(world.river.every((point, index) => index === 0 || point.y > world.river[index - 1].y)).toBe(true);
  });

  it("scales the complete river width uniformly with the water control", () => {
    const narrow = createLandscapeWorld(640, 360, { ...baseOptions, water: 0.35 });
    const wide = createLandscapeWorld(640, 360, { ...baseOptions, water: 0.7 });
    expect(narrow.river).toHaveLength(wide.river.length);
    for (let index = 0; index < narrow.river.length; index += 1) {
      expect(narrow.river[index].width).toBeCloseTo(wide.river[index].width * 0.5, 5);
    }
  });

  it("widens the river toward the foreground using perspective", () => {
    const world = createLandscapeWorld(640, 360, baseOptions);
    expect(world.river.length).toBeGreaterThan(20);
    expect(world.river[0].width).toBeLessThan(world.river[world.river.length - 1].width);
    expect(world.river[0].y).toBeLessThan(360 * 0.8);
    expect(world.river[world.river.length - 1].y).toBeGreaterThan(360);
    expect(world.river[world.river.length - 1].y).toBeGreaterThan(world.river[0].y);
  });

  it("does not create a river when water is disabled", () => {
    const world = createLandscapeWorld(640, 360, { ...baseOptions, water: 0 });
    expect(world.river).toHaveLength(0);
  });

  it("changes terrain and the route interior when mountain parameters change", () => {
    const calm = createLandscapeWorld(640, 360, baseOptions);
    const rugged = createLandscapeWorld(640, 360, { ...baseOptions, roughness: 0.95, scale: 1.8 });
    expect(Array.from(calm.layers[2].surface)).not.toEqual(Array.from(rugged.layers[2].surface));
    expect(calm.river.slice(1, -1)).not.toEqual(rugged.river.slice(1, -1));
  });
});
