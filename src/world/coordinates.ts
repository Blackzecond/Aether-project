/** Canonical right-handed world coordinates. Generators never receive screen dimensions. */
export interface WorldPoint { readonly x: number; readonly y: number; readonly z: number }
export interface WorldBounds { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number }
export const DEFAULT_WORLD_BOUNDS: WorldBounds = Object.freeze({ minX: -1, maxX: 1, minZ: -1, maxZ: 1 });
export function isFiniteWorldPoint(point: WorldPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
}
