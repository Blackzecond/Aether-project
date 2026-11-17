import { hash32 } from "../../core/random";
const GRADIENTS = [[1,0],[-1,0],[0,1],[0,-1],[0.707,0.707],[-0.707,0.707],[0.707,-0.707],[-0.707,-0.707]] as const;
const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Seeded 2D gradient noise in approximately [-1, 1]. */
export function gradientNoise2(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const dot = (gx: number, gz: number, dx: number, dz: number): number => {
    const h = hash32(Math.imul(gx, 374761393) ^ Math.imul(gz, 668265263) ^ seed) % GRADIENTS.length;
    return GRADIENTS[h][0] * dx + GRADIENTS[h][1] * dz;
  };
  const u = fade(fx), v = fade(fz);
  return lerp(lerp(dot(ix, iz, fx, fz), dot(ix + 1, iz, fx - 1, fz), u),
    lerp(dot(ix, iz + 1, fx, fz - 1), dot(ix + 1, iz + 1, fx - 1, fz - 1), u), v) * 1.4142;
}
export function fbmGradient2(x: number, z: number, seed: number, octaves: number, persistence = 0.5, lacunarity = 2): number {
  let amplitude = 1, frequency = 1, total = 0, norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    total += gradientNoise2(x * frequency, z * frequency, seed + i * 1013) * amplitude;
    norm += amplitude; amplitude *= persistence; frequency *= lacunarity;
  }
  return norm > 0 ? total / norm : 0;
}
