import { describe, expect, it } from "vitest";
import { DEFAULT_TERRAIN_RECIPE, validateTerrainRecipe } from "./recipe";
import { generateTerrain, deriveSubsystemSeed } from "./terrain/landforms";
import { sampleElevation, sampleSurface, sampleCurvature } from "./fields/heightfield";
import { buildHeightfieldMesh } from "./mesh/heightfield-mesh";
function recipe(overrides: Partial<typeof DEFAULT_TERRAIN_RECIPE["landform"]> = {}) {
  return { ...DEFAULT_TERRAIN_RECIPE, landform: { ...DEFAULT_TERRAIN_RECIPE.landform, ...overrides } };
}
describe("world foundation v2", () => {
  it("is deterministic for the same recipe", () => {
    const a = generateTerrain(recipe()), b = generateTerrain(recipe());
    expect(Array.from(a.heightfield.values)).toEqual(Array.from(b.heightfield.values));
  });
  it("produces a real 2D field with measurable relief", () => {
    const world = generateTerrain(recipe());
    expect(world.diagnostics.max - world.diagnostics.min).toBeGreaterThan(0.12);
    expect(world.diagnostics.variance).toBeGreaterThan(0.0001);
    expect(sampleElevation(world.heightfield, 0, 0)).toBeGreaterThanOrEqual(0);
  });
  it("separates macro spacing, relief, sharpness and roughness controls", () => {
    const base = generateTerrain(recipe());
    const relief = generateTerrain(recipe({ relief: 0.95 }));
    const rough = generateTerrain(recipe({ roughness: 0.24 }));
    const sharp = generateTerrain(recipe({ peakSharpness: 0.68 }));
    const spaced = generateTerrain(recipe({ mountainSpacing: 1.45 }));
    const irregular = generateTerrain(recipe({ ridgeIrregularity: 0.9 }));
    const fineDetail = generateTerrain(recipe({ detailScale: 4.8 }));
    const moreOctaves = generateTerrain(recipe({ detailOctaves: 4 }));
    expect(relief.diagnostics.mean).not.toBeCloseTo(base.diagnostics.mean, 3);
    expect(rough.diagnostics.variance).not.toBeCloseTo(base.diagnostics.variance, 5);
    expect(sharp.heightfield.values).not.toEqual(base.heightfield.values);
    expect(spaced.heightfield.values).not.toEqual(base.heightfield.values);
    expect(irregular.heightfield.values).not.toEqual(base.heightfield.values);
    expect(fineDetail.heightfield.values).not.toEqual(base.heightfield.values);
    expect(moreOctaves.heightfield.values).not.toEqual(base.heightfield.values);
  });
  it("tapers the terrain perimeter into the surrounding low plain", () => {
    const field = generateTerrain(recipe()).heightfield;
    for (let x = 0; x < field.width; x += 1) {
      expect(field.values[x]).toBeCloseTo(0.01, 5);
      expect(field.values[(field.height - 1) * field.width + x]).toBeCloseTo(0.01, 5);
    }
    for (let z = 0; z < field.height; z += 1) {
      expect(field.values[z * field.width]).toBeCloseTo(0.01, 5);
      expect(field.values[z * field.width + field.width - 1]).toBeCloseTo(0.01, 5);
    }
    expect(field.values[Math.floor(field.height / 2) * field.width + Math.floor(field.width / 2)]).toBeGreaterThan(0.1);
  });
  it("samples surface normal, slope and curvature", () => {
    const field = generateTerrain(recipe()).heightfield;
    const sample = sampleSurface(field, 0, 0);
    expect(sample.normal.y).toBeGreaterThan(0);
    expect(sample.normal.x ** 2 + sample.normal.y ** 2 + sample.normal.z ** 2).toBeCloseTo(1, 5);
    expect(Number.isFinite(sampleCurvature(field, 0, 0))).toBe(true);
  });
  it("builds an indexed mesh with valid indices and finite normals", () => {
    const field = generateTerrain(recipe()).heightfield;
    const mesh = buildHeightfieldMesh(field);
    const perimeterVertices = 2 * (field.width + field.height) - 4;
    const expectedVertices = field.width * field.height + perimeterVertices * 2 + 1 + 4;
    const expectedTriangles = (field.width - 1) * (field.height - 1) * 2 + perimeterVertices * 3 + 2;
    expect(mesh.vertexCount).toBe(expectedVertices);
    expect(mesh.triangleCount).toBe(expectedTriangles);
    expect(mesh.indices.length).toBe(expectedTriangles * 3);
    expect(Math.max(...Array.from(mesh.indices))).toBeLessThan(mesh.vertexCount);
    expect(Math.min(...Array.from(mesh.indices))).toBeGreaterThanOrEqual(0);
    expect(Array.from(mesh.normals).every(Number.isFinite)).toBe(true);
    expect(Array.from(mesh.positions).every(Number.isFinite)).toBe(true);
  });
  it("rejects unsafe recipes", () => {
    expect(() => validateTerrainRecipe({ ...recipe(), width: 900 })).toThrow();
  });
  it("isolates subsystem seeds", () => {
    expect(deriveSubsystemSeed(42, "forest")).toBe(deriveSubsystemSeed(42, "forest"));
    expect(deriveSubsystemSeed(42, "forest")).not.toBe(deriveSubsystemSeed(42, "terrain"));
  });
});
