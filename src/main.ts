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
const graphViewport = requiredElement<HTMLDivElement>("#graph-viewport");
const graphStatus = requiredElement<HTMLElement>("#graph-status");
const graphMeta = requiredElement<HTMLElement>("#graph-count");
const nodeTypeSelect = requiredElement<HTMLSelectElement>("#node-type");
const graphFileInput = requiredElement<HTMLInputElement>("#graph-file");
const graphSearchInput = requiredElement<HTMLInputElement>("#graph-search");
const graphCategorySelect = requiredElement<HTMLSelectElement>("#graph-category");
const graphFilterCount = requiredElement<HTMLElement>("#graph-filter-count");
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

const STORAGE_KEY = "aether.graph.v2";
const LEGACY_STORAGE_KEY = "aether.graph.v1";
const DEFAULT_NODE_IDS = new Set(["scale", "roughness", "detail", "landscape"]);

function createDefaultGraph(): GraphDocument {
  return {
    nodes: [
      { id: "scale", type: "number.constant", params: { value: Number(scaleInput.value) } },
      { id: "roughness", type: "number.constant", params: { value: Number(roughnessInput.value) } },
      { id: "detail", type: "number.constant", params: { value: Number(detailInput.value) } },
      { id: "landscape", type: "landscape.compose" },
    ],
    layout: { scale: { x: 40, y: 40 }, roughness: { x: 330, y: 40 }, detail: { x: 40, y: 320 }, landscape: { x: 330, y: 320 } },
    edges: [
      { id: "e-scale", fromNodeId: "scale", fromPort: "value", toNodeId: "landscape", toPort: "scale" },
      { id: "e-roughness", fromNodeId: "roughness", fromPort: "value", toNodeId: "landscape", toPort: "roughness" },
      { id: "e-detail", fromNodeId: "detail", fromPort: "value", toNodeId: "landscape", toPort: "octaves" },
    ],
  };
}

