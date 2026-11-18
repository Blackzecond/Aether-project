import { createRandom, hash32 } from "../../core/random";
import { createHeightfield, sampleElevation, type Heightfield } from "../fields/heightfield";
import { DEFAULT_WORLD_BOUNDS } from "../coordinates";
import { generateTerrain } from "../terrain/landforms";
import type { TerrainRecipe } from "../recipe";

export interface DensityVolume {
  readonly width:number;readonly height:number;readonly depth:number;
  readonly origin:{readonly x:number;readonly y:number;readonly z:number};
  readonly voxelSize:{readonly x:number;readonly y:number;readonly z:number};
  readonly values:Float32Array;
}
export interface VolumeMeshChunk {readonly startIndex:number;readonly indexCount:number;readonly centerX:number;readonly centerZ:number}
export interface VolumeMeshLod {
  readonly positions:Float32Array;readonly normals:Float32Array;readonly indices:Uint32Array;
  readonly vertexCount:number;readonly triangleCount:number;readonly chunks:readonly VolumeMeshChunk[];
}
export interface VolumeMesh extends VolumeMeshLod {readonly lods:readonly VolumeMeshLod[]}
export interface DensityWorld {
  readonly heightfield:Heightfield;readonly volume:DensityVolume;readonly mesh:VolumeMesh;
  readonly diagnostics:{readonly samples:number;readonly vertices:number;readonly triangles:number;readonly occupiedSamples:number};
}
export interface DensityResolution {readonly width:number;readonly height:number;readonly depth:number}
const clamp=(v:number,a:number,b:number):number=>Math.max(a,Math.min(b,v));
const mix=(a:number,b:number,t:number):number=>a+(b-a)*t;
const smoothMax=(a:number,b:number,k:number):number=>{const h=Math.max(k-Math.abs(a-b),0)/k;return Math.max(a,b)+h*h*k*0.25;};
const smoothMin=(a:number,b:number,k:number):number=>-smoothMax(-a,-b,k);
function latticeHash(x:number,y:number,z:number,seed:number):number{
  return hash32(seed^Math.imul(x,0x8da6b343)^Math.imul(y,0xd8163841)^Math.imul(z,0xcb1ab31f))/4294967295;
}
function valueNoise3(x:number,y:number,z:number,seed:number):number{
  const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),fx=x-ix,fy=y-iy,fz=z-iz;
  const sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy),sz=fz*fz*(3-2*fz);
  const a=mix(latticeHash(ix,iy,iz,seed),latticeHash(ix+1,iy,iz,seed),sx);
  const b=mix(latticeHash(ix,iy+1,iz,seed),latticeHash(ix+1,iy+1,iz,seed),sx);
  const c=mix(latticeHash(ix,iy,iz+1,seed),latticeHash(ix+1,iy,iz+1,seed),sx);
  const d=mix(latticeHash(ix,iy+1,iz+1,seed),latticeHash(ix+1,iy+1,iz+1,seed),sx);
  return mix(mix(a,b,sy),mix(c,d,sy),sz)*2-1;
}
function fbm3(x:number,y:number,z:number,seed:number,octaves:number):number{
  let frequency=1,amplitude=0.5,total=0,weight=0;
  for(let i=0;i<octaves;i++){total+=valueNoise3(x*frequency,y*frequency,z*frequency,seed+i*1013)*amplitude;weight+=amplitude;frequency*=2.03;amplitude*=0.5;}
  return total/weight;
}
function worley3(x:number,y:number,z:number,seed:number):number{
  const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);let nearest=Infinity;
  for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const cx=ix+dx,cy=iy+dy,cz=iz+dz;
    const ox=cx+latticeHash(cx,cy,cz,seed)-x,oy=cy+latticeHash(cx,cy,cz,seed+31)-y,oz=cz+latticeHash(cx,cy,cz,seed+67)-z;
    const d=ox*ox+oy*oy+oz*oz;if(d<nearest)nearest=d;
  }
  return Math.sqrt(nearest);
}
interface Cave{ax:number;ay:number;az:number;bx:number;by:number;bz:number;radius:number}
function capsuleDistance(x:number,y:number,z:number,c:Cave):number{
  const abx=c.bx-c.ax,aby=c.by-c.ay,abz=c.bz-c.az,apx=x-c.ax,apy=y-c.ay,apz=z-c.az;
  const t=clamp((apx*abx+apy*aby+apz*abz)/(abx*abx+aby*aby+abz*abz||1),0,1);
  return Math.hypot(apx-abx*t,apy-aby*t,apz-abz*t)-c.radius;
}

