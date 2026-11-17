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
    const relief = generateTerrain(recipe({ relief: 1.15 }));
    const rough = generateTerrain(recipe({ roughness: 0.48 }));
    const sharp = generateTerrain(recipe({ peakSharpness: 0.95 }));
    const spaced = generateTerrain(recipe({ mountainSpacing: 1.45 }));
    const irregular = generateTerrain(recipe({ ridgeIrregularity: 0.9 }));
    const fineDetail = generateTerrain(recipe({ detailScale: 10.5 }));
    const moreOctaves = generateTerrain(recipe({ detailOctaves: 6 }));
    expect(relief.diagnostics.mean).not.toBeCloseTo(base.diagnostics.mean, 3);
    expect(rough.diagnostics.variance).not.toBeCloseTo(base.diagnostics.variance, 5);
    expect(sharp.heightfield.values).not.toEqual(base.heightfield.values);
    expect(spaced.heightfield.values).not.toEqual(base.heightfield.values);
    expect(irregular.heightfield.values).not.toEqual(base.heightfield.values);
    expect(fineDetail.heightfield.values).not.toEqual(base.heightfield.values);
    expect(moreOctaves.heightfield.values).not.toEqual(base.heightfield.values);
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
    const perimeterVertices = 4 * (field.width + field.height) - 8;
    const expectedVertices = field.width * field.height + perimeterVertices * 2 + 4;
    const expectedTriangles = (field.width - 1) * (field.height - 1) * 2 + perimeterVertices * 2 + 2;
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
