import { hash32 } from "../../core/random";
import { createHeightfield, type Heightfield } from "../fields/heightfield";
import { DEFAULT_WORLD_BOUNDS } from "../coordinates";
import { validateTerrainRecipe, type TerrainRecipe } from "../recipe";
import { fbmGradient2 } from "./noise";
const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
function ridgeField(x: number, z: number, seed: number, spacing: number, irregularity: number, sharpness: number): number {
  const warpX = fbmGradient2(x * 1.7, z * 1.7, seed + 71, 3) * irregularity * 0.13;
  const warpZ = fbmGradient2(x * 1.7, z * 1.7, seed + 97, 3) * irregularity * 0.13;
  const px = x + warpX, pz = z + warpZ;
  const spine = Math.sin((pz * 1.65 + fbmGradient2(px * 1.1, pz * 1.1, seed + 131, 2) * irregularity * 0.35) * Math.PI);
  const distance = Math.abs(px - spine * 0.23) / spacing;
  const rounded = Math.exp(-distance * distance * 2.2);
  const sharp = Math.pow(Math.max(0, 1 - Math.abs(distance)), 1 + sharpness * 5);
  return clamp(rounded * (1 - sharpness) + sharp * sharpness, 0, 1);
}
export interface TerrainDiagnostics {
  readonly min: number; readonly max: number; readonly mean: number;
  readonly variance: number; readonly slopeMean: number;
}
export interface TerrainGeneration {
  readonly heightfield: Heightfield;
  readonly diagnostics: TerrainDiagnostics;
  readonly recipe: TerrainRecipe;
}
export function generateTerrain(recipe: TerrainRecipe): TerrainGeneration {
  validateTerrainRecipe(recipe);
  const { width, height, seed, landform } = recipe;
  const bounds = recipe.bounds ?? DEFAULT_WORLD_BOUNDS;
  const values = new Float32Array(width * height);
  let min = Infinity, max = -Infinity, sum = 0, sumSquares = 0;
  for (let iz = 0; iz < height; iz += 1) {
    const z = bounds.minZ + (iz / (height - 1)) * (bounds.maxZ - bounds.minZ);
    for (let ix = 0; ix < width; ix += 1) {
      const x = bounds.minX + (ix / (width - 1)) * (bounds.maxX - bounds.minX);
      const broad = fbmGradient2(x * 1.25, z * 1.1, seed + 1009, 3) * 0.11;
      const ridge = ridgeField(x, z, seed + 2017, landform.mountainSpacing, landform.ridgeIrregularity, landform.peakSharpness);
      const foothill = Math.max(0, fbmGradient2(x * 0.85, z * 0.85, seed + 3011, 2) + 0.12) * 0.11;
      const detail = fbmGradient2(x * landform.detailScale, z * landform.detailScale, seed + 4001, landform.detailOctaves) * landform.roughness;
      const elevation = 0.08 + (ridge * 0.72 + broad + foothill + detail) * landform.relief;
      const value = Math.fround(clamp(elevation, 0, 1.5));
      values[iz * width + ix] = value;
      min = Math.min(min, value); max = Math.max(max, value); sum += value; sumSquares += value * value;
    }
  }
  const count = values.length, mean = sum / count;
  let slopeSum = 0;
  const heightfield = createHeightfield(width, height, values, bounds);
  for (let iz = 1; iz < height - 1; iz += 1) for (let ix = 1; ix < width - 1; ix += 1) {
    const x = bounds.minX + (ix / (width - 1)) * (bounds.maxX - bounds.minX);
    const z = bounds.minZ + (iz / (height - 1)) * (bounds.maxZ - bounds.minZ);
    const { slope } = (awaitlessSampleSurface)(heightfield, x, z);
    slopeSum += slope;
  }
  return {
    heightfield,
    diagnostics: { min, max, mean, variance: Math.max(0, sumSquares / count - mean * mean), slopeMean: slopeSum / ((width - 2) * (height - 2)) },
    recipe,
  };
}
import { sampleSurface as awaitlessSampleSurface } from "../fields/heightfield";
export function deriveSubsystemSeed(seed: number, subsystem: string): number {
  let key = 2166136261;
  for (let i = 0; i < subsystem.length; i += 1) key = Math.imul(key ^ subsystem.charCodeAt(i), 16777619);
  return hash32(seed ^ key);
}
