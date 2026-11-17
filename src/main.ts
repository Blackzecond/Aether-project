import "./style.css";
import { drawLandscape } from "./generators/landscape";
import { getRenderSize } from "./core/quality";

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Aether workspace is missing required element: ${selector}`);
  return element;
}

const canvas = requiredElement<HTMLCanvasElement>("#preview");
const seedInput = requiredElement<HTMLInputElement>("#seed");
const scaleInput = requiredElement<HTMLInputElement>("#scale");
const roughnessInput = requiredElement<HTMLInputElement>("#roughness");
const detailInput = requiredElement<HTMLInputElement>("#detail");
const renderStatus = document.querySelector<HTMLElement>("#render-status");
const seedLabel = document.querySelector<HTMLElement>("#seed-label");
const resolutionLabel = document.querySelector<HTMLElement>("#resolution-label");

const context = (() => {
  const value = canvas.getContext("2d", { alpha: false, desynchronized: true });
  if (!value) throw new Error("This browser does not provide a 2D canvas context.");
  return value;
})();

function readOptions() {
  return {
    seed: Number(seedInput.value) || 1,
    scale: Number(scaleInput.value),
    roughness: Number(roughnessInput.value),
    octaves: Number(detailInput.value),
  };
}

function render(): void {
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;

  const size = getRenderSize(rect.width, rect.height);
  if (canvas.width !== size.width || canvas.height !== size.height) {
    canvas.width = size.width;
    canvas.height = size.height;
  }

  context.setTransform(size.scale, 0, 0, size.scale, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  const options = readOptions();
  drawLandscape(context, rect.width, rect.height, options);

  if (renderStatus) renderStatus.textContent = "GENERATED";
  if (seedLabel) seedLabel.textContent = `SEED ${options.seed}`;
  if (resolutionLabel) resolutionLabel.textContent = `${size.width} × ${size.height} PX`;
}

function updateOutputs(): void {
  requiredElement<HTMLOutputElement>("#scale-value").textContent = Number(scaleInput.value).toFixed(1);
  requiredElement<HTMLOutputElement>("#roughness-value").textContent = Number(roughnessInput.value).toFixed(2);
  requiredElement<HTMLOutputElement>("#detail-value").textContent = detailInput.value;
}

let renderQueued = false;
function scheduleRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

for (const input of [seedInput, scaleInput, roughnessInput, detailInput]) {
  input.addEventListener("input", () => {
    updateOutputs();
    scheduleRender();
  });
}

document.querySelector<HTMLButtonElement>("#regenerate")?.addEventListener("click", scheduleRender);
document.querySelector<HTMLButtonElement>("#randomize")?.addEventListener("click", () => {
  seedInput.value = String(Math.floor(Math.random() * 1_000_000));
  updateOutputs();
  scheduleRender();
});

const observer = new ResizeObserver(scheduleRender);
observer.observe(canvas);
updateOutputs();
scheduleRender();
