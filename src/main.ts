import "./style.css";
import { drawLandscape } from "./generators/landscape";
import { getRenderSize } from "./core/quality";
import {
  evaluateGraph,
  type GraphDocument,
  type GraphNode,
  type GraphNodeDefinition,
  type GraphValue,
} from "./core/graph";
import { createCoreNodeRegistry } from "./core/nodes";
import { parseGraphDocument, serializeGraphDocument } from "./core/graph-document";

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
const nodeList = requiredElement<HTMLDivElement>("#node-list");
const graphStatus = requiredElement<HTMLElement>("#graph-status");
const graphMeta = requiredElement<HTMLElement>("#graph-meta");
const nodeTypeSelect = requiredElement<HTMLSelectElement>("#node-type");
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
    scale: typeof inputs.scale === "number" ? inputs.scale : Number(scaleInput.value),
    roughness: typeof inputs.roughness === "number" ? inputs.roughness : Number(roughnessInput.value),
    octaves: typeof inputs.octaves === "number" ? inputs.octaves : Number(detailInput.value),
  }),
};
const registry = new Map(createCoreNodeRegistry());
registry.set(outputDefinition.type, outputDefinition);

const STORAGE_KEY = "aether.graph.v1";
const DEFAULT_NODE_IDS = new Set(["scale", "roughness", "detail", "landscape"]);

function createDefaultGraph(): GraphDocument {
  return {
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
}

function restoreGraph(): GraphDocument {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return createDefaultGraph();
    const restored = parseGraphDocument(saved);
    if (!restored.nodes.some((node) => node.id === "landscape" && node.type === "landscape.compose")) {
      return createDefaultGraph();
    }
    evaluateGraph(restored, registry);
    return restored;
  } catch {
    return createDefaultGraph();
  }
}

let graphState = restoreGraph();
let selectedOutput: { nodeId: string; port: string } | null = null;
let nodeCounter = 1;
let edgeCounter = 1;

function saveGraph(): void {
  try {
    localStorage.setItem(STORAGE_KEY, serializeGraphDocument(graphState));
    graphStatus.textContent = "บันทึกในเครื่องแล้ว";
  } catch (error) {
    graphStatus.textContent = "บันทึก Graph ไม่สำเร็จ";
    console.warn(error);
  }
}

function setNodeParam(nodeId: string, key: string, value: GraphValue): void {
  graphState = {
    ...graphState,
    nodes: graphState.nodes.map((node) => node.id === nodeId
      ? { ...node, params: { ...node.params, [key]: value } }
      : node),
  };
}

function syncControlsFromGraph(): void {
  const valueFor = (id: string): number | null => {
    const value = graphState.nodes.find((node) => node.id === id)?.params?.value;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  const scale = valueFor("scale");
  const roughness = valueFor("roughness");
  const detail = valueFor("detail");
  if (scale !== null) scaleInput.value = String(scale);
  if (roughness !== null) roughnessInput.value = String(roughness);
  if (detail !== null) detailInput.value = String(detail);
}

syncControlsFromGraph();

function evaluateLandscapeGraph() {
  const result = evaluateGraph(graphState, registry);
  const values = result.values.get("landscape");
  if (!values) throw new Error("Landscape graph did not produce an output.");
  const number = (key: string): number => {
    const value = values[key] as GraphValue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError("Invalid graph output: " + key);
    }
    return value;
  };
  return { scale: number("scale"), roughness: number("roughness"), octaves: number("octaves") };
}

