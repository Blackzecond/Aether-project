import "./style.css";
import { drawLandscape } from "./generators/landscape";
import { getRenderSize } from "./core/quality";

const canvas = document.querySelector<HTMLCanvasElement>("#preview");
const seedInput = document.querySelector<HTMLInputElement>("#seed");
const scaleInput = document.querySelector<HTMLInputElement>("#scale");
const roughnessInput = document.querySelector<HTMLInputElement>("#roughness");
const detailInput = document.querySelector<HTMLInputElement>("#detail");
const renderStatus = document.querySelector<HTMLElement>("#render-status");
const seedLabel = document.querySelector<HTMLElement>("#seed-label");
const resolutionLabel = document.querySelector<HTMLElement>("#resolution-label");

if (!canvas || !seedInput || !scaleInput || !roughnessInput || !detailInput) {
  throw new Error("Aether workspace could not initialize: required controls are missing.");
}

const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
if (!context) throw new Error("This browser does not provide a 2D canvas context.");

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
  drawLandscape(context, rect.width, rect.height, readOptions());

  if (renderStatus) renderStatus.textContent = "GENERATED";
  if (seedLabel) seedLabel.textContent = `SEED ${readOptions().seed}`;
  if (resolutionLabel) resolutionLabel.textContent = `${size.width} × ${size.height} PX`;
}

function updateOutputs(): void {
  document.querySelector("#scale-value")!.textContent = Number(scaleInput.value).toFixed(1);
  document.querySelector("#roughness-value")!.textContent = Number(roughnessInput.value).toFixed(2);
  document.querySelector("#detail-value")!.textContent = detailInput.value;
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
