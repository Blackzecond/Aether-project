import { fbm2 } from "../core/noise";

export interface LandscapeOptions {
  seed: number;
  scale: number;
  roughness: number;
  octaves: number;
}

const palettes = [
  { skyTop: "#172c38", skyBottom: "#668b8d", far: "#597e78", mid: "#315e59", near: "#183b3c", accent: "#c6c99c" },
  { skyTop: "#27283d", skyBottom: "#a47e86", far: "#9b7880", mid: "#6a596e", near: "#3b3e58", accent: "#e7c6a1" },
  { skyTop: "#132f3a", skyBottom: "#7a9a91", far: "#78968a", mid: "#496f67", near: "#254a48", accent: "#d1d5ad" },
];

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
      const y = height * (layer.base + displacement * layer.amplitude);
      context.lineTo(x, y);
    }
    context.lineTo(width, height);
    context.closePath();
    context.fillStyle = layer.color;
    context.fill();
  }

  const haze = context.createLinearGradient(0, height * 0.48, 0, height);
  haze.addColorStop(0, "rgba(225, 226, 196, 0)");
  haze.addColorStop(1, "rgba(225, 226, 196, 0.10)");
  context.fillStyle = haze;
  context.fillRect(0, height * 0.48, width, height * 0.52);
}
