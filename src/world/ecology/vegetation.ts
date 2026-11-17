import { sampleSurface, type Heightfield } from "../fields/heightfield";
import type { RiverNetwork } from "../hydrology/rivers";

export interface VegetationInstance {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly height: number;
  readonly tint: number;
}
export interface GroundCoverInstance {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scale: number;
  readonly tint: number;
  /** 0 grass, 1 fern, 2 moss, 3 rock. */
  readonly kind: 0 | 1 | 2 | 3;
}
export interface VegetationField {
  readonly instances: readonly VegetationInstance[];
  readonly groundCover: readonly GroundCoverInstance[];
  readonly diagnostics: { readonly candidates: number; readonly trees: number; readonly groundCover: number };
}

function hash(seed: number, x: number, z: number): number {
  let value = Math.imul(seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263), 1274126177);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

/** Deterministic, terrain- and moisture-aware vegetation placement. 1 world unit = 1 km. */
export function generateVegetation(
  field: Heightfield,
  seed: number,
  rivers?: RiverNetwork,
): VegetationField {
  const instances: VegetationInstance[] = [];
  const groundCover: GroundCoverInstance[] = [];
  const waterInfluence = new Uint8Array(field.width * field.height);
  if (rivers) {
    for (const index of rivers.channelIndices) {
      const cx = index % field.width, cz = Math.floor(index / field.width);
      for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, z = cz + dz;
        if (x >= 0 && x < field.width && z >= 0 && z < field.height
          && dx * dx + dz * dz <= 16) waterInfluence[z * field.width + x] = 1;
      }
    }
  }

  const centerX = (field.bounds.minX + field.bounds.maxX) * 0.5;
  const centerZ = (field.bounds.minZ + field.bounds.maxZ) * 0.5;
  const spanX = field.bounds.maxX - field.bounds.minX;
  const spanZ = field.bounds.maxZ - field.bounds.minZ;
  const toWorld = (gx: number, gz: number) => ({
    x: field.bounds.minX + gx / (field.width - 1) * spanX,
    z: field.bounds.minZ + gz / (field.height - 1) * spanZ,
  });

  // Trees form clustered woodland patches rather than a sparse uniform scatter.
  for (let gz = 2; gz < field.height - 2; gz += 3) {
    for (let gx = 2; gx < field.width - 2; gx += 3) {
      const patch = hash(seed + 17, Math.floor(gx / 10), Math.floor(gz / 10));
      if (hash(seed, gx, gz) > (patch > 0.24 ? 0.84 : 0.035)) continue;
      const jitterX = (hash(seed + 31, gx, gz) - 0.5) * 1.45;
      const jitterZ = (hash(seed + 47, gx, gz) - 0.5) * 1.45;
      const gridX = Math.max(1, Math.min(field.width - 2, gx + jitterX));
      const gridZ = Math.max(1, Math.min(field.height - 2, gz + jitterZ));
      const { x, z } = toWorld(gridX, gridZ);
      if (Math.hypot(x - centerX, z - centerZ) < 0.014) continue;
      const surface = sampleSurface(field, x, z);
      if (surface.elevation < 0.035 || surface.elevation > 0.92 || surface.slope > 0.72) continue;
      const nearWater = waterInfluence[Math.round(gridZ) * field.width + Math.round(gridX)] > 0;
      const density = nearWater ? 0.94 : 0.78;
      if (hash(seed + 71, gx, gz) > density) continue;
      instances.push({
        x, y: surface.elevation + 0.00035, z,
        height: 0.009 + hash(seed + 83, gx, gz) * 0.010,
        tint: hash(seed + 97, gx, gz),
      });
      if (instances.length >= 6000) break;
    }
    if (instances.length >= 2600) break;
  }

  // Ground cover is much denser and follows moisture, slope and exposed rock.
  for (let gz = 2; gz < field.height - 2; gz += 2) {
    for (let gx = 2; gx < field.width - 2; gx += 2) {
      const jitterX = (hash(seed + 131, gx, gz) - 0.5) * 1.45;
      const jitterZ = (hash(seed + 149, gx, gz) - 0.5) * 1.45;
      const gridX = Math.max(1, Math.min(field.width - 2, gx + jitterX));
      const gridZ = Math.max(1, Math.min(field.height - 2, gz + jitterZ));
      const { x, z } = toWorld(gridX, gridZ);
      if (Math.hypot(x - centerX, z - centerZ) < 0.014) continue;
      const surface = sampleSurface(field, x, z);
      if (surface.elevation < 0.018 || surface.elevation > 0.96 || surface.slope > 1.05) continue;
      const nearWater = waterInfluence[Math.round(gridZ) * field.width + Math.round(gridX)] > 0;
      const roll = hash(seed + 167, gx, gz);
      const patch = hash(seed + 173, Math.floor(gx / 9), Math.floor(gz / 9));
      if (roll > (patch > 0.18 ? 0.72 : 0.24)) continue;

      let kind: GroundCoverInstance["kind"];
      if (surface.slope > 0.72 && roll > 0.42) kind = 3; // exposed stones
      else if (nearWater && roll < 0.34) kind = 2; // damp moss
      else if (nearWater && roll < 0.62) kind = 1; // ferns in moist shade
      else if (roll < 0.78) kind = 0; // grass
      else kind = patch > 0.5 ? 1 : 0;

      const scale = kind === 3
        ? 0.0012 + hash(seed + 181, gx, gz) * 0.0026
        : kind === 2
          ? 0.0005 + hash(seed + 181, gx, gz) * 0.0007
          : kind === 1
            ? 0.0014 + hash(seed + 181, gx, gz) * 0.0014
            : 0.00035 + hash(seed + 181, gx, gz) * 0.0005;
      groundCover.push({
        x, y: surface.elevation + 0.0002, z, scale,
        tint: hash(seed + 193, gx, gz), kind,
      });
      if (groundCover.length >= 7200) break;
    }
    if (groundCover.length >= 7200) break;
  }

  return {
    instances,
    groundCover,
    diagnostics: {
      candidates: Math.floor((field.width - 4) / 2) * Math.floor((field.height - 4) / 2),
      trees: instances.length,
      groundCover: groundCover.length,
    },
  };
}
