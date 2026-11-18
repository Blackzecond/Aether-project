import { generateTerrain } from "../terrain/landforms";
import type { TerrainRecipe } from "../recipe";

interface Request { readonly id:number; readonly recipe:TerrainRecipe }
interface WorkerScope {
  onmessage:((event:MessageEvent<Request>)=>void)|null;
  postMessage(message:unknown,transfer?:Transferable[]):void;
}
const scope=self as unknown as WorkerScope;
scope.onmessage=(event:MessageEvent<Request>):void=>{
  const {id,recipe}=event.data;
  try{
    const generated=generateTerrain(recipe);
    const field=generated.heightfield;
    scope.postMessage({
      id,ok:true,
      heightfield:{width:field.width,height:field.height,bounds:field.bounds,values:field.values.buffer},
      diagnostics:generated.diagnostics,
      backend:"heightfield",
    },[field.values.buffer]);
  }catch(error){
    scope.postMessage({id,ok:false,error:error instanceof Error?error.message:"Terrain generation failed"});
  }
};