/** Signed-density terrain with smooth SDF unions, 3D domain warping and Surface Nets extraction. */
export function generateDensityWorld(recipe:TerrainRecipe,resolution:DensityResolution={width:96,height:56,depth:96}):DensityWorld{
  const base=generateTerrain(recipe).heightfield,{width,height,depth}=resolution;
  if(![width,height,depth].every(n=>Number.isInteger(n)&&n>=12&&n<=192))throw new Error("Density grid dimensions must be integers from 12 to 192");
  const bounds=recipe.bounds??DEFAULT_WORLD_BOUNDS,origin={x:bounds.minX,y:-0.055,z:bounds.minZ},maxY=0.92;
  const voxelSize={x:(bounds.maxX-bounds.minX)/(width-1),y:(maxY-origin.y)/(height-1),z:(bounds.maxZ-bounds.minZ)/(depth-1)};
  const values=new Float32Array(width*height*depth);
  const plane=new Float32Array(width*depth);
  for(let z=0;z<depth;z++)for(let x=0;x<width;x++){
    const wx=origin.x+x*voxelSize.x,wz=origin.z+z*voxelSize.z;
    plane[z*width+x]=sampleElevation(base,wx,wz)*1.18;
  }
  const index=(x:number,y:number,z:number)=>x+width*(y+height*z);
  let occupiedSamples=0;
  for(let z=0;z<depth;z++){
    const wz=origin.z+z*voxelSize.z;
    for(let y=0;y<height;y++){
      const wy=origin.y+y*voxelSize.y;
      for(let x=0;x<width;x++){
        const wx=origin.x+x*voxelSize.x,baseHeight=plane[z*width+x];
        const baseDensity=baseHeight-wy;
        let erosion=0;
        // High-frequency 3D weathering is evaluated only in a narrow band
        // around the zero surface; deep solid and empty samples need no detail.
        if(Math.abs(baseDensity)<0.085&&rockMask>0.02){
          const warpX=fbm3(wx*7.5,wy*8.5,wz*7.5,recipe.seed+71,2)*0.025;
          const warpY=fbm3(wx*7.5+13,wy*8.5,wz*7.5-9,recipe.seed+97,2)*0.012;
          const warpZ=fbm3(wx*7.5-7,wy*8.5+5,wz*7.5+11,recipe.seed+131,2)*0.025;
          const qx=wx+warpX,qy=wy+warpY,qz=wz+warpZ;
          const broadNoise=fbm3(qx*12,qy*16,qz*12,recipe.seed+211,3);
          const cellular=worley3(qx*27+3,qy*31-5,qz*27+9,recipe.seed+307);
          const fineCell=worley3(qx*54-7,qy*61+2,qz*54+4,recipe.seed+401);
          erosion=(0.0045*(0.5-cellular)+0.0018*(0.5-fineCell)+broadNoise*0.004)*rockMask;
        }
        let density=baseDensity+erosion;
        if(x===0||z===0||x===width-1||z===depth-1||y===0||y===height-1)density=-0.08;
        const value=Math.fround(density);values[index(x,y,z)]=value;if(value>0)occupiedSamples++;
      }
    }
  }
  const volume:DensityVolume={width,height,depth,origin,voxelSize,values};
  return assembleDensityWorld(volume,occupiedSamples);
}

/** Builds the shared heightfield and three geometric LODs from one authoritative density volume. */
export function assembleDensityWorld(volume:DensityVolume,occupiedSamples?:number):DensityWorld{
  const {width,height,depth,origin,voxelSize,values}=volume;
  const heightValues=new Float32Array(width*depth);
  let occupied=0;
  for(let i=0;i<values.length;i++)if(values[i]>0)occupied++;
  for(let z=0;z<depth;z++)for(let x=0;x<width;x++){
    let top=0;
    for(let y=height-2;y>=0;y--){
      const upper=values[x+width*((y+1)+height*z)],lower=values[x+width*(y+height*z)];
      if(upper<=0&&lower>0){const t=lower/(lower-upper);top=origin.y+(y+t)*voxelSize.y;break;}
    }
    heightValues[z*width+x]=top;
  }
  const bounds={minX:origin.x,maxX:origin.x+(width-1)*voxelSize.x,minZ:origin.z,maxZ:origin.z+(depth-1)*voxelSize.z};
  const heightfield=createHeightfield(width,depth,heightValues,bounds);
  const high=buildSurfaceNets(volume),medium=buildSurfaceNets(downsampleVolume(volume,2)),low=buildSurfaceNets(downsampleVolume(volume,4));
  const mesh:VolumeMesh={...high,lods:[high,medium,low]};
  return{heightfield,volume,mesh,diagnostics:{samples:values.length,vertices:high.vertexCount,triangles:high.triangleCount,occupiedSamples:occupiedSamples??occupied}};
}

