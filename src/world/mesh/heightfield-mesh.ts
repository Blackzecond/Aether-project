import type { Heightfield } from "../fields/heightfield";
export interface TerrainMesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  readonly vertexCount: number;
  readonly triangleCount: number;
}
/** Indexed regular-grid mesh. Positions are world-space XYZ; renderer owns projection. */
export function buildHeightfieldMesh(field: Heightfield, verticalScale = 1): TerrainMesh {
  if (!Number.isFinite(verticalScale) || verticalScale <= 0) throw new Error("verticalScale must be positive and finite");
  const { width, height, bounds, values } = field;
  const vertexCount = width * height;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  for (let z = 0; z < height; z += 1) for (let x = 0; x < width; x += 1) {
    const i = z * width + x, p = i * 3;
    const wx = bounds.minX + (x / (width - 1)) * (bounds.maxX - bounds.minX);
    const wz = bounds.minZ + (z / (height - 1)) * (bounds.maxZ - bounds.minZ);
    const left = values[z * width + Math.max(0, x - 1)], right = values[z * width + Math.min(width - 1, x + 1)];
    const up = values[Math.max(0, z - 1) * width + x], down = values[Math.min(height - 1, z + 1) * width + x];
    const dx = (right - left) / (x === 0 || x === width - 1 ? (bounds.maxX - bounds.minX) / (width - 1) : 2 * (bounds.maxX - bounds.minX) / (width - 1));
    const dz = (down - up) / (z === 0 || z === height - 1 ? (bounds.maxZ - bounds.minZ) / (height - 1) : 2 * (bounds.maxZ - bounds.minZ) / (height - 1));
    const length = Math.hypot(dx, 1, dz);
    positions[p] = wx; positions[p + 1] = values[i] * verticalScale; positions[p + 2] = wz;
    normals[p] = -dx / length; normals[p + 1] = 1 / length; normals[p + 2] = -dz / length;
  }
  const indices = new Uint32Array((width - 1) * (height - 1) * 6);
  let cursor = 0;
  for (let z = 0; z < height - 1; z += 1) for (let x = 0; x < width - 1; x += 1) {
    const a = z * width + x, b = a + 1, c = a + width, d = c + 1;
    indices[cursor++] = a; indices[cursor++] = c; indices[cursor++] = b;
    indices[cursor++] = b; indices[cursor++] = c; indices[cursor++] = d;
  }
  return { positions, normals, indices, vertexCount, triangleCount: indices.length / 3 };
}
