import { fbm2 } from "../core/noise";

export interface LandscapeOptions {
  seed: number;
  scale: number;
  roughness: number;
  octaves: number;
  mist: number;
  forest: number;
  water: number;
}

const palettes = [
  { skyTop: "#172c38", skyBottom: "#668b8d", far: "#597e78", mid: "#315e59", near: "#183b3c", accent: "#c6c99c", water: "#477f83", waterLight: "#a7c6b8" },
  { skyTop: "#27283d", skyBottom: "#a47e86", far: "#9b7880", mid: "#6a596e", near: "#3b3e58", accent: "#e7c6a1", water: "#637e91", waterLight: "#d1b8aa" },
  { skyTop: "#132f3a", skyBottom: "#7a9a91", far: "#78968a", mid: "#496f67", near: "#254a48", accent: "#d1d5ad", water: "#4f8580", waterLight: "#b9d0b5" },
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

function drawForest(context: CanvasRenderingContext2D, width: number, height: number, seed: number, density: number, palette: (typeof palettes)[number]): void {
  if (density <= 0.01) return;
  const random = seededRandom(seed);
  const farCount = Math.round(12 + density * 38);
  for (let i = 0; i < farCount; i += 1) {
    const x = random() * width;
    const y = height * (0.73 + random() * 0.115);
    const size = height * (0.025 + random() * 0.045) * (0.35 + density * 0.65);
    const color = random() > 0.5 ? palette.far : palette.mid;
    drawPine(context, x, y, size, color, 0.25 + random() * 0.3, random());
  }
  const nearCount = Math.round(density * 54);
  for (let i = 0; i < nearCount; i += 1) {
    const x = random() * width;
    const depth = random();
    const size = height * (0.065 + depth * 0.13) * (0.45 + density * 0.7);
    const baseY = height * (0.88 + depth * 0.12);
    const shade = random();
    const color = shade > 0.68 ? palette.mid : palette.near;
    const alpha = 0.62 + depth * 0.34;
    if (random() > 0.22) drawPine(context, x, baseY, size, color, alpha, random());
    else drawRoundTree(context, x, baseY, size * 0.92, color, alpha, random());
  }
}

function drawRiver(context: CanvasRenderingContext2D, width: number, height: number, strength: number, palette: (typeof palettes)[number], seed: number): void {
  if (strength <= 0.01) return;
  const center = width * (0.46 + (seed % 13) * 0.012);
  const topY = height * (0.755 + (seed % 5) * 0.006);
  const bottomWidth = width * (0.06 + strength * 0.25);
  const topWidth = width * (0.008 + strength * 0.025);
  context.save();
  context.globalAlpha = 0.42 + strength * 0.48;
  context.beginPath();
  context.moveTo(center - topWidth, topY);
  context.bezierCurveTo(center - topWidth * 2.8, height * 0.84, center - bottomWidth * 0.75, height * 0.9, width * 0.5 - bottomWidth, height * 1.04);
  context.lineTo(width * 0.5 + bottomWidth, height * 1.04);
  context.bezierCurveTo(center + bottomWidth * 0.7, height * 0.9, center + topWidth * 2.4, height * 0.84, center + topWidth, topY);
  context.closePath();
  context.fillStyle = "#142f37";
  context.fill();
  context.beginPath();
  context.moveTo(center - topWidth * 0.65, topY);
  context.bezierCurveTo(center - topWidth * 1.8, height * 0.84, center - bottomWidth * 0.6, height * 0.91, width * 0.5 - bottomWidth * 0.82, height * 1.04);
  context.lineTo(width * 0.5 + bottomWidth * 0.82, height * 1.04);
  context.bezierCurveTo(center + bottomWidth * 0.58, height * 0.91, center + topWidth * 1.7, height * 0.84, center + topWidth * 0.65, topY);
  context.closePath();
  context.fillStyle = palette.water;
  context.fill();
  context.globalAlpha *= 0.55;
  context.strokeStyle = palette.waterLight;
  context.lineWidth = Math.max(1, height * 0.003);
  context.lineCap = "round";
  for (let i = 0; i < 7; i += 1) {
    const t = i / 7;
    const y = height * (0.83 + t * 0.16);
    const spread = topWidth + t * bottomWidth * 0.55;
    const x = center + Math.sin(seed * 0.02 + i * 1.7) * spread * 0.3;
    context.beginPath();
    context.moveTo(x - spread * 0.24, y);
    context.quadraticCurveTo(x, y - height * 0.006, x + spread * 0.24, y + height * 0.002);
    context.stroke();
  }
  context.restore();
}

export function drawLandscape(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: LandscapeOptions,
): void {
  const palette = palettes[Math.abs(options.seed) % palettes.length];
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

  const layers = [
    { base: 0.58, amplitude: 0.13, color: palette.far, frequency: 1.5, seed: 11 },
    { base: 0.70, amplitude: 0.16, color: palette.mid, frequency: 2.2, seed: 37 },
    { base: 0.84, amplitude: 0.13, color: palette.near, frequency: 3.1, seed: 83 },
  ];
  const samples = Math.min(420, Math.max(100, Math.round(width / 3)));
  for (const layer of layers) {
    context.beginPath();
    context.moveTo(0, height);
    for (let i = 0; i <= samples; i += 1) {
      const x = (i / samples) * width;
      const nx = (i / samples) * options.scale * layer.frequency;
      const broad = fbm2(nx * 3, layer.seed, options.seed + layer.seed, options.octaves, 0.52, 2);
      const fine = fbm2(nx * 11, layer.seed * 0.17, options.seed + layer.seed * 3, options.octaves, options.roughness, 2.1);
      const ridge = Math.abs(fine * 2 - 1);
      const displacement = (broad - 0.5) * 0.72 + (ridge - 0.5) * options.roughness * 0.28;
      context.lineTo(x, height * (layer.base + displacement * layer.amplitude));
    }
    context.lineTo(width, height);
    context.closePath();
    context.fillStyle = layer.color;
    context.fill();
  }

  drawForest(context, width, height, options.seed, Math.max(0, Math.min(1, options.forest)), palette);
  drawRiver(context, width, height, Math.max(0, Math.min(1, options.water)), palette, options.seed);

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
