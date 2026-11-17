import { hash32 } from "../../core/random";
import { createHeightfield, type Heightfield, sampleSurface } from "../fields/heightfield";
import { DEFAULT_WORLD_BOUNDS } from "../coordinates";
import { validateTerrainRecipe, type TerrainRecipe } from "../recipe";
import { fbmGradient2, gradientNoise2 } from "./noise";

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * A two-dimensional ridged multifractal field. Unlike parallel sine-wave
 * ridges, this creates branching, intersecting mountain crests and valleys.
 */
function ridgedMountains(x: number, z: number, seed: number, spacing: number, sharpness: number): number {
  const baseFrequency = 1.35 / spacing;
  let frequency = baseFrequency;
  let amplitude = 1;
  let total = 0;
  let weightSum = 0;
  let weight = 1;
  const exponent = 0.85 + sharpness * 2.65;

  for (let octave = 0; octave < 5; octave += 1) {
    const signal = 1 - Math.abs(gradientNoise2(x * frequency, z * frequency, seed + octave * 1013));
    const ridge = Math.pow(clamp(signal, 0, 1), exponent);
    const contribution = ridge * weight;
    total += contribution * amplitude;
    weightSum += amplitude;
    weight = clamp(contribution * 2.1, 0, 1);
    frequency *= 2.03;
    amplitude *= 0.52;
  }
  return weightSum > 0 ? total / weightSum : 0;
}

export interface TerrainDiagnostics {
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly variance: number;
  readonly slopeMean: number;
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
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let sumSquares = 0;

  // Keep high octaves within the grid's practical sampling limit without
  // disabling the detail-scale control at larger octave counts.
  const detailLacunarity = landform.detailOctaves > 1
    ? Math.min(1.9, Math.pow(20 / landform.detailScale, 1 / (landform.detailOctaves - 1)))
    : 1.9;

  for (let iz = 0; iz < height; iz += 1) {
    const z = bounds.minZ + (iz / (height - 1)) * (bounds.maxZ - bounds.minZ);
    for (let ix = 0; ix < width; ix += 1) {
      const x = bounds.minX + (ix / (width - 1)) * (bounds.maxX - bounds.minX);

      // Low-frequency domain warping bends and splits the mountain systems.
      const warpX = fbmGradient2(x * 1.15, z * 1.15, seed + 71, 3) * landform.ridgeIrregularity * 0.42;
      const warpZ = fbmGradient2(x * 1.15, z * 1.15, seed + 97, 3) * landform.ridgeIrregularity * 0.42;
      const warpedX = x + warpX;
      const warpedZ = z + warpZ;

      // Broad massifs determine where mountain groups exist. Ridged noise
      // supplies the connected crests; foothills soften their transition.
      const massifNoise = fbmGradient2(warpedX * 0.92, warpedZ * 0.92, seed + 1009, 3);
      const massif = smoothstep(-0.22, 0.38, massifNoise);
      const ridges = ridgedMountains(
        warpedX,
        warpedZ,
        seed + 2017,
        landform.mountainSpacing,
        landform.peakSharpness,
      );
      const foothillNoise = fbmGradient2(x * 1.7, z * 1.7, seed + 3011, 3);
      const foothills = Math.pow(smoothstep(-0.28, 0.42, foothillNoise), 1.35) * 0.16;
      const detail = fbmGradient2(
        x * landform.detailScale,
        z * landform.detailScale,
        seed + 4001,
        landform.detailOctaves,
        0.52,
        detailLacunarity,
      );

      const mountainBody = massif * (0.16 + ridges * 0.78);
      const elevation = 0.025
        + (mountainBody + foothills) * landform.relief
        + detail * landform.roughness;
      // Fade the outer 13% of the world into a low plain so the terrain
      // joins the surrounding ground instead of ending as a raised island.
      const edgeDistance = Math.min(
        ix / (width - 1),
        iz / (height - 1),
        (width - 1 - ix) / (width - 1),
        (height - 1 - iz) / (height - 1),
      );
      const edgeFade = smoothstep(0, 0.13, edgeDistance);
      const groundedElevation = 0.01 + Math.max(0, elevation - 0.01) * edgeFade;
      const value = Math.fround(clamp(groundedElevation, 0, 1.5));
      values[iz * width + ix] = value;
      min = Math.min(min, value);
      max = Math.max(max, value);
      sum += value;
      sumSquares += value * value;
    }
  }

  const count = values.length;
  const mean = sum / count;
  const heightfield = createHeightfield(width, height, values, bounds);
  let slopeSum = 0;
  for (let iz = 1; iz < height - 1; iz += 1) {
    for (let ix = 1; ix < width - 1; ix += 1) {
      const x = bounds.minX + (ix / (width - 1)) * (bounds.maxX - bounds.minX);
      const z = bounds.minZ + (iz / (height - 1)) * (bounds.maxZ - bounds.minZ);
      slopeSum += sampleSurface(heightfield, x, z).slope;
    }
  }

  return {
    heightfield,
    diagnostics: {
      min,
      max,
      mean,
      variance: Math.max(0, sumSquares / count - mean * mean),
      slopeMean: slopeSum / ((width - 2) * (height - 2)),
    },
    recipe,
  };
}

export function deriveSubsystemSeed(seed: number, subsystem: string): number {
  let key = 2166136261;
  for (let i = 0; i < subsystem.length; i += 1) {
    key = Math.imul(key ^ subsystem.charCodeAt(i), 16777619);
  }
  return hash32(seed ^ key);
}
