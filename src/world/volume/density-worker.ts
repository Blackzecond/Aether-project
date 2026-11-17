import { generateDensityWorld, type DensityResolution } from "./density-world";
import type { TerrainRecipe } from "../recipe";

interface Request { readonly id:number; readonly recipe:TerrainRecipe; readonly resolution:DensityResolution }
interface WorkerScope {
  onmessage:((event:MessageEvent<Request>)=>void)|null;
  postMessage(message:unknown,transfer?:Transferable[]):void;
}
const scope=self as unknown as WorkerScope;
scope.onmessage=(event:MessageEvent<Request>):void=>{
  const {id,recipe,resolution}=event.data;
  try{
    const world=generateDensityWorld(recipe,resolution);
    const heightfield=world.heightfield,mesh=world.mesh;
    const response={
      id,ok:true as const,
      heightfield:{width:heightfield.width,height:heightfield.height,bounds:heightfield.bounds,values:heightfield.values.buffer},
      mesh:{positions:mesh.positions.buffer,normals:mesh.normals.buffer,indices:mesh.indices.buffer,vertexCount:mesh.vertexCount,triangleCount:mesh.triangleCount},
      diagnostics:world.diagnostics,
    };
    scope.postMessage(response,[heightfield.values.buffer,mesh.positions.buffer,mesh.normals.buffer,mesh.indices.buffer]);
  }catch(error){
    scope.postMessage({id,ok:false as const,error:error instanceof Error?error.message:"Density generation failed"});
  }
};
