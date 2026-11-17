export interface RenderSize {
  width: number;
  height: number;
  scale: number;
}

interface DeviceHints {
  deviceMemory?: number;
}

/** Conservative render sizing: cap both DPR and total pixels, especially on phones. */
export function getRenderSize(cssWidth: number, cssHeight: number): RenderSize {
  const hints = navigator as Navigator & DeviceHints;
  const isCoarsePointer = matchMedia("(pointer: coarse)").matches;
  const memory = hints.deviceMemory ?? 4;
  const maxDpr = isCoarsePointer || memory <= 4 ? 1.25 : 1.75;
  const maxPixels = isCoarsePointer || memory <= 4 ? 1_100_000 : 2_000_000;
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  const pixelBudgetScale = Math.min(1, Math.sqrt(maxPixels / Math.max(1, cssWidth * cssHeight * dpr * dpr)));
  const scale = dpr * pixelBudgetScale;

  return {
    width: Math.max(1, Math.round(cssWidth * scale)),
    height: Math.max(1, Math.round(cssHeight * scale)),
    scale,
  };
}
