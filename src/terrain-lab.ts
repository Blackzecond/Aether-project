import { DEFAULT_TERRAIN_RECIPE, generateTerrain, buildDrainageField, extractRiverNetwork, type TerrainRecipe } from "./world";
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
function render():void {
  try {
    const generated=generateTerrain(recipe);renderer.setTerrain(generated.heightfield);
    const mode=document.querySelector<HTMLSelectElement>("#debug-mode")!.value as TerrainViewMode;renderer.setMode(mode);
    const d=generated.diagnostics;
    let hydrologyMetrics="";
    if(mode==="hydrology"){
      const drainage=buildDrainageField(generated.heightfield);
      const rivers=extractRiverNetwork(generated.heightfield,drainage);
      renderer.setHydrology(drainage,rivers);
      hydrologyMetrics=`<span class="lab-chip">ทางน้ำ ${rivers.diagnostics.channelCellCount.toLocaleString("th-TH")} จุด</span><span class="lab-chip">ต้นน้ำ ${rivers.diagnostics.headwaterCount.toLocaleString("th-TH")}</span><span class="lab-chip">ทางออก ${rivers.diagnostics.outletCount.toLocaleString("th-TH")}</span><span class="lab-chip">สะสมสูงสุด ${drainage.diagnostics.maximumAccumulation.toLocaleString("th-TH")}</span>`;
    }
    renderer.resize();
    metrics.innerHTML=`<span class="lab-chip">จุด ${generated.heightfield.values.length.toLocaleString("th-TH")}</span><span class="lab-chip">ต่ำสุด ${d.min.toFixed(3)}</span><span class="lab-chip">สูงสุด ${d.max.toFixed(3)}</span><span class="lab-chip">ความแปรปรวน ${d.variance.toFixed(4)}</span><span class="lab-chip">Slope เฉลี่ย ${d.slopeMean.toFixed(3)}</span>${hydrologyMetrics}`;
    status.textContent="สร้างสำเร็จ · Seed "+recipe.seed;updateLabels();
  } catch(error) {status.textContent=error instanceof Error?error.message:"สร้างภูมิประเทศไม่สำเร็จ";}
}
for(const [id,key] of controls){
  document.querySelector<HTMLInputElement>(`#${id}`)!.addEventListener("input",event=>{
    const value=Number((event.currentTarget as HTMLInputElement).value);
    recipe={...recipe,landform:{...recipe.landform,[key]:value}};render();
  });
}
document.querySelector<HTMLButtonElement>("#reset-camera")!.addEventListener("click",()=>renderer.resetCamera());
document.querySelector<HTMLSelectElement>("#debug-mode")!.addEventListener("change",event=>{
  renderer.setMode((event.currentTarget as HTMLSelectElement).value as TerrainViewMode);renderer.render();
});
document.querySelector<HTMLInputElement>("#seed")!.addEventListener("input",event=>{
  recipe={...recipe,seed:Number((event.currentTarget as HTMLInputElement).value)};render();
});
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
window.addEventListener("beforeunload",()=>{observer.disconnect();renderer.dispose();});
render();
