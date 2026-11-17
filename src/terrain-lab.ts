import { DEFAULT_TERRAIN_RECIPE, createHeightfield, buildDrainageField, extractRiverNetwork, generateVegetation, type TerrainRecipe } from "./world";
import type { VolumeMesh, VolumeMeshChunk } from "./world/volume/density-world";
import { TerrainPreviewRenderer, type TerrainViewMode } from "./render/webgl2/terrain-preview";
const canvas=document.querySelector<HTMLCanvasElement>("#terrain-canvas")!;
const status=document.querySelector<HTMLElement>("#lab-status")!;
const metrics=document.querySelector<HTMLElement>("#lab-metrics")!;
const renderer=new TerrainPreviewRenderer(canvas);
let recipe:TerrainRecipe={...DEFAULT_TERRAIN_RECIPE,landform:{...DEFAULT_TERRAIN_RECIPE.landform}};
const controls=[
  ["spacing","mountainSpacing"],["relief","relief"],["sharpness","peakSharpness"],
  ["irregularity","ridgeIrregularity"],["roughness","roughness"],["detail-scale","detailScale"],["octaves","detailOctaves"],
] as const;
function updateLabels():void {
  for(const [id,key] of controls){const input=document.querySelector<HTMLInputElement>(`#${id}`)!;document.querySelector<HTMLOutputElement>(`#${id}-value`)!.value=Number(input.value).toFixed(key==="detailOctaves"?0:2);}
  document.querySelector<HTMLOutputElement>("#seed-value")!.value=String(recipe.seed);
}
interface DensityWorkerMessage {
  readonly id:number;
  readonly ok:boolean;
  readonly error?:string;
  readonly heightfield?:{readonly width:number;readonly height:number;readonly bounds:TerrainRecipe["bounds"] extends infer B?NonNullable<B>:never;readonly values:ArrayBuffer};
  readonly mesh?:{readonly positions:ArrayBuffer;readonly normals:ArrayBuffer;readonly indices:ArrayBuffer;readonly vertexCount:number;readonly triangleCount:number;readonly chunks:readonly VolumeMeshChunk[];readonly lods:readonly {readonly positions:ArrayBuffer;readonly normals:ArrayBuffer;readonly indices:ArrayBuffer;readonly vertexCount:number;readonly triangleCount:number;readonly chunks:readonly VolumeMeshChunk[]}[]};
  readonly diagnostics?:{readonly samples:number;readonly vertices:number;readonly triangles:number;readonly occupiedSamples:number};
  readonly backend?:"webgpu"|"cpu";
}
const densityWorker=new Worker(new URL("./world/volume/density-worker.ts",import.meta.url),{type:"module"});
const device=navigator as Navigator&{deviceMemory?:number};
const densityResolution=device.deviceMemory!==undefined&&device.deviceMemory<=4
  ?{width:72,height:44,depth:72}
  :device.deviceMemory!==undefined&&device.deviceMemory>=8&&(navigator.hardwareConcurrency??4)>=8
    ?{width:112,height:64,depth:112}
    :{width:88,height:52,depth:88};
