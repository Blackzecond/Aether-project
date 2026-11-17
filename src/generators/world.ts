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
  readonly depth: number;
  readonly surface: Float32Array;
  readonly elevation: Float32Array;
}

export interface RiverPoint {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly depth: number;
  readonly flow: number;
}

export interface LandscapeWorld {
  readonly width: number;
  readonly height: number;
  readonly layers: readonly TerrainLayer[];
  readonly river: readonly RiverPoint[];
  readonly fieldWidth: number;
  readonly fieldHeight: number;
  readonly elevation: Float32Array;
  readonly moisture: Float32Array;
}

const layerSettings = [
  { base: 0.38, amplitude: 0.15, color: "#597e78", frequency: 1.5, seed: 11, depth: 0.30 },
  { base: 0.55, amplitude: 0.19, color: "#315e59", frequency: 2.2, seed: 37, depth: 0.55 },
  { base: 0.72, amplitude: 0.22, color: "#183b3c", frequency: 3.1, seed: 83, depth: 0.79 },
] as const;

const FIELD_WIDTH = 96;
const FIELD_HEIGHT = 72;
const DIRECTIONS = [
  [-1, -1], [0, -1], [1, -1], [-1, 0],
  [1, 0], [-1, 1], [0, 1], [1, 1],
] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function indexOf(x: number, z: number): number {
  return z * FIELD_WIDTH + x;
}

function terrainElevation(x: number, z: number, options: LandscapeOptions): number {
  const scale = Math.max(0.35, options.scale);
  const roughness = clamp(options.roughness, 0, 1);
  const broad = fbm2(x * scale * 2.7, z * scale * 2.4, options.seed + 1901, 4, 0.52, 2);
  const detail = fbm2(x * scale * 8.5, z * scale * 7.2, options.seed + 2903, 3, 0.55, 2.05);
  const warp = (fbm2(x * 2.1, z * 2.4, options.seed + 3907, 3, 0.5, 2) - 0.5) * 0.12;

  // Three connected mountain ridges, not three independent silhouette layers.
  const ridgeCenters = [0.19, 0.51, 0.82];
  const ridgeStrength = [0.68, 0.88, 0.72];
  let ridges = 0;
  for (let ridge = 0; ridge < ridgeCenters.length; ridge += 1) {
    const center = ridgeCenters[ridge] + Math.sin(z * (3.1 + ridge * 0.7) + ridge * 2.4) * (0.045 + roughness * 0.035) + warp;
    const distance = (x - center) / (0.095 + roughness * 0.025);
    const spine = Math.exp(-distance * distance * 1.45);
    const peakNoise = 0.78 + 0.22 * fbm2(x * 9 + ridge * 17, z * 5, options.seed + ridge * 71, 3, 0.5, 2);
    ridges = Math.max(ridges, spine * ridgeStrength[ridge] * peakNoise);
  }

  // Valleys remain broad and connected between the ridges.
  const foothills = (broad - 0.5) * 0.17;
  const crags = (Math.abs(detail * 2 - 1) - 0.35) * roughness * 0.12;
  return clamp(0.12 + ridges * 0.62 + foothills + crags, 0.025, 1);
}