function downsampleVolume(source:DensityVolume,factor:number):DensityVolume{
  const width=Math.max(2,Math.floor((source.width-1)/factor)+1);
  const height=Math.max(2,Math.floor((source.height-1)/factor)+1);
  const depth=Math.max(2,Math.floor((source.depth-1)/factor)+1);
  const values=new Float32Array(width*height*depth);
  const at=(x:number,y:number,z:number)=>source.values[x+source.width*(y+source.height*z)];
  for(let z=0;z<depth;z++)for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const sx=x/(width-1)*(source.width-1),sy=y/(height-1)*(source.height-1),sz=z/(depth-1)*(source.depth-1);
    const x0=Math.floor(sx),y0=Math.floor(sy),z0=Math.floor(sz);
    const x1=Math.min(source.width-1,x0+1),y1=Math.min(source.height-1,y0+1),z1=Math.min(source.depth-1,z0+1);
    const tx=sx-x0,ty=sy-y0,tz=sz-z0;
    const a=mix(mix(at(x0,y0,z0),at(x1,y0,z0),tx),mix(at(x0,y1,z0),at(x1,y1,z0),tx),ty);
    const b=mix(mix(at(x0,y0,z1),at(x1,y0,z1),tx),mix(at(x0,y1,z1),at(x1,y1,z1),tx),ty);
    values[x+width*(y+height*z)]=mix(a,b,tz);
  }
  return{width,height,depth,origin:source.origin,voxelSize:{
    x:(source.width-1)*source.voxelSize.x/(width-1),
    y:(source.height-1)*source.voxelSize.y/(height-1),
    z:(source.depth-1)*source.voxelSize.z/(depth-1),
  },values};
}

