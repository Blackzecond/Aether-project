import { fbm2 } from "../core/noise";
import { createLandscapeWorld, sampleSurface, type LandscapeOptions, type LandscapeWorld, type TerrainLayer } from "./world";

export type { LandscapeOptions } from "./world";

const palettes = [
  { skyTop: "#172c38", skyBottom: "#668b8d", far: "#597e78", mid: "#315e59", near: "#183b3c", accent: "#c6c99c", water: "#477f83", waterLight: "#a7c6b8", bank: "#142f37" },
  { skyTop: "#27283d", skyBottom: "#a47e86", far: "#9b7880", mid: "#6a596e", near: "#3b3e58", accent: "#e7c6a1", water: "#637e91", waterLight: "#d1b8aa", bank: "#272c42" },
  { skyTop: "#132f3a", skyBottom: "#7a9a91", far: "#78968a", mid: "#496f67", near: "#254a48", accent: "#d1d5ad", water: "#4f8580", waterLight: "#b9d0b5", bank: "#1c3c3c" },
];

function seededRandom(seed: number): () => number {
  let state = (seed ^ 0x6d2b79f5) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function drawTerrainLayer(context: CanvasRenderingContext2D, layer: TerrainLayer, width: number, height: number, color: string): void {
  context.beginPath();
  context.moveTo(0, height);
  for (let index = 0; index < layer.surface.length; index += 1) {
    context.lineTo((index / (layer.surface.length - 1)) * width, layer.surface[index] * height);
  }
  context.lineTo(width, height);
  context.closePath();
  context.fillStyle = color;
  context.fill();
}

function drawPine(context: CanvasRenderingContext2D, x: number, baseY: number, size: number, color: string, alpha: number, variant: number): void {
  context.save();
  context.globalAlpha = alpha;
  context.fillStyle = color;
  context.fillRect(x - size * 0.025, baseY - size * 0.16, size * 0.05, size * 0.16);
  const tiers = 3 + Math.round(variant * 2);
  for (let tier = 0; tier < tiers; tier += 1) {
    const progress = tier / tiers;
    const top = baseY - size * (0.98 - progress * 0.58);
    const half = size * (0.12 + progress * 0.28);
    const bottom = baseY - size * (0.78 - progress * 0.55);
    context.beginPath();
    context.moveTo(x + (variant - 0.5) * size * 0.06, top);
    context.quadraticCurveTo(x - half * 0.35, top + size * 0.12, x - half, bottom);
    context.lineTo(x - half * 0.66, bottom - size * 0.025);
    context.lineTo(x, bottom + size * 0.025);
    context.lineTo(x + half * 0.72, bottom - size * 0.045);
    context.quadraticCurveTo(x + half * 0.35, top + size * 0.12, x + (variant - 0.5) * size * 0.06, top);
    context.closePath();
    context.fill();
  }
  context.restore();
}

function drawRoundTree(context: CanvasRenderingContext2D, x: number, baseY: number, size: number, color: string, alpha: number, variant: number): void {
  context.save();
  context.globalAlpha = alpha;
  context.fillStyle = color;
  context.fillRect(x - size * 0.035, baseY - size * 0.34, size * 0.07, size * 0.34);
  context.beginPath();
  context.ellipse(x, baseY - size * 0.53, size * (0.29 + variant * 0.04), size * 0.34, (variant - 0.5) * 0.3, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.arc(x - size * 0.15, baseY - size * 0.58, size * 0.19, 0, Math.PI * 2);
  context.arc(x + size * 0.15, baseY - size * 0.59, size * 0.2, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function overlapsRiver(world: LandscapeWorld, x: number, y: number, clearance: number): boolean {
  return world.river.some((point) => Math.abs(point.x - x) < point.width + clearance
    && Math.abs(point.y - y) < clearance * 2.5);
}

function drawForestLayer(
  context: CanvasRenderingContext2D,
  world: LandscapeWorld,
  layer: TerrainLayer,
  height: number,
  seed: number,
  density: number,
  color: string,
  count: number,
  sizeScale: number,
  alpha: number,
): void {
  if (density <= 0.01) return;
  const random = seededRandom(seed);
  const width = world.width;
  for (let index = 0; index < Math.round(count * density); index += 1) {
    const x = random() * width;
    const groundY = sampleSurface(layer, x, width) * height;
    const size = height * (0.025 + random() * 0.045) * sizeScale * (0.45 + density * 0.65);
    const baseY = groundY + size * 0.035;
    if (overlapsRiver(world, x, baseY, size * 0.48)) continue;
    const shade = random();
    const treeColor = shade > 0.7 ? color : (shade > 0.35 ? color : "#102e32");
    const treeAlpha = alpha * (0.78 + random() * 0.22);
    if (random() > 0.22) drawPine(context, x, baseY, size, treeColor, treeAlpha, random());
    else drawRoundTree(context, x, baseY, size * 0.92, treeColor, treeAlpha, random());
  }
}

function traceRiverEdge(world: LandscapeWorld, side: -1 | 1): Array<{ x: number; y: number }> {
  return world.river.map((point, index) => {
    const before = world.river[Math.max(0, index - 1)];
    const after = world.river[Math.min(world.river.length - 1, index + 1)];
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const length = Math.max(0.001, Math.hypot(dx, dy));
    return { x: point.x + (dy / length) * point.width * side, y: point.y - (dx / length) * point.width * side };
  });
}

function drawRiver(context: CanvasRenderingContext2D, world: LandscapeWorld, strength: number, palette: (typeof palettes)[number]): void {
  if (strength <= 0.01 || world.river.length < 2) return;
  const left = traceRiverEdge(world, -1);
  const right = traceRiverEdge(world, 1);
  const drawChannel = (extraWidth: number, color: string, alpha: number): void => {
    context.save();
    context.globalAlpha = alpha;
    context.beginPath();
    world.river.forEach((point, index) => {
      const before = world.river[Math.max(0, index - 1)];
      const after = world.river[Math.min(world.river.length - 1, index + 1)];
      const dx = after.x - before.x, dy = after.y - before.y;
      const length = Math.max(0.001, Math.hypot(dx, dy));
      const x = point.x - (dy / length) * (point.width + extraWidth);
      const y = point.y + (dx / length) * (point.width + extraWidth);
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    for (let index = right.length - 1; index >= 0; index -= 1) {
      const point = world.river[index];
      const before = world.river[Math.max(0, index - 1)];
      const after = world.river[Math.min(world.river.length - 1, index + 1)];
      const dx = after.x - before.x, dy = after.y - before.y;
      const length = Math.max(0.001, Math.hypot(dx, dy));
      context.lineTo(point.x + (dy / length) * (point.width + extraWidth), point.y - (dx / length) * (point.width + extraWidth));
    }
    context.closePath();
    context.fillStyle = color;
    context.fill();
    context.restore();
  };

  drawChannel(world.height * (0.003 + strength * 0.004), palette.bank, 0.9);
  drawChannel(0, palette.water, 0.82 + strength * 0.15);

  context.save();
  context.lineCap = "round";
  for (const index of [15, 29, 44, 58]) {
    const point = world.river[index];
    const next = world.river[Math.min(world.river.length - 1, index + 3)];
    if (!point || !next) continue;
    context.globalAlpha = 0.18 + (index / world.river.length) * 0.32;
    context.strokeStyle = palette.waterLight;
    context.lineWidth = Math.max(0.7, point.width * 0.16);
    context.beginPath();
    context.moveTo(point.x - point.width * 0.2, point.y);
    context.quadraticCurveTo(point.x, point.y + (next.y - point.y) * 0.45, next.x + point.width * 0.2, next.y);
    context.stroke();
  }
  context.restore();
}

export function drawLandscape(context: CanvasRenderingContext2D, width: number, height: number, options: LandscapeOptions): void {
  const palette = palettes[Math.abs(options.seed) % palettes.length];
  const world = createLandscapeWorld(width, height, options);
  const sky = context.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, palette.skyTop);
  sky.addColorStop(1, palette.skyBottom);
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);

  const sunX = width * (0.68 + (options.seed % 17) * 0.008);
  const sunY = height * 0.28;
  const sunRadius = Math.min(width, height) * 0.075;
  const glow = context.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunRadius * 3.8);
  glow.addColorStop(0, "rgba(244, 222, 177, 0.45)");
  glow.addColorStop(1, "rgba(244, 222, 177, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);
  context.beginPath();
  context.arc(sunX, sunY, sunRadius, 0, Math.PI * 2);
  context.fillStyle = palette.accent;
  context.globalAlpha = 0.8;
  context.fill();
  context.globalAlpha = 1;

  drawTerrainLayer(context, world.layers[0], width, height, palette.far);
  drawTerrainLayer(context, world.layers[1], width, height, palette.mid);
  drawForestLayer(context, world, world.layers[1], height, options.seed + 311, options.forest * 0.72, palette.far, 42, 0.72, 0.52);
  drawTerrainLayer(context, world.layers[2], width, height, palette.near);
  drawRiver(context, world, Math.max(0, Math.min(1, options.water)), palette);
  drawForestLayer(context, world, world.layers[2], height, options.seed + 977, options.forest, palette.near, 58, 1.25, 0.92);

  const mistStrength = Math.max(0, Math.min(1, options.mist));
  const haze = context.createLinearGradient(0, height * 0.42, 0, height);
  haze.addColorStop(0, "rgba(225, 226, 196, 0)");
  haze.addColorStop(0.58, "rgba(225, 226, 196, " + (0.025 + mistStrength * 0.12).toFixed(3) + ")");
  haze.addColorStop(1, "rgba(225, 226, 196, " + (0.06 + mistStrength * 0.24).toFixed(3) + ")");
  context.fillStyle = haze;
  context.fillRect(0, height * 0.42, width, height * 0.58);
  if (mistStrength > 0.02) {
    for (let band = 0; band < 3; band += 1) {
      const y = height * (0.56 + band * 0.105);
      const drift = Math.sin(options.seed * 0.013 + band * 2.1) * width * 0.035;
      const fog = context.createLinearGradient(0, y - height * 0.055, 0, y + height * 0.055);
      fog.addColorStop(0, "rgba(226, 232, 218, 0)");
      fog.addColorStop(0.5, "rgba(226, 232, 218, " + (mistStrength * (0.055 - band * 0.008)).toFixed(3) + ")");
      fog.addColorStop(1, "rgba(226, 232, 218, 0)");
      context.fillStyle = fog;
      context.fillRect(drift, y - height * 0.055, width, height * 0.11);
    }
  }
}
