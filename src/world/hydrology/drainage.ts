import type { Heightfield } from "../fields/heightfield";

export interface HydrologyDiagnostics {
  readonly outletCount: number;
  readonly filledCellCount: number;
  readonly maximumAccumulation: number;
}

export interface DrainageField {
  /** Depression-filled elevation used only for routing, never for rendering. */
  readonly filledElevation: Float32Array;
  /** D8 downstream cell index; -1 marks a boundary outlet. */
  readonly flowTo: Int32Array;
  /** Number of upstream cells including this cell. */
  readonly accumulation: Float32Array;
  /** Stable outlet index for each cell. */
  readonly basinId: Int32Array;
  /** Boundary cells used as drainage outlets. */
  readonly outletIndices: Int32Array;
  readonly diagnostics: HydrologyDiagnostics;
}

interface MinHeap {
  values: number[];
  push(index: number): void;
  pop(): number | undefined;
}

function createMinHeap(elevation: Float32Array, order: Int32Array): MinHeap {
  const values: number[] = [];
  const less = (a: number, b: number): boolean =>
    elevation[a] < elevation[b] || (elevation[a] === elevation[b] && order[a] < order[b]);
  return {
    values,
    push(index) {
      let child = values.length;
      values.push(index);
      while (child > 0) {
        const parent = (child - 1) >> 1;
        if (!less(values[child], values[parent])) break;
        [values[child], values[parent]] = [values[parent], values[child]];
        child = parent;
      }
    },
    pop() {
      if (values.length === 0) return undefined;
      const root = values[0];
      const tail = values.pop()!;
      if (values.length > 0) {
        values[0] = tail;
        let parent = 0;
        for (;;) {
          const left = parent * 2 + 1;
          const right = left + 1;
          let smallest = parent;
          if (left < values.length && less(values[left], values[smallest])) smallest = left;
          if (right < values.length && less(values[right], values[smallest])) smallest = right;
          if (smallest === parent) break;
          [values[parent], values[smallest]] = [values[smallest], values[parent]];
          parent = smallest;
        }
      }
      return root;
    },
  };
}

function isBoundary(x: number, z: number, width: number, height: number): boolean {
  return x === 0 || z === 0 || x === width - 1 || z === height - 1;
}

/**
 * Builds a deterministic D8 drainage field with a multi-outlet Priority-Flood.
 * The source heightfield is never modified. Equal-height flats are routed by
 * flood visitation order, which provides an acyclic tie-break without adding
 * artificial elevation to the rendered world.
 */
export function buildDrainageField(field: Heightfield): DrainageField {
  const { width, height, values, bounds } = field;
  const count = width * height;
  if (width < 2 || height < 2 || values.length !== count) {
    throw new Error("Hydrology requires a valid heightfield of at least 2 × 2");
  }
  for (let i = 0; i < count; i += 1) {
    if (!Number.isFinite(values[i])) throw new Error("Hydrology source elevation must be finite");
  }

  const filledElevation = new Float32Array(values);
  const flowTo = new Int32Array(count).fill(-1);
  const accumulation = new Float32Array(count).fill(1);
  const basinId = new Int32Array(count).fill(-1);
  const visited = new Uint8Array(count);
  const floodOrder = new Int32Array(count).fill(-1);
  const orderToIndex = new Int32Array(count);
  const outletIndices: number[] = [];
  const heap = createMinHeap(filledElevation, floodOrder);

  for (let z = 0; z < height; z += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isBoundary(x, z, width, height)) continue;
      const index = z * width + x;
      visited[index] = 1;
      outletIndices.push(index);
      heap.push(index);
    }
  }

  const visitOffsets = [-1, 0, 1];
  let order = 0;
  while (true) {
    const current = heap.pop();
    if (current === undefined) break;
    floodOrder[current] = order;
    orderToIndex[order++] = current;

    const x = current % width;
    const z = Math.floor(current / width);
    for (const dz of visitOffsets) {
      for (const dx of visitOffsets) {
        if (dx === 0 && dz === 0) continue;
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue;
        const next = nz * width + nx;
        if (visited[next]) continue;
        visited[next] = 1;
        filledElevation[next] = Math.max(values[next], filledElevation[current]);
        heap.push(next);
      }
    }
  }

  const outletLookup = new Map<number, number>();
  outletIndices.forEach((index, outletId) => outletLookup.set(index, outletId));
  const cellSizeX = (bounds.maxX - bounds.minX) / (width - 1);
  const cellSizeZ = (bounds.maxZ - bounds.minZ) / (height - 1);

  // D8 chooses the steepest lower filled neighbour. Flood order resolves flats.
  for (let index = 0; index < count; index += 1) {
    const x = index % width;
    const z = Math.floor(index / width);
    if (isBoundary(x, z, width, height)) {
      basinId[index] = outletLookup.get(index)!;
      continue;
    }
    let best = -1;
    let bestSlope = -Infinity;
    for (const dz of visitOffsets) {
      for (const dx of visitOffsets) {
        if (dx === 0 && dz === 0) continue;
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue;
        const next = nz * width + nx;
        if (floodOrder[next] >= floodOrder[index] || filledElevation[next] > filledElevation[index]) continue;
        const distance = Math.hypot(dx * cellSizeX, dz * cellSizeZ);
        const drop = filledElevation[index] - filledElevation[next];
        const slope = drop > 0 ? drop / distance : 0;
        if (best === -1 || slope > bestSlope) {
          best = next;
          bestSlope = slope;
        }
      }
    }
    if (best === -1) throw new Error("Priority-Flood produced an unreachable cell");
    flowTo[index] = best;
  }

  // Every destination has an earlier flood order, so reverse order safely
  // accumulates all upstream contributing area without sorting another array.
  for (let i = count - 1; i >= 0; i -= 1) {
    const index = orderToIndex[i];
    const downstream = flowTo[index];
    if (downstream >= 0) accumulation[downstream] += accumulation[index];
  }
  for (let i = 0; i < count; i += 1) {
    const index = orderToIndex[i];
    const downstream = flowTo[index];
    if (downstream >= 0) basinId[index] = basinId[downstream];
  }

  let maximumAccumulation = 0;
  let filledCellCount = 0;
  for (let i = 0; i < count; i += 1) {
    maximumAccumulation = Math.max(maximumAccumulation, accumulation[i]);
    if (filledElevation[i] > values[i]) filledCellCount += 1;
  }

  return {
    filledElevation,
    flowTo,
    accumulation,
    basinId,
    outletIndices: Int32Array.from(outletIndices),
    diagnostics: { outletCount: outletIndices.length, filledCellCount, maximumAccumulation },
  };
}
