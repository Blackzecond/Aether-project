import { hash32 } from "./random";

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Seeded 2D value noise with quintic interpolation (smoother derivatives than cubic smoothstep). */
export function valueNoise2(x: number, y: number, seed = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const h = (gx: number, gy: number): number => hash32(
    Math.imul(gx, 374761393) ^ Math.imul(gy, 668265263) ^ seed,
  ) / 4294967295;

  const a = lerp(h(ix, iy), h(ix + 1, iy), fx);
  const b = lerp(h(ix, iy + 1), h(ix + 1, iy + 1), fx);
  return lerp(a, b, fy);
}

/** Fractal Brownian motion: octave frequency doubles while amplitude decays. */
export function fbm2(
  x: number,
  y: number,
  seed: number,
  octaves = 4,
  persistence = 0.5,
  lacunarity = 2,
): number {
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let weight = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    total += valueNoise2(x * frequency, y * frequency, seed + octave * 1013) * amplitude;
    weight += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }

  return weight > 0 ? total / weight : 0;
}
