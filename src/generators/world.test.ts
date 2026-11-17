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

  it("widens the river toward the foreground using perspective", () => {
    const world = createLandscapeWorld(640, 360, baseOptions);
    expect(world.river.length).toBeGreaterThan(20);
    expect(world.river[0].width).toBeLessThan(world.river[world.river.length - 1].width);
    expect(world.river[world.river.length - 1].y).toBeGreaterThan(world.river[0].y);
  });

  it("does not create a river when water is disabled", () => {
    const world = createLandscapeWorld(640, 360, { ...baseOptions, water: 0 });
    expect(world.river).toHaveLength(0);
  });

  it("changes the shared terrain profile when mountain parameters change", () => {
    const calm = createLandscapeWorld(640, 360, baseOptions);
    const rugged = createLandscapeWorld(640, 360, { ...baseOptions, roughness: 0.95, scale: 1.8 });
    expect(Array.from(calm.layers[2].surface)).not.toEqual(Array.from(rugged.layers[2].surface));
    expect(calm.river).not.toEqual(rugged.river);
  });
});
