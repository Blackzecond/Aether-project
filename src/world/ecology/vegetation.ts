import { sampleSurface, type Heightfield } from "../fields/heightfield";
import type { RiverNetwork } from "../hydrology/rivers";

export interface VegetationInstance {
  readonly x:number; readonly y:number; readonly z:number;
  readonly height:number; readonly tint:number;
}
export interface GroundCoverInstance {
  readonly x:number; readonly y:number; readonly z:number;
  readonly scale:number; readonly tint:number;
  /** 0 grass, 1 fern, 2 moss, 3 rock. */
  readonly kind:0|1|2|3;
}
export interface VegetationField {
  readonly instances:readonly VegetationInstance[];
  readonly groundCover:readonly GroundCoverInstance[];
  readonly diagnostics:{readonly candidates:number;readonly trees:number;readonly groundCover:number};
}
function hash(seed:number,x:number,z:number):number{
  let value=Math.imul(seed^Math.imul(x,374761393)^Math.imul(z,668265263),1274126177);
  value=Math.imul(value^(value>>>13),1274126177);
  return((value^(value>>>16))>>>0)/4294967296;
}
function smoothstep(a:number,b:number,v:number):number{
  const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);
}
function woodlandNoise(seed:number,x:number,z:number):number{
  const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz;
  const sx=fx*fx*(3-2*fx),sz=fz*fz*(3-2*fz);
  const a=hash(seed,ix,iz),b=hash(seed,ix+1,iz);
  const c=hash(seed,ix,iz+1),d=hash(seed,ix+1,iz+1);
  return(a+(b-a)*sx)*(1-sz)+(c+(d-c)*sx)*sz;
}

/**
 * Forest stands use clustered habitat masks and local spacing competition.
 * Ground layers are sampled independently so clearings remain visibly open.
 */
export function generateVegetation(field:Heightfield,seed:number,rivers?:RiverNetwork):VegetationField{
  const trees:VegetationInstance[]=[],groundCover:GroundCoverInstance[]=[];
  const water=new Uint8Array(field.width*field.height);
  if(rivers)for(const index of rivers.channelIndices){
    const cx=index%field.width,cz=Math.floor(index/field.width);
    for(let dz=-4;dz<=4;dz++)for(let dx=-4;dx<=4;dx++){
      const x=cx+dx,z=cz+dz;
      if(x>=0&&x<field.width&&z>=0&&z<field.height&&dx*dx+dz*dz<=16)water[z*field.width+x]=1;
    }
  }
  const spanX=field.bounds.maxX-field.bounds.minX,spanZ=field.bounds.maxZ-field.bounds.minZ;
  const toWorld=(gx:number,gz:number)=>({
    x:field.bounds.minX+gx/(field.width-1)*spanX,
    z:field.bounds.minZ+gz/(field.height-1)*spanZ,
  });
  const forestAt=(gx:number,gz:number)=>{
    const broad=woodlandNoise(seed+503,gx/19,gz/19);
    const medium=woodlandNoise(seed+509,gx/8,gz/8);
    const clearing=woodlandNoise(seed+521,gx/3.8,gz/3.8);
    return smoothstep(0.43,0.70,broad*0.60+medium*0.27+clearing*0.13);
  };

  // Candidate spacing is about 16–24 m, followed by a small Poisson-like
  // rejection pass. This avoids the old 8 m grid that made crowns overlap.
  const cellSize=0.0125;
  const occupied=new Map<string,Array<{x:number;z:number}>>();
  for(let gz=3;gz<field.height-3;gz+=2)for(let gx=3;gx<field.width-3;gx+=2){
    const forest=forestAt(gx,gz);
    if(forest<0.14||hash(seed+601,gx,gz)>0.18+forest*0.68)continue;
    const jx=(hash(seed+31,gx,gz)-0.5)*1.55,jz=(hash(seed+47,gx,gz)-0.5)*1.55;
    const sx=Math.max(1,Math.min(field.width-2,gx+jx)),sz=Math.max(1,Math.min(field.height-2,gz+jz));
    const {x,z}=toWorld(sx,sz),surface=sampleSurface(field,x,z);
    if(surface.elevation<0.035||surface.elevation>0.92||surface.slope>0.70)continue;
    if(water[Math.round(sz)*field.width+Math.round(sx)]!==0)continue;
    const bx=Math.floor(x/cellSize),bz=Math.floor(z/cellSize);
    let crowded=false;
    for(let dz=-1;dz<=1&&!crowded;dz++)for(let dx=-1;dx<=1&&!crowded;dx++){
      for(const other of occupied.get((bx+dx)+":"+(bz+dz))??[]){
        const minDistance=0.009+hash(seed+619,gx,gz)*0.004;
        if((x-other.x)**2+(z-other.z)**2<minDistance*minDistance){crowded=true;break;}
      }
    }
    if(crowded)continue;
    const key=bx+":"+bz,group=occupied.get(key)??[];group.push({x,z});occupied.set(key,group);
    trees.push({
      x,y:surface.elevation+0.0002,z,
      height:0.024+hash(seed+83,gx,gz)*0.018,
      tint:hash(seed+97,gx,gz),
    });
    if(trees.length>=2600)break;
  }

  // Dense but low ground cover: grass dominates open meadows, ferns the
  // shaded understory, and moss the damp margins. The water corridor stays clear.
  for(let gz=2;gz<field.height-2;gz++)for(let gx=2;gx<field.width-2;gx++){
    const forest=forestAt(gx,gz);
    const jx=(hash(seed+131,gx,gz)-0.5)*0.85,jz=(hash(seed+149,gx,gz)-0.5)*0.85;
    const sx=Math.max(1,Math.min(field.width-2,gx+jx)),sz=Math.max(1,Math.min(field.height-2,gz+jz));
    const {x,z}=toWorld(sx,sz);
    const surface=sampleSurface(field,x,z);
    if(surface.elevation<0.018||surface.elevation>0.96||surface.slope>1.05)continue;
    const nearWater=water[Math.round(sz)*field.width+Math.round(sx)]!==0;
    const roll=hash(seed+167,gx,gz),chance=0.16+forest*0.60+(nearWater?0.12:0);
    if(roll>chance)continue;
    let kind:GroundCoverInstance["kind"];
    if(surface.slope>0.72&&roll>0.42)kind=3;
    else if(nearWater&&roll<0.34)kind=2;
    else if(forest>0.46&&roll<0.64)kind=1;
    else kind=0;
    const scale=kind===3?0.0018+hash(seed+181,gx,gz)*0.0028
      :kind===2?0.0010+hash(seed+181,gx,gz)*0.0012
      :kind===1?0.0018+hash(seed+181,gx,gz)*0.0015
      :0.0008+hash(seed+181,gx,gz)*0.0008;
    groundCover.push({x,y:surface.elevation+0.00012,z,scale,tint:hash(seed+193,gx,gz),kind});
    if(groundCover.length>=18000)break;
  }
  return{instances:trees,groundCover,diagnostics:{
    candidates:(field.width-6)*(field.height-6),trees:trees.length,groundCover:groundCover.length,
  }};
}