export function buildSurfaceNets(volume:DensityVolume):VolumeMeshLod{
  const{width:nx,height:ny,depth:nz,values:D,origin,voxelSize}=volume,slice=nx*ny;
  const positions:number[]=[],indices:number[]=[];
  let current=new Int32Array(slice),previous=new Int32Array(slice);
  const world=(x:number,y:number,z:number)=>[origin.x+x*voxelSize.x,origin.y+y*voxelSize.y,origin.z+z*voxelSize.z];
  for(let z=0;z<nz-1;z++){
    current.fill(-1);
    for(let y=0;y<ny-1;y++){
      const row=nx*y;
      for(let x=0;x<nx-1;x++){
        const i=row+x+slice*z,d0=D[i],d1=D[i+1],d2=D[i+nx],d3=D[i+nx+1],d4=D[i+slice],d5=D[i+slice+1],d6=D[i+slice+nx],d7=D[i+slice+nx+1];
        const sign=d0>0,mask=(d0>0?1:0)|((d1>0?1:0)<<1)|((d2>0?1:0)<<2)|((d3>0?1:0)<<3)|((d4>0?1:0)<<4)|((d5>0?1:0)<<5)|((d6>0?1:0)<<6)|((d7>0?1:0)<<7);
        if(mask===0||mask===255)continue;
        let sx=0,sy=0,sz=0,count=0;
        const edge=(a:number,b:number,ox:number,oy:number,oz:number)=>{if((a>0)===(b>0))return;const t=a/(a-b);sx+=ox+t;sy+=oy;sz+=oz;count++;};
        edge(d0,d1,0,0,0);edge(d2,d3,0,1,0);edge(d4,d5,0,0,1);edge(d6,d7,0,1,1);
        edge(d0,d2,0,0,0);edge(d1,d3,1,0,0);edge(d4,d6,0,0,1);edge(d5,d7,1,0,1);
        edge(d0,d4,0,0,0);edge(d1,d5,1,0,0);edge(d2,d6,0,1,0);edge(d3,d7,1,1,0);
        const vertex=positions.length/3;positions.push(...world(x+sx/count,y+sy/count,z+sz/count));
        const ci=row+x;current[ci]=vertex;
        if((d1>0)!==sign&&y>0&&z>0){
          const a=vertex,b=current[ci-nx],c=previous[ci-nx],d=previous[ci];
          if(a>=0&&b>=0&&c>=0&&d>=0){if(sign)indices.push(a,b,c,a,c,d);else indices.push(a,c,b,a,d,c);}
        }
        if((d2>0)!==sign&&x>0&&z>0){
          const a=vertex,b=previous[ci],c=previous[ci-1],d=current[ci-1];
          if(a>=0&&b>=0&&c>=0&&d>=0){if(sign)indices.push(a,b,c,a,c,d);else indices.push(a,c,b,a,d,c);}
        }
        if((d4>0)!==sign&&x>0&&y>0){
          const a=vertex,b=current[ci-1],c=current[ci-1-nx],d=current[ci-nx];
          if(a>=0&&b>=0&&c>=0&&d>=0){if(sign)indices.push(a,b,c,a,c,d);else indices.push(a,c,b,a,d,c);}
        }
      }
    }
    const swap=current;current=previous;previous=swap;
  }
  const pos=new Float32Array(positions),normals=new Float32Array(pos.length);
  const sample=(x:number,y:number,z:number):number=>{
    const px=clamp(x,0,nx-1.001),py=clamp(y,0,ny-1.001),pz=clamp(z,0,nz-1.001);
    const ix=Math.floor(px),iy=Math.floor(py),iz=Math.floor(pz),fx=px-ix,fy=py-iy,fz=pz-iz;
    const at=(xx:number,yy:number,zz:number)=>D[xx+nx*(yy+ny*zz)];
    const a=mix(mix(at(ix,iy,iz),at(ix+1,iy,iz),fx),mix(at(ix,iy+1,iz),at(ix+1,iy+1,iz),fx),fy);
    const b=mix(mix(at(ix,iy,iz+1),at(ix+1,iy,iz+1),fx),mix(at(ix,iy+1,iz+1),at(ix+1,iy+1,iz+1),fx),fy);
    return mix(a,b,fz);
  };
  for(let i=0;i<pos.length;i+=3){
    const gx=(pos[i]-origin.x)/voxelSize.x,gy=(pos[i+1]-origin.y)/voxelSize.y,gz=(pos[i+2]-origin.z)/voxelSize.z;
    const dx=(sample(gx-0.5,gy,gz)-sample(gx+0.5,gy,gz))/voxelSize.x;
    const dy=(sample(gx,gy-0.5,gz)-sample(gx,gy+0.5,gz))/voxelSize.y;
    const dz=(sample(gx,gy,gz-0.5)-sample(gx,gy,gz+0.5))/voxelSize.z,length=Math.hypot(dx,dy,dz)||1;
    normals[i]=dx/length;normals[i+1]=dy/length;normals[i+2]=dz/length;
  }
  const chunkColumns=8,chunkRows=8,buckets=Array.from({length:chunkColumns*chunkRows},()=>[] as number[]);
  for(let i=0;i<indices.length;i+=3){
    const a=indices[i],b=indices[i+1],d=indices[i+2];
    const cx=(pos[a*3]+pos[b*3]+pos[d*3])/3,cz=(pos[a*3+2]+pos[b*3+2]+pos[d*3+2])/3;
    const gx=clamp(Math.floor((cx-origin.x)/((nx-1)*voxelSize.x)*chunkColumns),0,chunkColumns-1);
    const gz=clamp(Math.floor((cz-origin.z)/((nz-1)*voxelSize.z)*chunkRows),0,chunkRows-1);
    buckets[gz*chunkColumns+gx].push(a,b,d);
  }
  const ordered:number[]=[],chunks:VolumeMeshChunk[]=[];
  for(let z=0;z<chunkRows;z++)for(let x=0;x<chunkColumns;x++){
    const bucket=buckets[z*chunkColumns+x];if(bucket.length===0)continue;
    const startIndex=ordered.length;ordered.push(...bucket);
    chunks.push({
      startIndex,indexCount:bucket.length,
      centerX:origin.x+(x+0.5)*(nx-1)*voxelSize.x/chunkColumns,
      centerZ:origin.z+(z+0.5)*(nz-1)*voxelSize.z/chunkRows,
    });
  }
  const orderedIndices=new Uint32Array(ordered);
  return{positions:pos,normals,indices:orderedIndices,vertexCount:pos.length/3,triangleCount:orderedIndices.length/3,chunks};
}
