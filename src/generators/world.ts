import { fbm2 } from "../core/noise";

export interface LandscapeOptions {
  seed: number;
  scale: number;
  roughness: number;
  octaves: number;
  mist: number;
  forest: number;
  water: number;
}

export interface TerrainLayer {
  readonly base: number;
  readonly amplitude: number;
  readonly color: string;
  readonly frequency: number;
  readonly seed: number;
  readonly surface: Float32Array;
}

export interface RiverPoint {
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

export interface LandscapeWorld {
  readonly width: number;
  readonly height: number;
  readonly layers: readonly TerrainLayer[];
  readonly river: readonly RiverPoint[];
}

const layerSettings = [
  { base: 0.58, amplitude: 0.13, color: "#597e78", frequency: 1.5, seed: 11 },
  { base: 0.70, amplitude: 0.16, color: "#315e59", frequency: 2.2, seed: 37 },
  { base: 0.84, amplitude: 0.13, color: "#183b3c", frequency: 3.1, seed: 83 },
] as const;

export function sampleSurface(layer: TerrainLayer, x: number, width: number): number {
  const position = Math.max(0, Math.min(1, x / Math.max(1, width))) * (layer.surface.length - 1);
  const left = Math.floor(position);
  const right = Math.min(layer.surface.length - 1, left + 1);
  const blend = position - left;
  return layer.surface[left] * (1 - blend) + layer.surface[right] * blend;
}

function findValley(layer: TerrainLayer, center: number, radius: number): number {
  const count = layer.surface.length - 1;
  const middle = Math.max(0, Math.min(count, Math.round(center * count)));
  const reach = Math.max(2, Math.round(radius * count));
  let best = middle;
  let lowest = -Infinity;
  for (let index = Math.max(0, middle - reach); index <= Math.min(count, middle + reach); index += 1) {
    if (layer.surface[index] > lowest) {
      lowest = layer.surface[index];
      best = index;
    }
  }
  return best / count;
}

/** Builds the shared terrain profiles and a river route that follows their low valleys. */
export function createLandscapeWorld(width: number, height: number, options: LandscapeOptions): LandscapeWorld {
  const samples = Math.min(420, Math.max(100, Math.round(width / 3)));
  const layers: TerrainLayer[] = layerSettings.map((settings) => {
    const surface = new Float32Array(samples + 1);
    for (let index = 0; index <= samples; index += 1) {
      const nx = (index / samples) * options.scale * settings.frequency;
      const broad = fbm2(nx * 3, settings.seed, options.seed + settings.seed, options.octaves, 0.52, 2);
      const fine = fbm2(nx * 11, settings.seed * 0.17, options.seed + settings.seed * 3, options.octaves, options.roughness, 2.1);
      const ridge = Math.abs(fine * 2 - 1);
      const displacement = (broad - 0.5) * 0.72 + (ridge - 0.5) * options.roughness * 0.28;
      surface[index] = settings.base + displacement * settings.amplitude;
    }
    return { ...settings, surface };
  });

  const riverStrength = Math.max(0, Math.min(1, options.water));
  const river: RiverPoint[] = [];
  if (riverStrength > 0.01) {
    const nearTerrain = layers[2];
    const middleTerrain = layers[1];
    const anchor = findValley(middleTerrain, 0.5, 0.22);
    let previousX = anchor;
    const count = 72;
    for (let index = 0; index <= count; index += 1) {
      const t = index / count;
      const drift = (fbm2(t * 2.2, 0.31, options.seed + 701, 3, 0.58, 2) - 0.5) * 0.13
        + Math.sin(t * 7.2 + options.seed * 0.013) * 0.035;
      const desired = Math.max(0.08, Math.min(0.92, anchor + drift));
      const searchRadius = 0.012 + t * 0.025;
      const valley = findValley(nearTerrain, previousX * 0.72 + desired * 0.28, searchRadius);
      const xNorm = Math.max(0.06, Math.min(0.94, valley * 0.62 + desired * 0.38));
      previousX = xNorm;
      const terrainY = sampleSurface(nearTerrain, xNorm * width, width);
      const y = Math.max(terrainY + height * 0.012, terrainY + t * (height * 0.23) + height * 0.012);
      const perspective = Math.pow(t, 1.55);
      const riverWidth = width * (0.0025 + riverStrength * 0.145 * perspective);
      river.push({ x: xNorm * width, y: Math.min(height * 1.08, y), width: riverWidth });
    }
  }

  return { width, height, layers, river };
}
