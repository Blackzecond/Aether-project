import { sampleSurface, type Heightfield } from "../fields/heightfield";
import type { RiverNetwork } from "../hydrology/rivers";

export interface VegetationInstance {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly height: number;
  readonly tint: number;
}
export interface VegetationField {
  readonly instances: readonly VegetationInstance[];
  readonly diagnostics: { readonly candidates: number; readonly trees: number };
}

function hash(seed: number, x: number, z: number): number {
  let value = Math.imul(seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263), 1274126177);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

/** Deterministic, terrain-aware tree placement. Coordinates and dimensions use world units (1 unit = 1 km). */
export function generateVegetation(
  field: Heightfield,
  seed: number,
  rivers?: RiverNetwork,
): VegetationField {
  const instances: VegetationInstance[] = [];
  const stride = 3;
  const candidatesX = Math.floor((field.width - 2) / stride);
  const candidatesZ = Math.floor((field.height - 2) / stride);
  const maxTrees = 1800;

  for (let gz = 2; gz < field.height - 2; gz += stride) {
    for (let gx = 2; gx < field.width - 2; gx += stride) {
      const patchX = Math.floor(gx / 12);
      const patchZ = Math.floor(gz / 12);
      const patch = hash(seed + 17, patchX, patchZ);
      const chance = patch > 0.28 ? 0.78 : 0.07;
      if (hash(seed, gx, gz) > chance) continue;

      const jitterX = (hash(seed + 31, gx, gz) - 0.5) * stride * 0.8;
      const jitterZ = (hash(seed + 47, gx, gz) - 0.5) * stride * 0.8;
      const gridX = Math.max(1, Math.min(field.width - 2, gx + jitterX));
      const gridZ = Math.max(1, Math.min(field.height - 2, gz + jitterZ));
      const x = field.bounds.minX + gridX / (field.width - 1) * (field.bounds.maxX - field.bounds.minX);
      const z = field.bounds.minZ + gridZ / (field.height - 1) * (field.bounds.maxZ - field.bounds.minZ);
      const centerX=(field.bounds.minX+field.bounds.maxX)*0.5,centerZ=(field.bounds.minZ+field.bounds.maxZ)*0.5;
      if(Math.hypot(x-centerX,z-centerZ)<0.014) continue;
      const surface = sampleSurface(field, x, z);
      const elevation = surface.elevation;
      if (elevation < 0.035 || elevation > 0.92 || surface.slope > 0.78) continue;

      const ix = Math.round(gridX), iz = Math.round(gridZ);
      let nearWater = false;
      if (rivers) {
        for (let dz = -2; dz <= 2 && !nearWater; dz += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            const nx = ix + dx, nz = iz + dz;
            if (nx >= 0 && nx < field.width && nz >= 0 && nz < field.height
              && rivers.channelMask[nz * field.width + nx] > 0) {
              nearWater = true;
              break;
            }
          }
        }
      }
      // Keep a narrow open riverbank; moisture increases nearby woodland density.
      if (nearWater && hash(seed + 59, gx, gz) < 0.34) continue;
      if (hash(seed + 71, gx, gz) > (nearWater ? 0.88 : 0.68)) continue;

      const height = 0.009 + hash(seed + 83, gx, gz) * 0.009;
      const tint = hash(seed + 97, gx, gz);
      instances.push({
        x, y: elevation * 1.18 + 0.0015, z,
        height: height * (surface.slope > 0.48 ? 0.82 : 1),
        tint,
      });
      if (instances.length >= maxTrees) break;
    }
    if (instances.length >= maxTrees) break;
  }

  return { instances, diagnostics: { candidates: candidatesX * candidatesZ, trees: instances.length } };
}