function restoreGraph(): GraphDocument {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
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
const collapsedGroups = new Set<string>();
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

const graphStage = document.createElement("div");
graphStage.className = "graph-stage";
const wireLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
wireLayer.classList.add("graph-wires");
wireLayer.setAttribute("aria-hidden", "true");
graphStage.append(wireLayer); graphViewport.append(graphStage);
let viewX = 0, viewY = 0, viewScale = 0.6;
let gesture: { kind: "pan" | "node" | "wire"; pointerId: number; sx: number; sy: number; ox: number; oy: number; id?: string; fromNodeId?: string; fromPort?: string } | null = null;
function nodePosition(id: string, index: number) { return graphState.layout?.[id] ?? { x: 60 + (index % 3) * 340, y: 60 + Math.floor(index / 3) * 250 }; }
function drawGraphWires(): void {
  wireLayer.setAttribute("viewBox", "0 0 1500 1200"); wireLayer.setAttribute("width", "1500"); wireLayer.setAttribute("height", "1200"); wireLayer.replaceChildren();
  for (const edge of graphState.edges) {
    const source = graphStage.querySelector<HTMLElement>('[data-node-id="' + CSS.escape(edge.fromNodeId) + '"] [data-kind="out"][data-port="' + CSS.escape(edge.fromPort) + '"]');
    const target = graphStage.querySelector<HTMLElement>('[data-node-id="' + CSS.escape(edge.toNodeId) + '"] [data-kind="in"][data-port="' + CSS.escape(edge.toPort) + '"]');
    if (!source || !target) continue;
    const sr = source.getBoundingClientRect(), tr = target.getBoundingClientRect(), wr = graphStage.getBoundingClientRect();
    const x1 = (sr.left + sr.width / 2 - wr.left) / viewScale, y1 = (sr.top + sr.height / 2 - wr.top) / viewScale;
    const x2 = (tr.left + tr.width / 2 - wr.left) / viewScale, y2 = (tr.top + tr.height / 2 - wr.top) / viewScale;
    const bend = Math.max(55, Math.abs(x2 - x1) * 0.4);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M " + x1 + " " + y1 + " C " + (x1 + bend) + " " + y1 + ", " + (x2 - bend) + " " + y2 + ", " + x2 + " " + y2);
    path.setAttribute("class", "graph-wire"); wireLayer.append(path);
  }
}
function applyGraphView(): void { graphStage.style.transform = "translate(" + viewX + "px," + viewY + "px) scale(" + viewScale + ")"; drawGraphWires(); }
function renderGraphEditor(): void {
  for (const child of Array.from(graphStage.children)) if (child !== wireLayer) child.remove();
  graphMeta.textContent = graphState.nodes.length + " NODES · " + graphState.edges.length + " LINKS";
  const query = graphSearchInput.value.trim().toLocaleLowerCase();
  const categoryFilter = graphCategorySelect.value;
  const visibleNodes = graphState.nodes.filter((node) => {
    const info = nodeLabels[node.type] ?? { title: node.type, category: "NODE" };
    const matchesCategory = categoryFilter === "all" || info.category === categoryFilter;
    const haystack = [node.id, node.type, info.title, info.category].join(" ").toLocaleLowerCase();
    return matchesCategory && (!query || haystack.includes(query));
  });
  graphFilterCount.textContent = query || categoryFilter !== "all"
    ? "แสดง " + visibleNodes.length + " จาก " + graphState.nodes.length + " Node"
    : "จัดกลุ่มอัตโนมัติตามประเภท Node";
  const groups = new Map<string, GraphNode[]>();
  for (const node of visibleNodes) {
    const category = (nodeLabels[node.type] ?? { category: "NODE" }).category;
    const items = groups.get(category) ?? [];
    items.push(node);
    groups.set(category, items);
  }
  const categoryOrder = ["NUMBER", "MATH", "OUTPUT", "NODE"];
  const orderedGroups = [...groups.entries()].sort((a, b) => categoryOrder.indexOf(a[0]) - categoryOrder.indexOf(b[0]));
  for (const [category, nodes] of orderedGroups) {
    const positions = nodes.map((node) => nodePosition(node.id, graphState.nodes.findIndex((item) => item.id === node.id)));
    const groupX = Math.max(12, Math.min(...positions.map((pos) => pos.x)));
    const groupY = Math.max(8, Math.min(...positions.map((pos) => pos.y)) - 39);
    const collapsed = collapsedGroups.has(category);
    const groupButton = createElement("button", "graph-group-toggle" + (collapsed ? " is-collapsed" : ""), "");
    groupButton.type = "button";
    groupButton.dataset.action = "toggle-group";
    groupButton.dataset.category = category;
    groupButton.style.left = groupX + "px";
    groupButton.style.top = groupY + "px";
    const groupName: Record<string, string> = { NUMBER: "ตัวเลข", MATH: "คณิตศาสตร์", OUTPUT: "ผลลัพธ์", NODE: "อื่น ๆ" };
    groupButton.textContent = (collapsed ? "＋ " : "− ") + (groupName[category] ?? category) + " · " + nodes.length;
    groupButton.setAttribute("aria-expanded", String(!collapsed));
    groupButton.setAttribute("aria-label", (collapsed ? "ขยายกลุ่ม " : "พับกลุ่ม ") + (groupName[category] ?? category));
    graphStage.append(groupButton);
    if (collapsed) continue;
    nodes.forEach((node) => {
      const definition = registry.get(node.type); if (!definition) return;
      const info = nodeLabels[node.type] ?? { title: node.type, category: "NODE" };
      const card = createElement("article", node.type === "landscape.compose" ? "editor-node output-node" : "editor-node");
      card.dataset.nodeId = node.id; const pos = nodePosition(node.id, graphState.nodes.findIndex((item) => item.id === node.id)); card.style.left = pos.x + "px"; card.style.top = pos.y + "px";
      const heading = createElement("div", "editor-node-heading node-drag-handle");
      const identity = createElement("div", "editor-node-identity");
      identity.append(createElement("span", "node-type", info.category), createElement("strong", "editor-node-title", info.title), createElement("span", "node-id", node.id)); heading.append(identity);
      const actions = createElement("div", "node-actions");
      if (!DEFAULT_NODE_IDS.has(node.id)) { const remove = createElement("button", "remove-node", "ลบ"); remove.type = "button"; remove.dataset.action = "remove-node"; remove.dataset.nodeId = node.id; actions.append(remove); }
      if (actions.childElementCount) heading.append(actions); card.append(heading);
      if (node.type === "number.constant") {
        const label = createElement("label", "node-param-label", "ค่า"), input = createElement("input", "node-param-input");
        input.type = "number"; input.step = "any"; input.inputMode = "decimal"; input.value = String(typeof node.params?.value === "number" ? node.params.value : 0);
        if (node.id === "scale") { input.min = "0.5"; input.max = "2.4"; input.step = "0.1"; }
        if (node.id === "roughness") { input.min = "0.15"; input.max = "0.85"; input.step = "0.05"; }
        if (node.id === "detail") { input.min = "1"; input.max = "6"; input.step = "1"; }
        input.dataset.nodeId = node.id; input.dataset.param = "value"; label.append(input); card.append(label);
      }
      const ports = createElement("div", "node-ports"), ins = createElement("div", "port-group"), outs = createElement("div", "port-group output-group");
      ins.append(createElement("span", "port-heading", "INPUT")); outs.append(createElement("span", "port-heading", "OUTPUT"));
      if (!definition.inputs.length) ins.append(createElement("span", "port-empty", "ไม่มีช่องรับ"));
      for (const port of definition.inputs) { const edge = graphState.edges.find((item) => item.toNodeId === node.id && item.toPort === port); const from = edge ? graphState.nodes.find((item) => item.id === edge.fromNodeId)?.id : null;
        const btn = createElement("button", "port-button input-port", edge ? "← " + port + " · " + (from ?? "connected") : "← " + port); btn.type = "button"; btn.dataset.action = "connect-input"; btn.dataset.nodeId = node.id; btn.dataset.port = port; btn.dataset.kind = "in"; ins.append(btn); }
      if (!definition.outputs.length) outs.append(createElement("span", "port-empty", "ไม่มีช่องส่ง"));
      for (const port of definition.outputs) { const btn = createElement("button", "port-button output-port", port + " →"); btn.type = "button"; btn.dataset.action = "select-output"; btn.dataset.nodeId = node.id; btn.dataset.port = port; btn.dataset.kind = "out"; if (selectedOutput?.nodeId === node.id && selectedOutput.port === port) btn.classList.add("is-selected"); outs.append(btn); }
      ports.append(ins, outs); card.append(ports); graphStage.append(card);
    });
  }
  applyGraphView();
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
    scheduleRender();
  });
  input.addEventListener("change", saveGraph);
}