function readOptions() {
  return { seed: Number(seedInput.value) || 1, ...evaluateLandscapeGraph() };
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

const nodeLabels: Record<string, { title: string; category: string }> = {
  "number.constant": { title: "ค่าคงที่", category: "NUMBER" },
  "math.add": { title: "บวก", category: "MATH" },
  "math.multiply": { title: "คูณ", category: "MATH" },
  "math.clamp": { title: "จำกัดช่วง", category: "MATH" },
  "landscape.compose": { title: "Landscape Generator", category: "OUTPUT" },
};

function renderGraphEditor(): void {
  nodeList.replaceChildren();
  graphMeta.textContent = `${graphState.nodes.length} NODES · ${graphState.edges.length} LINKS`;

  for (const node of graphState.nodes) {
    const definition = registry.get(node.type);
    if (!definition) continue;
    const info = nodeLabels[node.type] ?? { title: node.type, category: "NODE" };
    const card = createElement("article", node.type === "landscape.compose" ? "editor-node output-node" : "editor-node");
    card.dataset.nodeId = node.id;

    const heading = createElement("div", "editor-node-heading");
    const identity = createElement("div", "editor-node-identity");
    identity.append(
      createElement("span", "node-type", info.category),
      createElement("strong", "editor-node-title", info.title),
      createElement("span", "node-id", node.id),
    );
    heading.append(identity);

    if (!DEFAULT_NODE_IDS.has(node.id)) {
      const remove = createElement("button", "remove-node", "ลบ");
      remove.type = "button";
      remove.dataset.action = "remove-node";
      remove.dataset.nodeId = node.id;
      remove.setAttribute("aria-label", "ลบ " + info.title);
      heading.append(remove);
    }
    card.append(heading);

    if (node.type === "number.constant") {
      const valueLabel = createElement("label", "node-param-label", "ค่า");
      const valueInput = createElement("input", "node-param-input");
      valueInput.type = "number";
      valueInput.step = "any";
      valueInput.inputMode = "decimal";
      valueInput.value = String(typeof node.params?.value === "number" ? node.params.value : 0);
      valueInput.dataset.nodeId = node.id;
      valueInput.dataset.param = "value";
      valueLabel.append(valueInput);
      card.append(valueLabel);
    }

    const ports = createElement("div", "node-ports");
    const inputGroup = createElement("div", "port-group");
    inputGroup.append(createElement("span", "port-heading", "INPUT"));
    if (definition.inputs.length === 0) {
      inputGroup.append(createElement("span", "port-empty", "ไม่มีช่องรับ"));
    } else {
      for (const port of definition.inputs) {
        const button = createElement("button", "port-button input-port", "← " + port);
        button.type = "button";
        button.dataset.action = "connect-input";
        button.dataset.nodeId = node.id;
        button.dataset.port = port;
        inputGroup.append(button);
      }
    }

    const outputGroup = createElement("div", "port-group output-group");
    outputGroup.append(createElement("span", "port-heading", "OUTPUT"));
    if (definition.outputs.length === 0) {
      outputGroup.append(createElement("span", "port-empty", "ไม่มีช่องส่ง"));
    } else {
      for (const port of definition.outputs) {
        const button = createElement("button", "port-button output-port", port + " →");
        button.type = "button";
        button.dataset.action = "select-output";
        button.dataset.nodeId = node.id;
        button.dataset.port = port;
        if (selectedOutput?.nodeId === node.id && selectedOutput.port === port) {
          button.classList.add("is-selected");
        }
        outputGroup.append(button);
      }
    }
    ports.append(inputGroup, outputGroup);
    card.append(ports);
    nodeList.append(card);
  }
}

function updateOutputs(): void {
  const options = readOptions();
  requiredElement<HTMLOutputElement>("#scale-value").textContent = options.scale.toFixed(1);
  requiredElement<HTMLOutputElement>("#roughness-value").textContent = options.roughness.toFixed(2);
  requiredElement<HTMLOutputElement>("#detail-value").textContent = String(options.octaves);
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
      renderGraphEditor();
      render();
    } catch (error) {
      renderStatus.textContent = "เกิดข้อผิดพลาด";
      graphStatus.textContent = error instanceof Error ? error.message : "Graph ทำงานไม่สำเร็จ";
      console.error(error);
    }
  });
}

function updateBaseNode(id: string, value: number): void {
  if (graphState.nodes.some((node) => node.id === id)) setNodeParam(id, "value", value);
}

for (const input of [seedInput, scaleInput, roughnessInput, detailInput]) {
  input.addEventListener("input", () => {
    if (input === scaleInput) updateBaseNode("scale", Number(input.value));
    if (input === roughnessInput) updateBaseNode("roughness", Number(input.value));
    if (input === detailInput) updateBaseNode("detail", Number(input.value));
    saveGraph();
    scheduleRender();
  });
}

