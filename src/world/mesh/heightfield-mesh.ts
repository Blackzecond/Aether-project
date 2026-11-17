import type { Heightfield } from "../fields/heightfield";
export interface TerrainMesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  readonly vertexCount: number;
  readonly triangleCount: number;
}
/** Builds a closed terrain volume: heightfield surface, perimeter walls and a sealed underside. */
export function buildHeightfieldMesh(field: Heightfield, verticalScale = 1): TerrainMesh {
  if (!Number.isFinite(verticalScale) || verticalScale <= 0) throw new Error("verticalScale must be positive and finite");
  const { width, height, bounds, values } = field;
  const surfaceCount = width * height;
  const perimeter: number[] = [];
  for (let x = 0; x < width; x += 1) perimeter.push(x);
  for (let z = 1; z < height; z += 1) perimeter.push(z * width + width - 1);
  for (let x = width - 2; x >= 0; x -= 1) perimeter.push((height - 1) * width + x);
  for (let z = height - 2; z > 0; z -= 1) perimeter.push(z * width);

  const baseY = Math.min(...values) * verticalScale - 0.18;
  const wallStart = surfaceCount;
  const bottomStart = wallStart + perimeter.length * 2;
  const vertexCount = bottomStart + 4;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const put = (index: number, x: number, y: number, z: number, nx: number, ny: number, nz: number): void => {
    const p = index * 3;
    positions[p] = x; positions[p + 1] = y; positions[p + 2] = z;
    const length = Math.hypot(nx, ny, nz) || 1;
    normals[p] = nx / length; normals[p + 1] = ny / length; normals[p + 2] = nz / length;
  };

  for (let z = 0; z < height; z += 1) for (let x = 0; x < width; x += 1) {
    const i = z * width + x;
    const wx = bounds.minX + (x / (width - 1)) * (bounds.maxX - bounds.minX);
    const wz = bounds.minZ + (z / (height - 1)) * (bounds.maxZ - bounds.minZ);
    const left = values[z * width + Math.max(0, x - 1)], right = values[z * width + Math.min(width - 1, x + 1)];
    const up = values[Math.max(0, z - 1) * width + x], down = values[Math.min(height - 1, z + 1) * width + x];
    const dx = (right - left) / (x === 0 || x === width - 1 ? (bounds.maxX - bounds.minX) / (width - 1) : 2 * (bounds.maxX - bounds.minX) / (width - 1));
    const dz = (down - up) / (z === 0 || z === height - 1 ? (bounds.maxZ - bounds.minZ) / (height - 1) : 2 * (bounds.maxZ - bounds.minZ) / (height - 1));
    put(i, wx, values[i] * verticalScale, wz, -dx / verticalScale, 1, -dz / verticalScale);
  }

  const indices: number[] = [];
  for (let z = 0; z < height - 1; z += 1) for (let x = 0; x < width - 1; x += 1) {
    const a = z * width + x, b = a + 1, c = a + width, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }

  perimeter.forEach((surfaceIndex, i) => {
    const nextIndex = perimeter[(i + 1) % perimeter.length];
    const p = surfaceIndex * 3;
    const q = nextIndex * 3;
    const ax = positions[p], az = positions[p + 2];
    const bx = positions[q], bz = positions[q + 2];
    const dx = bx - ax, dz = bz - az;
    const nx = -dz, nz = dx;
    const topA = wallStart + i * 2, bottomA = topA + 1;
    const topB = wallStart + ((i + 1) % perimeter.length) * 2, bottomB = topB + 1;
    put(topA, ax, positions[p + 1], az, nx, 0, nz);
    put(bottomA, ax, baseY, az, nx, 0, nz);
    if (i === 0) { /* keep each wall segment independent for crisp edge normals */ }
    indices.push(topA, bottomA, topB, topB, bottomA, bottomB);
  });

  const corners = [
    [bounds.minX, baseY, bounds.minZ],
    [bounds.maxX, baseY, bounds.minZ],
    [bounds.maxX, baseY, bounds.maxZ],
    [bounds.minX, baseY, bounds.maxZ],
  ];
  corners.forEach((point, i) => put(bottomStart + i, point[0], point[1], point[2], 0, -1, 0));
  indices.push(bottomStart, bottomStart + 2, bottomStart + 1, bottomStart, bottomStart + 3, bottomStart + 2);

  const indexArray = new Uint32Array(indices);
  return { positions, normals, indices: indexArray, vertexCount, triangleCount: indexArray.length / 3 };
}