function buildHydrology(elevation: Float32Array): { parent: Int32Array; accumulation: Float32Array; order: number[] } {
  const count = FIELD_WIDTH * FIELD_HEIGHT;
  const filled = new Float32Array(elevation);
  const visited = new Uint8Array(count);
  const parent = new Int32Array(count);
  parent.fill(-1);
  const order: number[] = [];

  // Priority-flood from the downstream edge fills closed depressions and
  // records a drainage tree without requiring a costly fluid simulation.
  const heap: { index: number; height: number }[] = [];
  const push = (item: { index: number; height: number }): void => {
    heap.push(item);
    let child = heap.length - 1;
    while (child > 0) {
      const p = (child - 1) >> 1;
      if (heap[p].height <= item.height) break;
      heap[child] = heap[p];
      child = p;
    }
    heap[child] = item;
  };
  const pop = (): { index: number; height: number } | undefined => {
    if (!heap.length) return undefined;
    const root = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      let parentIndex = 0;
      while (true) {
        const left = parentIndex * 2 + 1;
        const right = left + 1;
        if (left >= heap.length) break;
        const child = right < heap.length && heap[right].height < heap[left].height ? right : left;
        if (heap[child].height >= last.height) break;
        heap[parentIndex] = heap[child];
        parentIndex = child;
      }
      heap[parentIndex] = last;
    }
    return root;
  };

  for (let x = 0; x < FIELD_WIDTH; x += 1) {
    const index = indexOf(x, FIELD_HEIGHT - 1);
    visited[index] = 1;
    push({ index, height: filled[index] });
  }

  while (heap.length) {
    const current = pop()!;
    order.push(current.index);
    const x = current.index % FIELD_WIDTH;
    const z = Math.floor(current.index / FIELD_WIDTH);
    for (const [dx, dz] of DIRECTIONS) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nx >= FIELD_WIDTH || nz < 0 || nz >= FIELD_HEIGHT) continue;
      const next = indexOf(nx, nz);
      if (visited[next]) continue;
      visited[next] = 1;
      parent[next] = current.index;
      filled[next] = Math.max(filled[next], filled[current.index] + 0.00001);
      push({ index: next, height: filled[next] });
    }
  }

  const accumulation = new Float32Array(count);
  accumulation.fill(1);
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const index = order[i];
    const downstream = parent[index];
    if (downstream >= 0) accumulation[downstream] += accumulation[index];
  }
  return { parent, accumulation, order };
}

function projectPoint(x: number, z: number, elevation: number, width: number, height: number): { x: number; y: number } {
  // Orthographic 2.5D projection: depth moves toward the viewer while
  // elevation lifts terrain. A river therefore follows slopes, not a flat overlay.
  return {
    x: x * width,
    y: height * (0.30 + z * 0.62 - elevation * 0.19),
  };
}

function buildRiver(
  elevation: Float32Array,
  accumulation: Float32Array,
  parent: Int32Array,
  width: number,
  height: number,
  strength: number,
  seed: number,
): RiverPoint[] {
  if (strength <= 0.01) return [];
  // The headwater anchor is seed-stable. It sits on one of the three
  // highland spines, so terrain edits reshape its downstream route without
  // making the river jump to an unrelated mountain.
  const ridgeAnchors = [0.19, 0.51, 0.82];
  const ridgeIndex = Math.abs(Math.floor(seed)) % ridgeAnchors.length;
  const sourceX = Math.round(ridgeAnchors[ridgeIndex] * (FIELD_WIDTH - 1));
  let source = indexOf(sourceX, 5);
  const route: number[] = [];
  const seen = new Uint8Array(FIELD_WIDTH * FIELD_HEIGHT);
  let current = source;
  while (current >= 0 && !seen[current] && route.length < FIELD_HEIGHT * 2) {
    seen[current] = 1;
    route.push(current);
    if (Math.floor(current / FIELD_WIDTH) >= FIELD_HEIGHT - 1) break;
    current = parent[current];
  }
  if (route.length < 8) return [];

  let coordinates = route.map((index) => ({
    x: index % FIELD_WIDTH,
    z: Math.floor(index / FIELD_WIDTH),
  }));
  for (let pass = 0; pass < 2; pass += 1) {
    const smoothed = coordinates.map((point, i) => {
      if (i === 0 || i === coordinates.length - 1) return point;
      return {
        x: coordinates[i - 1].x * 0.22 + point.x * 0.56 + coordinates[i + 1].x * 0.22,
        z: coordinates[i - 1].z * 0.22 + point.z * 0.56 + coordinates[i + 1].z * 0.22,
      };
    });
    coordinates = smoothed;
  }

  return coordinates.map((coordinate, i) => {
    const x = coordinate.x / (FIELD_WIDTH - 1);
    const z = coordinate.z / (FIELD_HEIGHT - 1);
    const gx = clamp(coordinate.x, 0, FIELD_WIDTH - 1);
    const gz = clamp(coordinate.z, 0, FIELD_HEIGHT - 1);
    const x0 = Math.floor(gx), z0 = Math.floor(gz);
    const x1 = Math.min(FIELD_WIDTH - 1, x0 + 1), z1 = Math.min(FIELD_HEIGHT - 1, z0 + 1);
    const tx = gx - x0, tz = gz - z0;
    const top = elevation[indexOf(x0, z0)] * (1 - tx) + elevation[indexOf(x1, z0)] * tx;
    const bottom = elevation[indexOf(x0, z1)] * (1 - tx) + elevation[indexOf(x1, z1)] * tx;
    const localElevation = top * (1 - tz) + bottom * tz;
    const sourceIndex = route[i];
    const flow = accumulation[sourceIndex] / maxAccumulation;
    const point = projectPoint(x, z, localElevation, width, height);
    const perspective = 0.55 + z * 1.05;
    const radius = width * (0.0012 + Math.pow(flow, 0.42) * 0.012) * perspective * strength;
    return { ...point, width: radius, depth: z, flow };
  });
}

