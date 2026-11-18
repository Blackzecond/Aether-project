import type { Heightfield } from "../fields/heightfield";
import type { DrainageField } from "./drainage";

export interface RiverNetworkOptions {
  /** Minimum upstream catchment area in world-space square units. */
  readonly minimumContributingArea?: number;
  /** Width coefficient in width = coefficient × sqrt(contributing area). */
  readonly widthCoefficient?: number;
  /** Exponent applied to contributing area when deriving channel width. */
  readonly widthExponent?: number;
  /** Hard width limit expressed as a multiple of the smaller grid-cell size. */
  readonly maximumWidthInCells?: number;
}

export interface RiverNetworkDiagnostics {
  readonly thresholdArea: number;
  readonly channelCellCount: number;
  readonly headwaterCount: number;
  readonly outletCount: number;
  readonly maximumWidth: number;
}

export interface RiverNetwork {
  /** 1 for channel cells, 0 for all other cells. */
  readonly channelMask: Uint8Array;
  /** All channel cell indices in stable row-major order. */
  readonly channelIndices: Int32Array;
  /** Channel cells with no upstream channel neighbour. */
  readonly headwaterIndices: Int32Array;
  /** Channel cells that reach the world boundary. */
  readonly outletIndices: Int32Array;
  /** Downstream channel cell, or -1 at a channel outlet. */
  readonly downstream: Int32Array;
  /** Channel width in world-space units, indexed by source heightfield cell. */
  readonly width: Float32Array;
  readonly diagnostics: RiverNetworkDiagnostics;
}

function isBoundary(index: number, width: number, height: number): boolean {
  const x = index % width;
  const z = Math.floor(index / width);
  return x === 0 || z === 0 || x === width - 1 || z === height - 1;
}

/**
 * Extracts a connected channel network from contributing area.
 * This is a geometric drainage graph only: it does not carve terrain or
 * generate/render a water surface.
 */
export function extractRiverNetwork(
  field: Heightfield,
  drainage: DrainageField,
  options: RiverNetworkOptions = {},
): RiverNetwork {
  const { width, height, bounds, values } = field;
  const count = width * height;
  if (drainage.flowTo.length !== count || drainage.accumulation.length !== count) {
    throw new Error("Drainage field dimensions do not match the source heightfield");
  }
  if (drainage.filledElevation.length !== count || drainage.basinId.length !== count) {
    throw new Error("Drainage field is incomplete");
  }

  const cellSizeX = (bounds.maxX - bounds.minX) / (width - 1);
  const cellSizeZ = (bounds.maxZ - bounds.minZ) / (height - 1);
  const cellArea = cellSizeX * cellSizeZ;
  const minimumContributingArea = options.minimumContributingArea ?? cellArea * Math.max(8, Math.ceil(count * 0.006));
  const widthCoefficient = options.widthCoefficient ?? 0.08;
  const widthExponent = options.widthExponent ?? 0.5;
  const maximumWidthInCells = options.maximumWidthInCells ?? 3;
  const minimumCellSize = Math.min(cellSizeX, cellSizeZ);

  if (!Number.isFinite(minimumContributingArea) || minimumContributingArea <= 0
    || !Number.isFinite(widthCoefficient) || widthCoefficient <= 0
    || !Number.isFinite(widthExponent) || widthExponent <= 0 || widthExponent > 1
    || !Number.isFinite(maximumWidthInCells) || maximumWidthInCells <= 0) {
    throw new Error("Invalid river network extraction options");
  }

  const thresholdCells = minimumContributingArea / cellArea;
  const channelMask = new Uint8Array(count);
  const downstream = new Int32Array(count).fill(-1);
  const widthBuffer = new Float32Array(count);
  const channelIndices: number[] = [];
  const headwaterIndices: number[] = [];
  const outletIndices: number[] = [];
  const upstreamChannelCount = new Uint8Array(count);
  const maximumWidth = minimumCellSize * maximumWidthInCells;
  let measuredMaximumWidth = 0;

  for (let index = 0; index < count; index += 1) {
    if (!Number.isFinite(values[index]) || !Number.isFinite(drainage.accumulation[index])) {
      throw new Error("River extraction inputs must be finite");
    }
    if (drainage.accumulation[index] + 1e-6 < thresholdCells) continue;
    channelMask[index] = 1;
    channelIndices.push(index);
    const rawWidth = widthCoefficient * Math.pow(drainage.accumulation[index] * cellArea, widthExponent);
    const channelWidth = Math.min(maximumWidth, Math.max(minimumCellSize * 0.12, rawWidth));
    widthBuffer[index] = channelWidth;
    measuredMaximumWidth = Math.max(measuredMaximumWidth, channelWidth);
  }

  // Every downstream cell has at least as much contributing area as its
  // upstream cells, so threshold extraction remains connected by construction.
  for (const index of channelIndices) {
    const next = drainage.flowTo[index];
    if (next < 0 || !channelMask[next]) {
      if (!isBoundary(index, width, height)) {
        throw new Error("Thresholded channel terminates before reaching a boundary outlet");
      }
      outletIndices.push(index);
      continue;
    }
    downstream[index] = next;
    upstreamChannelCount[next] += 1;
  }

  for (const index of channelIndices) {
    if (upstreamChannelCount[index] === 0) headwaterIndices.push(index);
  }

  return {
    channelMask,
    channelIndices: Int32Array.from(channelIndices),
    headwaterIndices: Int32Array.from(headwaterIndices),
    outletIndices: Int32Array.from(outletIndices),
    downstream,
    width: widthBuffer,
    diagnostics: {
      thresholdArea: minimumContributingArea,
      channelCellCount: channelIndices.length,
      headwaterCount: headwaterIndices.length,
      outletCount: outletIndices.length,
      maximumWidth: measuredMaximumWidth,
    },
  };
}
