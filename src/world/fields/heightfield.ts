import { DEFAULT_WORLD_BOUNDS, type WorldBounds, type WorldPoint } from "../coordinates";

export interface Heightfield {
  readonly width: number;
  readonly height: number;
  readonly bounds: WorldBounds;
  readonly values: Float32Array;
}
export interface SurfaceSample {
  readonly elevation: number;
  readonly slope: number;
  readonly normal: WorldPoint;
  readonly gradientX: number;
  readonly gradientZ: number;
}
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function at(field: Heightfield, x: number, z: number): number {
  return field.values[z * field.width + x];
}
export function createHeightfield(width: number, height: number, values: Float32Array, bounds: WorldBounds = DEFAULT_WORLD_BOUNDS): Heightfield {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || values.length !== width * height) {
    throw new Error("Heightfield dimensions do not match its sample buffer");
  }
  if (![bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ].every(Number.isFinite)
    || bounds.maxX <= bounds.minX || bounds.maxZ <= bounds.minZ) throw new Error("Invalid heightfield bounds");
  return Object.freeze({ width, height, bounds, values });
}
export function worldToGrid(field: Heightfield, x: number, z: number): { x: number; z: number } {
  return {
    x: clamp((x - field.bounds.minX) / (field.bounds.maxX - field.bounds.minX), 0, 1) * (field.width - 1),
    z: clamp((z - field.bounds.minZ) / (field.bounds.maxZ - field.bounds.minZ), 0, 1) * (field.height - 1),
  };
}
export function sampleElevation(field: Heightfield, x: number, z: number): number {
  const p = worldToGrid(field, x, z);
  const x0 = Math.floor(p.x), z0 = Math.floor(p.z);
  const x1 = Math.min(field.width - 1, x0 + 1), z1 = Math.min(field.height - 1, z0 + 1);
  const tx = p.x - x0, tz = p.z - z0;
  const a = at(field, x0, z0) * (1 - tx) + at(field, x1, z0) * tx;
  const b = at(field, x0, z1) * (1 - tx) + at(field, x1, z1) * tx;
  return a * (1 - tz) + b * tz;
}
export function sampleSurface(field: Heightfield, x: number, z: number): SurfaceSample {
  const p = worldToGrid(field, x, z);
  const gx = Math.min(field.width - 2, Math.max(1, Math.round(p.x)));
  const gz = Math.min(field.height - 2, Math.max(1, Math.round(p.z)));
  const dx = (field.bounds.maxX - field.bounds.minX) / (field.width - 1);
  const dz = (field.bounds.maxZ - field.bounds.minZ) / (field.height - 1);
  const gradientX = (at(field, gx + 1, gz) - at(field, gx - 1, gz)) / (2 * dx);
  const gradientZ = (at(field, gx, gz + 1) - at(field, gx, gz - 1)) / (2 * dz);
  const length = Math.hypot(gradientX, 1, gradientZ);
  return {
    elevation: sampleElevation(field, x, z), gradientX, gradientZ,
    normal: { x: -gradientX / length, y: 1 / length, z: -gradientZ / length },
    slope: Math.atan(Math.hypot(gradientX, gradientZ)),
  };
}
export function sampleCurvature(field: Heightfield, x: number, z: number): number {
  const p = worldToGrid(field, x, z);
  const gx = Math.min(field.width - 2, Math.max(1, Math.round(p.x)));
  const gz = Math.min(field.height - 2, Math.max(1, Math.round(p.z)));
  return at(field, gx - 1, gz) + at(field, gx + 1, gz) + at(field, gx, gz - 1) + at(field, gx, gz + 1) - 4 * at(field, gx, gz);
}