graphStage.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest<HTMLButtonElement>("button[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const nodeId = button.dataset.nodeId;
  const category = button.dataset.category;

  if (action === "toggle-group" && category) {
    if (collapsedGroups.has(category)) collapsedGroups.delete(category);
    else collapsedGroups.add(category);
    renderGraphEditor();
    return;
  }
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
      const existing = graphState.edges.find((item) => item.toNodeId === nodeId && item.toPort === port);
      if (existing) {
        graphState = { ...graphState, edges: graphState.edges.filter((item) => item.id !== existing.id) };
        saveGraph();
        graphStatus.textContent = "ยกเลิกการเชื่อมต่อแล้ว";
        scheduleRender();
      } else {
        graphStatus.textContent = "แตะช่อง OUTPUT ก่อน แล้วจึงเลือก INPUT";
      }
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
    const candidate: GraphDocument = {
      ...graphState,
      edges: [
        ...graphState.edges.filter((item) => !(item.toNodeId === nodeId && item.toPort === port)),
        edge,
      ],
    };
    try {
      evaluateGraph(candidate, registry);
    } catch (error) {
      graphStatus.textContent = error instanceof Error ? error.message : "การเชื่อมต่อนี้ใช้ไม่ได้";
      selectedOutput = null;
      renderGraphEditor();
      return;
    }
    graphState = candidate;
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
      layout: Object.fromEntries(Object.entries(graphState.layout ?? {}).filter(([id]) => id !== nodeId)),
    };
    selectedOutput = null;
    saveGraph();
    graphStatus.textContent = "ลบ Node แล้ว";
    scheduleRender();
  }
});

graphStage.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.dataset.param !== "value") return;
  let value = Number(target.value);
  if (!Number.isFinite(value)) return;
  const nodeId = target.dataset.nodeId;
  if (!nodeId) return;
  if (target.min !== "" && target.max !== "") {
    value = Math.min(Number(target.max), Math.max(Number(target.min), value));
  }
  if (nodeId === "detail") value = Math.round(value);
  target.value = String(value);
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
  const pos = { x: 360 + (graphState.nodes.length % 3) * 300, y: 80 + Math.floor(graphState.nodes.length / 3) * 240 };
  graphState = { ...graphState, nodes: [...graphState.nodes, node], layout: { ...graphState.layout, [id]: pos } };
  saveGraph();
  graphStatus.textContent = "เพิ่ม Node แล้ว เลือกช่อง OUTPUT เพื่อเริ่มเชื่อมต่อ";
  scheduleRender();
});

