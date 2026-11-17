import "./style.css";
import { drawLandscape } from "./generators/landscape";
import { getRenderSize } from "./core/quality";
import { evaluateGraph, type GraphDocument, type GraphNodeDefinition, type GraphValue } from "./core/graph";
import { createCoreNodeRegistry } from "./core/nodes";

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
const renderStatus = requiredElement<HTMLElement>("#render-status");
const seedLabel = requiredElement<HTMLElement>("#seed-label");
const resolutionLabel = requiredElement<HTMLElement>("#resolution-label");
const nodeScale = requiredElement<HTMLElement>("#node-scale");
const nodeRoughness = requiredElement<HTMLElement>("#node-roughness");
const nodeDetail = requiredElement<HTMLElement>("#node-detail");

const context = (() => {
  const value = canvas.getContext("2d", { alpha: false, desynchronized: true });
  if (!value) throw new Error("This browser does not provide a 2D canvas context.");
  return value;
})();

const outputDefinition: GraphNodeDefinition = {
  type: "landscape.compose",
  inputs: ["scale", "roughness", "octaves"],
  outputs: ["scale", "roughness", "octaves"],
  evaluate: (inputs) => ({
    scale: inputs.scale,
    roughness: inputs.roughness,
    octaves: inputs.octaves,
  }),
};
const registry = new Map(createCoreNodeRegistry());
registry.set(outputDefinition.type, outputDefinition);

function evaluateLandscapeGraph() {
  const graph: GraphDocument = {
    nodes: [
      { id: "scale", type: "number.constant", params: { value: Number(scaleInput.value) } },
      { id: "roughness", type: "number.constant", params: { value: Number(roughnessInput.value) } },
      { id: "detail", type: "number.constant", params: { value: Number(detailInput.value) } },
      { id: "landscape", type: "landscape.compose" },
    ],
    edges: [
      { id: "e-scale", fromNodeId: "scale", fromPort: "value", toNodeId: "landscape", toPort: "scale" },
      { id: "e-roughness", fromNodeId: "roughness", fromPort: "value", toNodeId: "landscape", toPort: "roughness" },
      { id: "e-detail", fromNodeId: "detail", fromPort: "value", toNodeId: "landscape", toPort: "octaves" },
    ],
  };
  const result = evaluateGraph(graph, registry);
  const values = result.values.get("landscape");
  if (!values) throw new Error("Landscape graph did not produce an output.");
  const number = (key: string): number => {
    const value = values[key] as GraphValue;
    if (typeof value !== "number") throw new TypeError("Invalid graph output: " + key);
    return value;
  };
  return { scale: number("scale"), roughness: number("roughness"), octaves: number("octaves") };
}

function readOptions() {
  return { seed: Number(seedInput.value) || 1, ...evaluateLandscapeGraph() };
}

function updateOutputs(): void {
  const options = readOptions();
  requiredElement<HTMLOutputElement>("#scale-value").textContent = options.scale.toFixed(1);
  requiredElement<HTMLOutputElement>("#roughness-value").textContent = options.roughness.toFixed(2);
  requiredElement<HTMLOutputElement>("#detail-value").textContent = String(options.octaves);
  nodeScale.textContent = options.scale.toFixed(1);
  nodeRoughness.textContent = options.roughness.toFixed(2);
  nodeDetail.textContent = String(options.octaves);
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
  renderStatus.textContent = "สร้างแล้ว";
  seedLabel.textContent = `SEED ${options.seed}`;
  resolutionLabel.textContent = `${size.width} × ${size.height} PX`;
}

let renderQueued = false;
function scheduleRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    try {
      updateOutputs();
      render();
    } catch (error) {
      renderStatus.textContent = "เกิดข้อผิดพลาด";
      console.error(error);
    }
  });
}

for (const input of [seedInput, scaleInput, roughnessInput, detailInput]) {
  input.addEventListener("input", scheduleRender);
}
requiredElement<HTMLButtonElement>("#regenerate").addEventListener("click", scheduleRender);
requiredElement<HTMLButtonElement>("#randomize").addEventListener("click", () => {
  seedInput.value = String(Math.floor(Math.random() * 1_000_000));
  scheduleRender();
});

const observer = new ResizeObserver(scheduleRender);
observer.observe(canvas);
scheduleRender();
