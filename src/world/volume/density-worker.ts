import { generateDensityWorld, type DensityResolution } from "./density-world";
import { generateDensityWorldGpu } from "./density-gpu";
import type { TerrainRecipe } from "../recipe";

interface Request { readonly id:number; readonly recipe:TerrainRecipe; readonly resolution:DensityResolution }
interface WorkerScope {
  onmessage:((event:MessageEvent<Request>)=>void)|null;
  postMessage(message:unknown,transfer?:Transferable[]):void;
}
const scope=self as unknown as WorkerScope;
scope.onmessage=(event:MessageEvent<Request>):void=>{
  const {id,recipe,resolution}=event.data;
  void (async()=>{
    try{
      const gpuWorld=await generateDensityWorldGpu(recipe,resolution);
      const world=gpuWorld??generateDensityWorld(recipe,resolution);
      const heightfield=world.heightfield,mesh=world.mesh;
      const response={
        id,ok:true as const,
        heightfield:{width:heightfield.width,height:heightfield.height,bounds:heightfield.bounds,values:heightfield.values.buffer},
        mesh:{
          positions:mesh.positions.buffer,normals:mesh.normals.buffer,indices:mesh.indices.buffer,
          vertexCount:mesh.vertexCount,triangleCount:mesh.triangleCount,chunks:mesh.chunks,
          lods:mesh.lods.map(lod=>({
            positions:lod.positions.buffer,normals:lod.normals.buffer,indices:lod.indices.buffer,
            vertexCount:lod.vertexCount,triangleCount:lod.triangleCount,chunks:lod.chunks,
          })),
        },
        diagnostics:world.diagnostics,backend:gpuWorld?"webgpu" as const:"cpu" as const,
      };
      const transfers:Transferable[]=[heightfield.values.buffer,mesh.positions.buffer,mesh.normals.buffer,mesh.indices.buffer];
      for(const lod of mesh.lods.slice(1))transfers.push(lod.positions.buffer,lod.normals.buffer,lod.indices.buffer);
      scope.postMessage(response,transfers);
    }catch(error){
      scope.postMessage({id,ok:false as const,error:error instanceof Error?error.message:"Density generation failed"});
    }
  })();
};
