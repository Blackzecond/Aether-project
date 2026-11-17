import { sampleSurface, type Heightfield } from "../fields/heightfield";
import type { RiverNetwork } from "../hydrology/rivers";

export interface VegetationInstance {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly height: number;
  readonly tint: number;
}
export interface GroundCoverInstance {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scale: number;
  readonly tint: number;
  /** 0 grass, 1 fern, 2 moss, 3 rock. */
  readonly kind: 0 | 1 | 2 | 3;
}
export interface VegetationField {
  readonly instances: readonly VegetationInstance[];
  readonly groundCover: readonly GroundCoverInstance[];
  readonly diagnostics: { readonly candidates: number; readonly trees: number; readonly groundCover: number };
}

function hash(seed: number, x: number, z: number): number {
  let value = Math.imul(seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263), 1274126177);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function smoothstep(edge0:number,edge1:number,value:number):number{
  const t=Math.max(0,Math.min(1,(value-edge0)/(edge1-edge0)));
  return t*t*(3-2*t);
}

/** Smooth, deterministic low-frequency field used to form coherent woodland patches. */
function woodlandNoise(seed:number,x:number,z:number):number{
  const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz;
  const sx=fx*fx*(3-2*fx),sz=fz*fz*(3-2*fz);
  const a=hash(seed,ix,iz),b=hash(seed,ix+1,iz);
  const c=hash(seed,ix,iz+1),d=hash(seed,ix+1,iz+1);
  const top=a+(b-a)*sx,bottom=c+(d-c)*sx;
  return top+(bottom-top)*sz;
}

/** Deterministic, terrain- and moisture-aware vegetation placement. 1 world unit = 1 km. */
export function generateVegetation(
  field: Heightfield,
  seed: number,
  rivers?: RiverNetwork,
): VegetationField {
  const instances: VegetationInstance[] = [];
  const groundCover: GroundCoverInstance[] = [];
  const waterInfluence = new Uint8Array(field.width * field.height);
  if (rivers) {
    for (const index of rivers.channelIndices) {
      const cx = index % field.width, cz = Math.floor(index / field.width);
      for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, z = cz + dz;
        if (x >= 0 && x < field.width && z >= 0 && z < field.height
          && dx * dx + dz * dz <= 16) waterInfluence[z * field.width + x] = 1;
      }
    }
  }

  const centerX = (field.bounds.minX + field.bounds.maxX) * 0.5;
  const centerZ = (field.bounds.minZ + field.bounds.maxZ) * 0.5;
  const spanX = field.bounds.maxX - field.bounds.minX;
  const spanZ = field.bounds.maxZ - field.bounds.minZ;
  const toWorld = (gx: number, gz: number) => ({
    x: field.bounds.minX + gx / (field.width - 1) * spanX,
    z: field.bounds.minZ + gz / (field.height - 1) * spanZ,
  });

  // Broad, softly blended woodland patches: dense forest cores, lighter edges and open clearings.
  const forestAt=(gx:number,gz:number)=>{
    const broad=woodlandNoise(seed+503,gx/11,gz/11);
    const medium=woodlandNoise(seed+509,gx/5.5,gz/5.5);
    return smoothstep(0.37,0.72,broad*0.76+medium*0.24);
  };

  for (let gz = 2; gz < field.height - 2; gz += 1) {
    for (let gx = 2; gx < field.width - 2; gx += 1) {
      const forest=forestAt(gx,gz);
      if(forest<0.08)continue;
      const jitterX=(hash(seed+31,gx,gz)-0.5)*0.9;
      const jitterZ=(hash(seed+47,gx,gz)-0.5)*0.9;
      const gridX=Math.max(1,Math.min(field.width-2,gx+jitterX));
      const gridZ=Math.max(1,Math.min(field.height-2,gz+jitterZ));
      const {x,z}=toWorld(gridX,gridZ);
      if(Math.hypot(x-centerX,z-centerZ)<0.014)continue;
      const surface=sampleSurface(field,x,z);
      if(surface.elevation<0.035||surface.elevation>0.92||surface.slope>0.72)continue;
      const nearWater=waterInfluence[Math.round(gridZ)*field.width+Math.round(gridX)]>0;
      const treeChance=(0.12+forest*0.76)*(nearWater?1.08:1);
      if(hash(seed+71,gx,gz)>treeChance)continue;
      instances.push({
        x,y:surface.elevation+0.00035,z,
        height:0.018+hash(seed+83,gx,gz)*0.016,
        tint:hash(seed+97,gx,gz),
      });
      if(instances.length>=3600)break;
    }
    if(instances.length>=3600)break;
  }

  // Grasses, ferns and moss grow in coherent ground layers; grass is common in clearings,
  // while shaded forest floors favour ferns and damp moss.
  for(let gz=2;gz<field.height-2;gz+=1){
    for(let gx=2;gx<field.width-2;gx+=1){
      const forest=forestAt(gx,gz);
      const jitterX=(hash(seed+131,gx,gz)-0.5)*0.9;
      const jitterZ=(hash(seed+149,gx,gz)-0.5)*0.9;
      const gridX=Math.max(1,Math.min(field.width-2,gx+jitterX));
      const gridZ=Math.max(1,Math.min(field.height-2,gz+jitterZ));
      const {x,z}=toWorld(gridX,gridZ);
      if(Math.hypot(x-centerX,z-centerZ)<0.014)continue;
      const surface=sampleSurface(field,x,z);
      if(surface.elevation<0.018||surface.elevation>0.96||surface.slope>1.05)continue;
      const nearWater=waterInfluence[Math.round(gridZ)*field.width+Math.round(gridX)]>0;
      const roll=hash(seed+167,gx,gz);
      const coverChance=0.34+forest*0.52+(nearWater?0.12:0);
      if(roll>coverChance)continue;

      let kind:GroundCoverInstance["kind"];
      if(surface.slope>0.72&&roll>0.42)kind=3;
      else if(nearWater&&roll<0.30)kind=2;
      else if(forest>0.42&&roll<0.58)kind=1;
      else if(roll<0.78)kind=0;
      else kind=forest>0.55?1:0;

      const scale=kind===3
        ?0.0018+hash(seed+181,gx,gz)*0.0028
        :kind===2
          ?0.0010+hash(seed+181,gx,gz)*0.0012
          :kind===1
            ?0.0018+hash(seed+181,gx,gz)*0.0015
            :0.00065+hash(seed+181,gx,gz)*0.00075;
      groundCover.push({
        x,y:surface.elevation+0.0002,z,scale,
        tint:hash(seed+193,gx,gz),kind,
      });
      if(groundCover.length>=14000)break;
    }
    if(groundCover.length>=14000)break;
  }

  return {
    instances,
    groundCover,
    diagnostics: {
      candidates: (field.width - 4) * (field.height - 4),
      trees: instances.length,
      groundCover: groundCover.length,
    },
  };
}
