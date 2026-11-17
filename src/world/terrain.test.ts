import { describe, expect, it } from "vitest";
import { DEFAULT_TERRAIN_RECIPE, validateTerrainRecipe } from "./recipe";
import { generateTerrain, deriveSubsystemSeed } from "./terrain/landforms";
import { sampleElevation, sampleSurface, sampleCurvature } from "./fields/heightfield";
import { buildHeightfieldMesh } from "./mesh/heightfield-mesh";
import { createHeightfield } from "./fields/heightfield";
import { buildDrainageField } from "./hydrology/drainage";
import { extractRiverNetwork } from "./hydrology/rivers";
import { generateVegetation } from "./ecology/vegetation";
import { generateDensityWorld } from "./volume/density-world";
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
    const irregular = generateTerrain(recipe({ ridgeIrregularity: 0.7 }));
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
    const expectedVertices = field.width * field.height + perimeterVertices * 2 + 1;
    const expectedTriangles = (field.width - 1) * (field.height - 1) * 2 + perimeterVertices * 3;
    expect(mesh.vertexCount).toBe(expectedVertices);
    expect(mesh.triangleCount).toBe(expectedTriangles);
    expect(mesh.indices.length).toBe(expectedTriangles * 3);
    const maximumIndex = mesh.indices.reduce((maximum, value) => Math.max(maximum, value), 0);
    const minimumIndex = mesh.indices.reduce((minimum, value) => Math.min(minimum, value), Infinity);
    expect(maximumIndex).toBeLessThan(mesh.vertexCount);
    expect(minimumIndex).toBeGreaterThanOrEqual(0);
    expect(Array.from(mesh.normals).every(Number.isFinite)).toBe(true);
    expect(Array.from(mesh.positions).every(Number.isFinite)).toBe(true);
  });
  it("builds meshes at the maximum supported grid scale without argument overflow", () => {
    const width = 512, height = 256;
    const field = createHeightfield(width, height, new Float32Array(width * height).fill(0.1));
    const mesh = buildHeightfieldMesh(field);
    expect(mesh.vertexCount).toBeGreaterThan(width * height);
    expect(mesh.triangleCount).toBeGreaterThan((width - 1) * (height - 1) * 2);
    expect(Number.isFinite(mesh.positions[0])).toBe(true);
  });

  it("generates a closed volumetric terrain mesh with Surface Nets",()=>{
    const world=generateDensityWorld(recipe(),{width:28,height:20,depth:28});
    expect(world.volume.values.length).toBe(28*20*28);
    expect(world.mesh.vertexCount).toBeGreaterThan(0);
    expect(world.mesh.triangleCount).toBeGreaterThan(0);
    expect(world.mesh.indices.length%3).toBe(0);
    expect(world.mesh.lods).toHaveLength(3);
    expect(world.mesh.lods[0].vertexCount).toBe(world.mesh.vertexCount);
    expect(world.mesh.lods[1].vertexCount).toBeLessThan(world.mesh.lods[0].vertexCount);
    expect(world.mesh.lods[2].vertexCount).toBeLessThan(world.mesh.lods[1].vertexCount);
    expect(world.mesh.lods.every(lod=>lod.indices.length%3===0&&lod.chunks.length>0)).toBe(true);
    expect(world.mesh.chunks.length).toBeGreaterThan(0);
    expect(world.mesh.chunks.reduce((sum,chunk)=>sum+chunk.indexCount,0)).toBe(world.mesh.indices.length);
    expect(world.mesh.chunks.every(chunk=>chunk.startIndex>=0&&chunk.indexCount>0
      &&chunk.startIndex+chunk.indexCount<=world.mesh.indices.length)).toBe(true);
    expect(world.mesh.indices.reduce((m,v)=>Math.max(m,v),0)).toBeLessThan(world.mesh.vertexCount);
    expect(Array.from(world.mesh.positions).every(Number.isFinite)).toBe(true);
    expect(Array.from(world.mesh.normals).every(Number.isFinite)).toBe(true);
    expect(world.heightfield.values.some(value=>value>0.05)).toBe(true);
    expect(world.diagnostics.samples).toBe(world.volume.values.length);
  });
  it("rejects unsafe recipes", () => {
    expect(() => validateTerrainRecipe({ ...recipe(), width: 900 })).toThrow();
  });

  it("builds deterministic, acyclic multi-outlet drainage without changing terrain", () => {
    const width = 9, height = 9;
    const values = new Float32Array(width * height).fill(0.5);
    for (let z = 0; z < height; z += 1) {
      for (let x = 0; x < width; x += 1) {
        if (x === 0 || z === 0 || x === width - 1 || z === height - 1) values[z * width + x] = 0.01;
      }
    }
    values[4 * width + 4] = 0.1;
    const field = createHeightfield(width, height, values);
    const before = Array.from(field.values);
    const drainage = buildDrainageField(field);
    const repeated = buildDrainageField(field);
    expect(Array.from(drainage.filledElevation)).toEqual(Array.from(repeated.filledElevation));
    expect(Array.from(drainage.flowTo)).toEqual(Array.from(repeated.flowTo));
    expect(Array.from(drainage.accumulation)).toEqual(Array.from(repeated.accumulation));
    expect(drainage.diagnostics.outletCount).toBe(32);
    expect(drainage.diagnostics.filledCellCount).toBeGreaterThan(0);
    expect(drainage.filledElevation[4 * width + 4]).toBeGreaterThan(values[4 * width + 4]);
    expect(Array.from(field.values)).toEqual(before);

    let outletAccumulation = 0;
    for (const outlet of drainage.outletIndices) outletAccumulation += drainage.accumulation[outlet];
    expect(outletAccumulation).toBeCloseTo(width * height, 4);
    for (let index = 0; index < width * height; index += 1) {
      const downstream = drainage.flowTo[index];
      expect(drainage.basinId[index]).toBeGreaterThanOrEqual(0);
      if (downstream >= 0) {
        expect(Math.abs((index % width) - (downstream % width))).toBeLessThanOrEqual(1);
        expect(Math.abs(Math.floor(index / width) - Math.floor(downstream / width))).toBeLessThanOrEqual(1);
        expect(drainage.filledElevation[downstream]).toBeLessThanOrEqual(drainage.filledElevation[index]);
      }
    }
  });

  it("extracts connected downhill river channels from contributing area", () => {
    const width = 9, height = 9;
    const values = new Float32Array(width * height).fill(0.5);
    for (let z = 0; z < height; z += 1) {
      for (let x = 0; x < width; x += 1) {
        if (x === 0 || z === 0 || x === width - 1 || z === height - 1) values[z * width + x] = 0.01;
      }
    }
    values[4 * width + 4] = 0.1;
    const field = createHeightfield(width, height, values);
    const drainage = buildDrainageField(field);
    const cellArea = ((field.bounds.maxX - field.bounds.minX) / (width - 1))
      * ((field.bounds.maxZ - field.bounds.minZ) / (height - 1));
    const rivers = extractRiverNetwork(field, drainage, { minimumContributingArea: cellArea * 2 });

    expect(rivers.diagnostics.channelCellCount).toBe(rivers.channelIndices.length);
    expect(rivers.channelIndices.length).toBeGreaterThan(0);
    expect(rivers.headwaterIndices.length).toBeGreaterThan(0);
    expect(rivers.outletIndices.length).toBeGreaterThan(0);
    for (const index of rivers.channelIndices) {
      expect(rivers.channelMask[index]).toBe(1);
      expect(rivers.width[index]).toBeGreaterThan(0);
      expect(rivers.width[index]).toBeLessThanOrEqual(Math.min(
        (field.bounds.maxX - field.bounds.minX) / (width - 1),
        (field.bounds.maxZ - field.bounds.minZ) / (height - 1),
      ) * 3 + 1e-6);
      const next = rivers.downstream[index];
      if (next >= 0) {
        expect(rivers.channelMask[next]).toBe(1);
        expect(drainage.accumulation[next]).toBeGreaterThanOrEqual(drainage.accumulation[index]);
        expect(drainage.filledElevation[next]).toBeLessThanOrEqual(drainage.filledElevation[index]);
      } else {
        const x = index % width;
        const z = Math.floor(index / width);
        expect(x === 0 || z === 0 || x === width - 1 || z === height - 1).toBe(true);
      }
    }
    expect(Array.from(rivers.width).every(Number.isFinite)).toBe(true);
  });

  it("rejects invalid river extraction thresholds", () => {
    const field = generateTerrain(recipe()).heightfield;
    const drainage = buildDrainageField(field);
    expect(() => extractRiverNetwork(field, drainage, { minimumContributingArea: 0 })).toThrow();
  });
  it("generates deterministic vegetation on suitable terrain", () => {
    const field = generateTerrain(recipe()).heightfield;
    const first = generateVegetation(field, 7341);
    const second = generateVegetation(field, 7341);
    expect(first.instances).toEqual(second.instances);
    expect(first.instances.length).toBeGreaterThan(0);
    expect(first.diagnostics.trees).toBe(first.instances.length);
    expect(first.instances.every(tree => tree.height > 0 && tree.y > 0
      && tree.x >= field.bounds.minX && tree.x <= field.bounds.maxX
      && tree.z >= field.bounds.minZ && tree.z <= field.bounds.maxZ)).toBe(true);
    expect(first.instances.every(tree => Math.abs(tree.y - sampleElevation(field, tree.x, tree.z)) < 0.001)).toBe(true);
    expect(first.groundCover).toEqual(second.groundCover);
    expect(first.groundCover.length).toBeGreaterThan(0);
    expect(first.diagnostics.groundCover).toBe(first.groundCover.length);
    expect(first.groundCover.every(item => [0, 1, 2, 3].includes(item.kind))).toBe(true);
    expect(first.groundCover.every(item => Math.abs(item.y - sampleElevation(field, item.x, item.z)) < 0.001)).toBe(true);
    expect(first.groundCover.every(item => item.scale > 0 && item.y > 0
      && item.x >= field.bounds.minX && item.x <= field.bounds.maxX
      && item.z >= field.bounds.minZ && item.z <= field.bounds.maxZ)).toBe(true);
  });
  it("isolates subsystem seeds", () => {
    expect(deriveSubsystemSeed(42, "forest")).toBe(deriveSubsystemSeed(42, "forest"));
    expect(deriveSubsystemSeed(42, "forest")).not.toBe(deriveSubsystemSeed(42, "terrain"));
  });
});
