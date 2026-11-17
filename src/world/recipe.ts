/** Versioned, serializable inputs for deterministic world generation. */
export interface TerrainRecipe {
  readonly version: 1;
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly bounds?: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number };
  readonly landform: {
    readonly mountainSpacing: number;
    readonly relief: number;
    readonly peakSharpness: number;
    readonly ridgeIrregularity: number;
    readonly roughness: number;
    readonly detailScale: number;
    readonly detailOctaves: number;
  };
}
export const DEFAULT_TERRAIN_RECIPE: TerrainRecipe = Object.freeze({
  version: 1, seed: 18273, width: 128, height: 128,
  landform: {
    mountainSpacing: 0.72, relief: 0.72, peakSharpness: 0.58,
    ridgeIrregularity: 0.32, roughness: 0.16, detailScale: 5.5, detailOctaves: 4,
  },
});
export function validateTerrainRecipe(recipe: TerrainRecipe): void {
  const { width, height, landform } = recipe;
  if (recipe.version !== 1) throw new Error("Unsupported terrain recipe version");
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8 || width > 512 || height > 512) {
    throw new Error("Terrain dimensions must be integers between 8 and 512");
  }
  if (!Number.isFinite(recipe.seed)) throw new Error("Seed must be finite");
  const ranges: Array<[number, number, number, string]> = [
    [landform.mountainSpacing, 0.2, 2.5, "mountainSpacing"],
    [landform.relief, 0.05, 1.5, "relief"],
    [landform.peakSharpness, 0, 1, "peakSharpness"],
    [landform.ridgeIrregularity, 0, 1, "ridgeIrregularity"],
    [landform.roughness, 0, 0.6, "roughness"],
    [landform.detailScale, 1, 16, "detailScale"],
    [landform.detailOctaves, 1, 7, "detailOctaves"],
  ];
  for (const [value, min, max, name] of ranges) {
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid terrain parameter: ${name}`);
  }
}