/** Builds one shared elevation and drainage model for terrain, water and ecology. */
export function createLandscapeWorld(width: number, height: number, options: LandscapeOptions): LandscapeWorld {
  const elevation = new Float32Array(FIELD_WIDTH * FIELD_HEIGHT);
  const moisture = new Float32Array(FIELD_WIDTH * FIELD_HEIGHT);
  for (let z = 0; z < FIELD_HEIGHT; z += 1) {
    for (let x = 0; x < FIELD_WIDTH; x += 1) {
      const nx = x / (FIELD_WIDTH - 1);
      const nz = z / (FIELD_HEIGHT - 1);
      const index = indexOf(x, z);
      elevation[index] = terrainElevation(nx, nz, options);
      const humidity = fbm2(nx * 3.5, nz * 4.2, options.seed + 5101, 4, 0.55, 2);
      moisture[index] = clamp(0.35 + humidity * 0.45 + (1 - elevation[index]) * 0.2, 0, 1);
    }
  }

  const hydrology = buildHydrology(elevation);
  const layers: TerrainLayer[] = layerSettings.map((settings) => {
    const surface = new Float32Array(Math.min(420, Math.max(100, Math.round(width / 3))) + 1);
    const layerElevation = new Float32Array(surface.length);
    for (let sample = 0; sample < surface.length; sample += 1) {
      const x = sample / (surface.length - 1);
      const gridX = Math.round(x * (FIELD_WIDTH - 1));
      const gridZ = Math.round(settings.depth * (FIELD_HEIGHT - 1));
      const value = elevation[indexOf(gridX, gridZ)];
      layerElevation[sample] = value;
      surface[sample] = projectPoint(x, settings.depth, value, width, height).y / height;
    }
    return { ...settings, surface, elevation: layerElevation };
  });

  const river = buildRiver(elevation, hydrology.accumulation, hydrology.parent, width, height, clamp(options.water, 0, 1), options.seed);
  return {
    width, height, layers, river,
    fieldWidth: FIELD_WIDTH,
    fieldHeight: FIELD_HEIGHT,
    elevation,
    moisture,
  };
}

export function sampleWorldField(field: Float32Array, x: number, z: number): number {
  const gx = clamp(x, 0, 1) * (FIELD_WIDTH - 1);
  const gz = clamp(z, 0, 1) * (FIELD_HEIGHT - 1);
  const x0 = Math.floor(gx), z0 = Math.floor(gz);
  const x1 = Math.min(FIELD_WIDTH - 1, x0 + 1), z1 = Math.min(FIELD_HEIGHT - 1, z0 + 1);
  const tx = gx - x0, tz = gz - z0;
  const a = field[indexOf(x0, z0)] * (1 - tx) + field[indexOf(x1, z0)] * tx;
  const b = field[indexOf(x0, z1)] * (1 - tx) + field[indexOf(x1, z1)] * tx;
  return a * (1 - tz) + b * tz;
}

export function sampleSurface(layer: TerrainLayer, x: number, width: number): number {
  const position = clamp(x / Math.max(1, width), 0, 1) * (layer.surface.length - 1);
  const left = Math.floor(position);
  const right = Math.min(layer.surface.length - 1, left + 1);
  const blend = position - left;
  return layer.surface[left] * (1 - blend) + layer.surface[right] * blend;
}
