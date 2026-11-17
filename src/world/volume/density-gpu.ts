import { generateTerrain } from "../terrain/landforms";
import { createRandom } from "../../core/random";
import { sampleElevation } from "../fields/heightfield";
import { DEFAULT_WORLD_BOUNDS } from "../coordinates";
import type { TerrainRecipe } from "../recipe";
import { assembleDensityWorld, type DensityResolution, type DensityWorld } from "./density-world";

type GpuLike = any;

/** Optional WebGPU density pass. Returns null when WebGPU is unavailable or initialization fails. */
export async function generateDensityWorldGpu(
  recipe:TerrainRecipe,
  resolution:DensityResolution,
):Promise<DensityWorld|null>{
  const gpu=(navigator as Navigator&{gpu?:GpuLike}).gpu;
  if(!gpu)return null;
  let device:GpuLike|undefined;
  try{
    const adapter=await gpu.requestAdapter({powerPreference:"low-power"});
    if(!adapter)return null;
    device=await adapter.requestDevice();
    const base=generateTerrain(recipe).heightfield;
    const {width,height,depth}=resolution;
    if(![width,height,depth].every(n=>Number.isInteger(n)&&n>=12&&n<=192))throw new Error("Density grid dimensions must be integers from 12 to 192");
    const bounds=recipe.bounds??DEFAULT_WORLD_BOUNDS;
    const origin={x:bounds.minX,y:-0.055,z:bounds.minZ},maxY=0.92;
    const voxelSize={x:(bounds.maxX-bounds.minX)/(width-1),y:(maxY-origin.y)/(height-1),z:(bounds.maxZ-bounds.minZ)/(depth-1)};
    const plane=new Float32Array(width*depth);
    for(let z=0;z<depth;z++)for(let x=0;x<width;x++){
      const wx=origin.x+x*voxelSize.x,wz=origin.z+z*voxelSize.z;
      const gx=(wx-bounds.minX)/(bounds.maxX-bounds.minX)*(base.width-1);
      const gz=(wz-bounds.minZ)/(bounds.maxZ-bounds.minZ)*(base.height-1);
      const x0=Math.floor(gx),z0=Math.floor(gz),x1=Math.min(base.width-1,x0+1),z1=Math.min(base.height-1,z0+1);
      const tx=gx-x0,tz=gz-z0;
      const a=base.values[z0*base.width+x0]*(1-tx)+base.values[z0*base.width+x1]*tx;
      const b=base.values[z1*base.width+x0]*(1-tx)+base.values[z1*base.width+x1]*tx;
      plane[z*width+x]=(a*(1-tz)+b*tz)*1.18;
    }
    const random=createRandom(recipe.seed^0x5f3759df);
    const featureData=new Float32Array((13+3)*8);
    for(let i=0;i<13;i++){
      const x=bounds.minX+random()*(bounds.maxX-bounds.minX),z=bounds.minZ+random()*(bounds.maxZ-bounds.minZ);
      const ground=sampleElevation(base,x,z)*1.18,rx=0.045+random()*0.095;
      const offset=i*8;
      featureData.set([x,ground+0.025+random()*0.11,z,rx,0.045+random()*0.13,0.045+random()*0.11,0.035+random()*0.025,0],offset);
    }
    const caves=[
      [-0.48,0.23,-0.18,-0.12,0.31,0.05,0.045],
      [0.22,0.30,0.38,0.55,0.35,0.18,0.035],
      [-0.08,0.43,-0.52,0.17,0.39,-0.28,0.028],
    ];
    for(let i=0;i<caves.length;i++)featureData.set([...caves[i],0],(13+i)*8);
    const total=width*height*depth;
    const usage=(globalThis as any).GPUBufferUsage??{MAP_READ:1,COPY_SRC:4,COPY_DST:8,UNIFORM:64,STORAGE:128};
    const heights=device.createBuffer({size:plane.byteLength,usage:usage.STORAGE|usage.COPY_DST});
    const output=device.createBuffer({size:total*4,usage:usage.STORAGE|usage.COPY_SRC});
    const params=new Float32Array([width,height,depth,width,depth,origin.x,origin.y,origin.z,voxelSize.x,voxelSize.y,voxelSize.z,recipe.seed]);
    const config=device.createBuffer({size:params.byteLength,usage:usage.STORAGE|usage.COPY_DST});\n    const features=device.createBuffer({size:featureData.byteLength,usage:usage.STORAGE|usage.COPY_DST});
    const readback=device.createBuffer({size:total*4,usage:usage.MAP_READ|usage.COPY_DST});
    device.queue.writeBuffer(heights,0,plane);
    device.queue.writeBuffer(config,0,params);\n    device.queue.writeBuffer(features,0,featureData);
    const shader=device.createShaderModule({code:`
      struct Params { data:array<f32> };
      @group(0) @binding(0) var<storage,read> ground:array<f32>;
      @group(0) @binding(1) var<storage,read_write> density:array<f32>;
      @group(0) @binding(2) var<storage,read> p:Params;\n      @group(0) @binding(3) var<storage,read> features:array<vec4<f32>>;\n      fn smoothMax(a:f32,b:f32,k:f32)->f32{let h=max(k-abs(a-b),0.0)/k;return max(a,b)+h*h*k*0.25;}\n      fn smoothMin(a:f32,b:f32,k:f32)->f32{return -smoothMax(-a,-b,k);}\n      fn ellipsoid(pos:vec3<f32>,center:vec3<f32>,radii:vec3<f32>)->f32{let q=(pos-center)/radii;let k0=length(q);let k1=length(q/radii);return select(min(radii.x,min(radii.y,radii.z)),(1.0-k0)/k1,k1>0.000001);}\n      fn capsule(pos:vec3<f32>,a:vec3<f32>,b:vec3<f32>,radius:f32)->f32{let ab=b-a;let t=clamp(dot(pos-a,ab)/(dot(ab,ab)+0.000001),0.0,1.0);return length(pos-a-ab*t)-radius;}
      fn hash3(v:vec3<f32>)->f32{
        return fract(sin(dot(v,vec3<f32>(127.1,311.7,74.7))+p.data[11]*0.001)*43758.5453);
      }
      fn noise3(v:vec3<f32>)->f32{
        let i=floor(v);let f=fract(v);let u=f*f*(vec3<f32>(3.0)-2.0*f);
        let n000=hash3(i+vec3<f32>(0,0,0));let n100=hash3(i+vec3<f32>(1,0,0));
        let n010=hash3(i+vec3<f32>(0,1,0));let n110=hash3(i+vec3<f32>(1,1,0));
        let n001=hash3(i+vec3<f32>(0,0,1));let n101=hash3(i+vec3<f32>(1,0,1));
        let n011=hash3(i+vec3<f32>(0,1,1));let n111=hash3(i+vec3<f32>(1,1,1));
        let a=mix(mix(n000,n100,u.x),mix(n010,n110,u.x),u.y);
        let b=mix(mix(n001,n101,u.x),mix(n011,n111,u.x),u.y);
        return mix(a,b,u.z)*2.0-1.0;
      }
      fn fbm(v:vec3<f32>)->f32{
        return (noise3(v)+noise3(v*2.03)*0.5+noise3(v*4.12)*0.25)/1.75;
      }
      @compute @workgroup_size(64)
      fn main(@builtin(global_invocation_id) gid:vec3<u32>){
        let nx=u32(p.data[0]);let ny=u32(p.data[1]);let nz=u32(p.data[2]);
        let total=nx*ny*nz;let id=gid.x;if(id>=total){return;}
        let x=id%nx;let y=(id/nx)%ny;let z=id/(nx*ny);
        let planeIndex=z*nx+x;let base=ground[planeIndex];
        let wx=p.data[5]+f32(x)*p.data[8];let wy=p.data[6]+f32(y)*p.data[9];let wz=p.data[7]+f32(z)*p.data[10];
        let baseDensity=base-wy;let rockMask=clamp((base-0.055)/0.22,0.0,1.0);
        var erosion=0.0;
        if(abs(baseDensity)<0.085 && rockMask>0.02){
          let q=vec3<f32>(wx,wy,wz);
          let warp=vec3<f32>(fbm(q*7.5),fbm(q*7.5+vec3<f32>(13,0,-9)),fbm(q*7.5+vec3<f32>(-7,5,11)))*0.025;
          let warped=q+warp;
          erosion=(fbm(warped*12.0)*0.004+noise3(warped*27.0)*0.0045+noise3(warped*54.0)*0.0018)*rockMask;
        }
        var value=baseDensity+erosion;
        let pos=vec3<f32>(wx,wy,wz);
        for(var r=0u;r<13u;r++){
          let a=features[r*2u];let b=features[r*2u+1u];
          if(abs(wx-a.x)<a.w*1.5&&abs(wy-a.y)<b.x*1.5&&abs(wz-a.z)<b.y*1.5){
            value=smoothMax(value,ellipsoid(pos,a.xyz,vec3<f32>(a.w,b.x,b.y)),b.z);
          }
        }
        for(var ci=0u;ci<3u;ci++){
          let a=features[(13u+ci)*2u];let b=features[(13u+ci)*2u+1u];
          if(wy>=min(a.y,b.x)-b.z&&wy<=max(a.y,b.x)+b.z
            &&wx>=min(a.x,a.w)-b.z&&wx<=max(a.x,a.w)+b.z
            &&wz>=min(a.z,b.y)-b.z&&wz<=max(a.z,b.y)+b.z){
            value=smoothMin(value,capsule(pos,a.xyz,vec3<f32>(a.w,b.x,b.y),b.z),0.018);
          }
        }
        if(x==0u||z==0u||x==nx-1u||z==nz-1u||y==0u||y==ny-1u){value=-0.08;}
        density[id]=value;
      }
    `});
    const pipeline=device.createComputePipeline({layout:"auto",compute:{module:shader,entryPoint:"main"}});
    const bindGroup=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
      {binding:0,resource:{buffer:heights}},{binding:1,resource:{buffer:output}},{binding:2,resource:{buffer:config}},{binding:3,resource:{buffer:features}},
    ]});
    const encoder=device.createCommandEncoder();
    const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bindGroup);pass.dispatchWorkgroups(Math.ceil(total/64));pass.end();
    encoder.copyBufferToBuffer(output,0,readback,0,total*4);device.queue.submit([encoder.finish()]);
    await readback.mapAsync((globalThis as any).GPUMapMode?.READ??1);
    const values=new Float32Array(readback.getMappedRange().slice(0));readback.unmap();
    heights.destroy();output.destroy();config.destroy();features.destroy();readback.destroy();
    return assembleDensityWorld({width,height,depth,origin,voxelSize,values});
  }catch{
    return null;
  }finally{
    device?.destroy?.();
  }
}
