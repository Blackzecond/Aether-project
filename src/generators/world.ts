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

function buildRiverRoute(options: LandscapeOptions): number[] {
  // A compact 2D elevation field. The route is solved from fixed endpoints,
  // rather than re-selecting a local valley independently at every sample.
  const columns = 80;
  const rows = 68;
  const maxStep = 3;
  const span = maxStep * 2 + 1;
  const heightField = new Float32Array(columns * rows);
  const terrainScale = Math.max(0.25, options.scale);
  const roughness = Math.max(0, Math.min(1, options.roughness));

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = column / (columns - 1);
      const z = row / (rows - 1);
      const broad = fbm2(x * terrainScale * 2.8, z * terrainScale * 2.1, options.seed + 1901, 4, 0.52, 2);
      const detail = fbm2(x * terrainScale * 7.5, z * terrainScale * 6.2, options.seed + 2903, 3, 0.55 + roughness * 0.12, 2.05);
      const ridge = Math.abs(detail * 2 - 1);
      heightField[row * columns + column] = broad * 0.78 + ridge * roughness * 0.22;
    }
  }

  // Endpoints depend only on the seed, so small terrain edits do not move them.
  const sourceX = 0.34 + fbm2(0.17, 0.83, options.seed + 3907, 2, 0.5, 2) * 0.32;
  const outletX = Math.max(0.12, Math.min(0.88,
    sourceX + (fbm2(0.73, 0.29, options.seed + 4909, 2, 0.5, 2) - 0.5) * 0.24));
  const start = Math.round(sourceX * (columns - 1));
  const end = Math.round(outletX * (columns - 1));

  const stateCount = columns * span;
  let previous = new Float64Array(stateCount).fill(Number.POSITIVE_INFINITY);
  const backDirections = new Int8Array(rows * stateCount);
  backDirections.fill(127);
  previous[start * span + maxStep] = heightField[start] * 2.4;

  for (let row = 1; row < rows; row += 1) {
    const current = new Float64Array(stateCount).fill(Number.POSITIVE_INFINITY);
    for (let column = 0; column < columns; column += 1) {
      for (let previousStep = -maxStep; previousStep <= maxStep; previousStep += 1) {
        const previousIndex = column * span + previousStep + maxStep;
        const baseCost = previous[previousIndex];
        if (!Number.isFinite(baseCost)) continue;
        for (let step = -maxStep; step <= maxStep; step += 1) {
          const nextColumn = column + step;
          if (nextColumn < 0 || nextColumn >= columns) continue;
          if (row === rows - 1 && nextColumn !== end) continue;
          const curvature = step - previousStep;
          const cost = baseCost
            + heightField[row * columns + nextColumn] * 2.4
            + step * step * 0.055
            + curvature * curvature * 0.19;
          const stateIndex = nextColumn * span + step + maxStep;
          if (cost < current[stateIndex]) {
            current[stateIndex] = cost;
            backDirections[row * stateCount + stateIndex] = previousStep;
          }
        }
      }
    }
    previous = current;
  }

  let bestState = -1;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let step = -maxStep; step <= maxStep; step += 1) {
    const stateIndex = end * span + step + maxStep;
    if (previous[stateIndex] < bestCost) {
      bestCost = previous[stateIndex];
      bestState = stateIndex;
    }
  }
  if (bestState < 0 || !Number.isFinite(bestCost)) {
    return Array.from({ length: rows }, (_, row) => start + (end - start) * row / (rows - 1));
  }

  const route = new Array<number>(rows);
  let column = end;
  let step = bestState % span - maxStep;
  route[rows - 1] = column;
  for (let row = rows - 1; row > 0; row -= 1) {
    const stateIndex = column * span + step + maxStep;
    const previousStep = backDirections[row * stateCount + stateIndex];
    const previousColumn = column - step;
    route[row - 1] = previousColumn;
    column = previousColumn;
    step = previousStep === 127 ? 0 : previousStep;
  }

  // Two light smoothing passes remove grid-like bends while preserving anchors.
  for (let pass = 0; pass < 2; pass += 1) {
    const smoothed = route.slice();
    for (let row = 2; row < rows - 2; row += 1) {
      smoothed[row] = route[row - 2] * 0.08 + route[row - 1] * 0.22
        + route[row] * 0.40 + route[row + 1] * 0.22 + route[row + 2] * 0.08;
    }
    for (let row = 1; row < rows - 1; row += 1) route[row] = smoothed[row];
  }
  return route;
}

/** Builds shared terrain profiles and a deterministic river path over a 2D elevation field. */
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
    const route = buildRiverRoute(options);
    const count = 72;
    for (let index = 0; index <= count; index += 1) {
      const t = index / count;
      const position = t * (route.length - 1);
      const left = Math.floor(position);
      const right = Math.min(route.length - 1, left + 1);
      const blend = position - left;
      const column = route[left] * (1 - blend) + route[right] * blend;
      const perspective = Math.pow(t, 1.18);
      // Water is a global scale control; perspective is applied separately.
      const baseWidth = width * (0.0025 + 0.092 * perspective);
      const riverWidth = baseWidth * riverStrength;
      river.push({
        x: (column / 79) * width,
        y: height * (0.46 + t * 0.62),
        width: riverWidth,
      });
    }
  }

  return { width, height, layers, river };
}