nodeList.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest<HTMLButtonElement>("button[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const nodeId = button.dataset.nodeId;
  const port = button.dataset.port;

  if (action === "select-output" && nodeId && port) {
    selectedOutput = selectedOutput?.nodeId === nodeId && selectedOutput.port === port
      ? null
      : { nodeId, port };
    graphStatus.textContent = selectedOutput
      ? "เลือกช่องส่งแล้ว แตะช่องรับของ Node ปลายทาง"
      : "ยกเลิกการเลือกช่องส่งแล้ว";
    renderGraphEditor();
    return;
  }

  if (action === "connect-input" && nodeId && port) {
    if (!selectedOutput) {
      graphStatus.textContent = "แตะช่อง OUTPUT ก่อน แล้วจึงเลือก INPUT";
      return;
    }
    if (selectedOutput.nodeId === nodeId) {
      graphStatus.textContent = "ไม่สามารถเชื่อม Node เข้าหาตัวเองได้";
      return;
    }
    const edge = {
      id: (() => {
        let candidate = "edge-" + edgeCounter++;
        while (graphState.edges.some((item) => item.id === candidate)) candidate = "edge-" + edgeCounter++;
        return candidate;
      })(),
      fromNodeId: selectedOutput.nodeId,
      fromPort: selectedOutput.port,
      toNodeId: nodeId,
      toPort: port,
    };
    graphState = {
      ...graphState,
      edges: [
        ...graphState.edges.filter((item) => !(item.toNodeId === nodeId && item.toPort === port)),
        edge,
      ],
    };
    selectedOutput = null;
    saveGraph();
    graphStatus.textContent = "เชื่อมต่อแล้ว";
    scheduleRender();
    return;
  }

  if (action === "remove-node" && nodeId) {
    graphState = {
      nodes: graphState.nodes.filter((node) => node.id !== nodeId),
      edges: graphState.edges.filter((edge) => edge.fromNodeId !== nodeId && edge.toNodeId !== nodeId),
    };
    selectedOutput = null;
    saveGraph();
    graphStatus.textContent = "ลบ Node แล้ว";
    scheduleRender();
  }
});

nodeList.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.dataset.param !== "value") return;
  const value = Number(target.value);
  if (!Number.isFinite(value)) return;
  const nodeId = target.dataset.nodeId;
  if (!nodeId) return;
  setNodeParam(nodeId, "value", value);
  if (nodeId === "scale") scaleInput.value = String(value);
  if (nodeId === "roughness") roughnessInput.value = String(value);
  if (nodeId === "detail") detailInput.value = String(value);
  saveGraph();
  scheduleRender();
});

requiredElement<HTMLButtonElement>("#add-node").addEventListener("click", () => {
  const type = nodeTypeSelect.value;
  let id = "node-" + nodeCounter++;
  while (graphState.nodes.some((node) => node.id === id)) id = "node-" + nodeCounter++;
  const params: Record<string, GraphValue> = type === "number.constant"
    ? { value: 1 }
    : type === "math.clamp" ? { min: 0, max: 1 } : {};
  const node: GraphNode = { id, type, params };
  graphState = { ...graphState, nodes: [...graphState.nodes, node] };
  saveGraph();
  graphStatus.textContent = "เพิ่ม Node แล้ว เลือกช่อง OUTPUT เพื่อเริ่มเชื่อมต่อ";
  scheduleRender();
});

requiredElement<HTMLButtonElement>("#reset-graph").addEventListener("click", () => {
  graphState = createDefaultGraph();
  selectedOutput = null;
  syncControlsFromGraph();
  saveGraph();
  graphStatus.textContent = "คืนค่า Graph เริ่มต้นแล้ว";
  scheduleRender();
});

requiredElement<HTMLButtonElement>("#regenerate").addEventListener("click", scheduleRender);
requiredElement<HTMLButtonElement>("#randomize").addEventListener("click", () => {
  seedInput.value = String(Math.floor(Math.random() * 1_000_000));
  scheduleRender();
});

renderGraphEditor();
const observer = new ResizeObserver(scheduleRender);
observer.observe(canvas);
scheduleRender();