requiredElement<HTMLButtonElement>("#export-graph").addEventListener("click", () => {
  try {
    const source = serializeGraphDocument(graphState);
    const blob = new Blob([source], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "aether-graph.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    graphStatus.textContent = "ส่งออก Graph แล้ว";
  } catch (error) {
    graphStatus.textContent = error instanceof Error ? error.message : "ส่งออก Graph ไม่สำเร็จ";
  }
});

requiredElement<HTMLButtonElement>("#import-graph").addEventListener("click", () => {
  graphFileInput.click();
});

graphFileInput.addEventListener("change", async () => {
  const file = graphFileInput.files?.[0];
  if (!file) return;
  try {
    if (file.size > 1_000_000) throw new Error("ไฟล์ Graph ต้องมีขนาดไม่เกิน 1 MB");
    const imported = parseGraphDocument(await file.text());
    if (!imported.nodes.some((node) => node.id === "landscape" && node.type === "landscape.compose")) {
      throw new Error("ไฟล์นี้ไม่มี Landscape Generator");
    }
    evaluateGraph(imported, registry);
    graphState = imported;
    selectedOutput = null;
    syncControlsFromGraph();
    saveGraph();
    graphStatus.textContent = "นำเข้า Graph สำเร็จ";
    scheduleRender();
  } catch (error) {
    graphStatus.textContent = error instanceof Error ? error.message : "นำเข้า Graph ไม่สำเร็จ";
  } finally {
    graphFileInput.value = "";
  }
});

requiredElement<HTMLButtonElement>("#reset-graph").addEventListener("click", () => {
  graphState = createDefaultGraph();
  viewX = 0; viewY = 0; viewScale = 0.6;
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

graphViewport.addEventListener("pointerdown", (event) => {
  const target = event.target as HTMLElement;
  const outputPort = target.closest<HTMLButtonElement>('button[data-action="select-output"]');
  if (outputPort?.dataset.nodeId && outputPort.dataset.port) {
    const rect = outputPort.getBoundingClientRect(), stageRect = graphStage.getBoundingClientRect();
    gesture = { kind: "wire", pointerId: event.pointerId, sx: event.clientX, sy: event.clientY,
      ox: (rect.left + rect.width / 2 - stageRect.left) / viewScale,
      oy: (rect.top + rect.height / 2 - stageRect.top) / viewScale,
      fromNodeId: outputPort.dataset.nodeId, fromPort: outputPort.dataset.port };
    graphViewport.setPointerCapture(event.pointerId); event.preventDefault(); return;
  }
  const card = target.closest<HTMLElement>(".editor-node"), handle = target.closest<HTMLElement>(".node-drag-handle");
  if (card && handle && !target.closest("button,input,select")) {
    const id = card.dataset.nodeId; if (!id) return; const pos = nodePosition(id, graphState.nodes.findIndex(n => n.id === id));
    gesture = { kind: "node", pointerId: event.pointerId, sx: event.clientX, sy: event.clientY, ox: pos.x, oy: pos.y, id };
    card.classList.add("is-dragging"); graphViewport.setPointerCapture(event.pointerId); event.preventDefault(); return;
  }
  if (!card && (target === graphViewport || target === graphStage || event.target === wireLayer)) {
    gesture = { kind: "pan", pointerId: event.pointerId, sx: event.clientX, sy: event.clientY, ox: viewX, oy: viewY }; graphViewport.setPointerCapture(event.pointerId);
  }
});
graphViewport.addEventListener("pointermove", (event) => {
  if (!gesture || gesture.pointerId !== event.pointerId) return; const dx = event.clientX - gesture.sx, dy = event.clientY - gesture.sy;
  if (gesture.kind === "pan") { viewX = gesture.ox + dx; viewY = gesture.oy + dy; applyGraphView(); }
  else if (gesture.kind === "wire") {
    drawGraphWires();
    const rect = graphStage.getBoundingClientRect();
    const x = (event.clientX - rect.left) / viewScale, y = (event.clientY - rect.top) / viewScale;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const bend = Math.max(55, Math.abs(x - gesture.ox) * 0.4);
    path.setAttribute("d", "M " + gesture.ox + " " + gesture.oy + " C " + (gesture.ox + bend) + " " + gesture.oy + ", " + (x - bend) + " " + y + ", " + x + " " + y);
    path.setAttribute("class", "graph-wire graph-wire-preview"); wireLayer.append(path);
  }
  else if (gesture.id) { const x = Math.max(0, Math.min(10000, gesture.ox + dx / viewScale)), y = Math.max(0, Math.min(10000, gesture.oy + dy / viewScale));
    graphState = { ...graphState, layout: { ...graphState.layout, [gesture.id]: { x, y } } }; const node = graphStage.querySelector<HTMLElement>('[data-node-id="' + CSS.escape(gesture.id) + '"]');
    if (node) { node.style.left = x + "px"; node.style.top = y + "px"; } drawGraphWires();
  }
});
function endGraphGesture(event: PointerEvent): void {
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  if (gesture.kind === "node") { graphStage.querySelector(".is-dragging")?.classList.remove("is-dragging"); saveGraph(); }
  else if (gesture.kind === "wire") {
    const fromNodeId = gesture.fromNodeId, fromPort = gesture.fromPort;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const input = hit instanceof Element ? hit.closest<HTMLButtonElement>('button[data-action="connect-input"]') : null;
    if (fromNodeId && fromPort && input?.dataset.nodeId && input.dataset.port) {
      const toNodeId = input.dataset.nodeId, toPort = input.dataset.port;
      if (fromNodeId === toNodeId) graphStatus.textContent = "ไม่สามารถเชื่อม Node เข้าหาตัวเองได้";
      else {
        const edgeId = (() => { let candidate = "edge-" + edgeCounter++; while (graphState.edges.some(item => item.id === candidate)) candidate = "edge-" + edgeCounter++; return candidate; })();
        const edge = { id: edgeId, fromNodeId, fromPort, toNodeId, toPort };
        const candidate: GraphDocument = { ...graphState, edges: [...graphState.edges.filter(item => !(item.toNodeId === toNodeId && item.toPort === toPort)), edge] };
        try { evaluateGraph(candidate, registry); graphState = candidate; saveGraph(); graphStatus.textContent = "เชื่อมต่อแล้ว"; scheduleRender(); }
        catch (error) { graphStatus.textContent = error instanceof Error ? error.message : "การเชื่อมต่อนี้ใช้ไม่ได้"; renderGraphEditor(); }
      }
    } else {
      selectedOutput = fromNodeId && fromPort ? { nodeId: fromNodeId, port: fromPort } : null;
      graphStatus.textContent = "เลือกช่องส่งแล้ว แตะช่องรับหรือเชื่อมด้วยการลากสาย"; renderGraphEditor();
    }
  }
  gesture = null;
}
graphViewport.addEventListener("pointerup", endGraphGesture); graphViewport.addEventListener("pointercancel", endGraphGesture);
graphViewport.addEventListener("wheel", (event) => { event.preventDefault(); const r = graphViewport.getBoundingClientRect(), px = event.clientX-r.left, py = event.clientY-r.top;
  const next = Math.max(0.35, Math.min(1.5, viewScale * (event.deltaY < 0 ? 1.08 : 0.92))), ratio = next/viewScale;
  viewX = px - (px-viewX)*ratio; viewY = py - (py-viewY)*ratio; viewScale = next; applyGraphView(); }, { passive: false });
requiredElement<HTMLButtonElement>("#graph-zoom-in").addEventListener("click", () => { viewScale = Math.min(1.5, viewScale*1.15); applyGraphView(); });
requiredElement<HTMLButtonElement>("#graph-zoom-out").addEventListener("click", () => { viewScale = Math.max(0.35, viewScale/1.15); applyGraphView(); });
requiredElement<HTMLButtonElement>("#graph-zoom-reset").addEventListener("click", () => { viewX=0; viewY=0; viewScale=0.6; applyGraphView(); });
renderGraphEditor();
const observer = new ResizeObserver(() => { scheduleRender(); drawGraphWires(); });
observer.observe(canvas);
scheduleRender();