let requestId=0;
let renderTimer:number|undefined;
let latestRefreshHydrology=true;
function finishRender(message:DensityWorkerMessage):void{
  if(!message.ok||!message.heightfield||!message.mesh||!message.diagnostics){
    status.textContent=message.error??"สร้างภูมิประเทศสามมิติไม่สำเร็จ";return;
  }
  try{
    const field=createHeightfield(
      message.heightfield.width,message.heightfield.height,
      new Float32Array(message.heightfield.values),message.heightfield.bounds,
    );
    const mesh:VolumeMesh={
      positions:new Float32Array(message.mesh.positions),
      normals:new Float32Array(message.mesh.normals),
      indices:new Uint32Array(message.mesh.indices),
      vertexCount:message.mesh.vertexCount,triangleCount:message.mesh.triangleCount,chunks:message.mesh.chunks,
      lods:message.mesh.lods.map(lod=>({positions:new Float32Array(lod.positions),normals:new Float32Array(lod.normals),indices:new Uint32Array(lod.indices),vertexCount:lod.vertexCount,triangleCount:lod.triangleCount,chunks:lod.chunks})),
    };
    renderer.setVolumeTerrain(field,mesh);
    const mode=document.querySelector<HTMLSelectElement>("#debug-mode")!.value as TerrainViewMode;
    renderer.setMode(mode);
    let hydrologyMetrics="";
    if((mode==="world"||mode==="first-person"||mode==="hydrology")&&latestRefreshHydrology){
      const drainage=buildDrainageField(field);
      const rivers=extractRiverNetwork(field,drainage);
      renderer.setHydrology(field,drainage,rivers);
      const vegetation=generateVegetation(field,recipe.seed,rivers);
      renderer.setVegetation(vegetation.instances);renderer.setGroundCover(vegetation.groundCover);
      hydrologyMetrics=`<span class="lab-chip">ต้นไม้ ${vegetation.diagnostics.trees.toLocaleString("th-TH")} ต้น</span><span class="lab-chip">พืชพื้น ${vegetation.diagnostics.groundCover.toLocaleString("th-TH")} จุด</span><span class="lab-chip">ทางน้ำ ${rivers.diagnostics.channelCellCount.toLocaleString("th-TH")} จุด</span><span class="lab-chip">ต้นน้ำ ${rivers.diagnostics.headwaterCount.toLocaleString("th-TH")}</span><span class="lab-chip">ทางออก ${rivers.diagnostics.outletCount.toLocaleString("th-TH")}</span><span class="lab-chip">สะสมสูงสุด ${drainage.diagnostics.maximumAccumulation.toLocaleString("th-TH")}</span>`;
    }
    renderer.resize();
    metrics.innerHTML=`<span class="lab-chip">จุดปริมาตร ${message.diagnostics.samples.toLocaleString("th-TH")}</span><span class="lab-chip">Vertices ${message.diagnostics.vertices.toLocaleString("th-TH")}</span><span class="lab-chip">Triangles ${message.diagnostics.triangles.toLocaleString("th-TH")}</span><span class="lab-chip">พื้นที่ทึบ ${message.diagnostics.occupiedSamples.toLocaleString("th-TH")}</span>${hydrologyMetrics}`;
    status.textContent="สร้างโลกสามมิติสำเร็จ · "+(message.backend==="webgpu"?"WebGPU Compute":"CPU fallback")+" · Seed "+recipe.seed;updateLabels();
  }catch(error){status.textContent=error instanceof Error?error.message:"สร้างโลกสามมิติไม่สำเร็จ";}
}
densityWorker.addEventListener("message",(event:MessageEvent<DensityWorkerMessage>)=>{
  if(event.data.id!==requestId)return;
  finishRender(event.data);
});
function render(refreshHydrology=true):void{
  if(renderTimer!==undefined){window.clearTimeout(renderTimer);renderTimer=undefined;}
  latestRefreshHydrology=refreshHydrology;
  const id=++requestId;
  status.textContent="กำลังสร้างภูมิประเทศสามมิติ…";
  densityWorker.postMessage({id,recipe,resolution:densityResolution});
}
function scheduleRender(refreshHydrology:boolean):void{
  if(renderTimer!==undefined)window.clearTimeout(renderTimer);
  renderTimer=window.setTimeout(()=>render(refreshHydrology),140);
}
for(const [id,key] of controls){
  document.querySelector<HTMLInputElement>(`#${id}`)!.addEventListener("input",event=>{
    const value=Number((event.currentTarget as HTMLInputElement).value);
    recipe={...recipe,landform:{...recipe.landform,[key]:value}};scheduleRender(false);
  });
  document.querySelector<HTMLInputElement>(`#${id}`)!.addEventListener("change",()=>render());
}
document.querySelector<HTMLButtonElement>("#reset-camera")!.addEventListener("click",()=>renderer.resetCamera());
document.querySelector<HTMLSelectElement>("#debug-mode")!.addEventListener("change",()=>{
  const mode=document.querySelector<HTMLSelectElement>("#debug-mode")!.value;
  document.querySelector<HTMLElement>(".lab-canvas")!.classList.toggle("is-exploring",mode==="first-person");
  render();
});
const movementKeys=new Set(["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright"]);
window.addEventListener("keydown",event=>{
  if(!movementKeys.has(event.key.toLowerCase()) || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if(document.querySelector<HTMLSelectElement>("#debug-mode")!.value!=="first-person") return;
  event.preventDefault();
  const key=event.key.toLowerCase();
  renderer.movePlayer(key==="w"||key==="arrowup"?1:key==="s"||key==="arrowdown"?-1:0,key==="d"||key==="arrowright"?1:key==="a"||key==="arrowleft"?-1:0);
});
let movementFrame=0;
let movementDirection:string|undefined;
let previousMovementTime=0;
const stopMovement=():void=>{
  movementDirection=undefined;
  previousMovementTime=0;
  if(movementFrame)window.cancelAnimationFrame(movementFrame);
  movementFrame=0;
};
const animateMovement=(time:number):void=>{
  if(!movementDirection)return;
  const delta=previousMovementTime?Math.min((time-previousMovementTime)/1000,0.05):1/60;
  previousMovementTime=time;
  const direction=movementDirection;
  renderer.movePlayer(direction==="forward"?1:direction==="back"?-1:0,direction==="right"?1:direction==="left"?-1:0,delta);
  movementFrame=window.requestAnimationFrame(animateMovement);
};
document.querySelectorAll<HTMLButtonElement>("[data-move]").forEach(button=>{
  button.addEventListener("pointerdown",event=>{
    if(event.button!==0)return;
    event.preventDefault();
    stopMovement();
    button.setPointerCapture(event.pointerId);
    movementDirection=button.dataset.move!;
    previousMovementTime=0;
    movementFrame=window.requestAnimationFrame(animateMovement);
  });
  for(const name of ["pointerup","pointercancel","lostpointercapture"])button.addEventListener(name,stopMovement);
});
window.addEventListener("pointerup",stopMovement);
window.addEventListener("pointercancel",stopMovement);
window.addEventListener("blur",stopMovement);
document.addEventListener("visibilitychange",()=>{if(document.hidden)stopMovement();});
document.querySelector<HTMLInputElement>("#seed")!.addEventListener("input",event=>{
  recipe={...recipe,seed:Number((event.currentTarget as HTMLInputElement).value)};scheduleRender(false);
});
document.querySelector<HTMLInputElement>("#seed")!.addEventListener("change",()=>render());
document.querySelector<HTMLButtonElement>("#new-seed")!.addEventListener("click",()=>{
  const seed=Math.floor(Math.random()*99999)+1;recipe={...recipe,seed};
  (document.querySelector<HTMLInputElement>("#seed")!).value=String(seed);render();
});
document.querySelector<HTMLButtonElement>("#reset-terrain")!.addEventListener("click",()=>{
  recipe={...DEFAULT_TERRAIN_RECIPE,landform:{...DEFAULT_TERRAIN_RECIPE.landform}};
  for(const [id,key] of controls)(document.querySelector<HTMLInputElement>(`#${id}`)!).value=String(recipe.landform[key]);
  (document.querySelector<HTMLInputElement>("#seed")!).value=String(recipe.seed);render();
});
const observer=new ResizeObserver(()=>renderer.resize());observer.observe(canvas.parentElement!);
window.addEventListener("beforeunload",()=>{observer.disconnect();densityWorker.terminate();renderer.dispose();});
render();
