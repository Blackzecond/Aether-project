import { sampleSurface, type Heightfield } from "../fields/heightfield";
import type { RiverNetwork } from "../hydrology/rivers";

export type TreeSpecies=0|1|2;
export interface VegetationInstance {
  readonly x:number; readonly y:number; readonly z:number;
  readonly height:number; readonly tint:number; readonly species:TreeSpecies;
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

/** Multi-scale forest stands, spacing competition and a separate meadow/understory layer. */
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
    const broad=woodlandNoise(seed+503,gx/27,gz/27);
    const medium=woodlandNoise(seed+509,gx/10,gz/10);
    const clearing=woodlandNoise(seed+521,gx/4.2,gz/4.2);
    return smoothstep(0.37,0.65,broad*0.64+medium*0.25+clearing*0.11);
  };

  // One candidate per heightfield cell; local competition creates a denser
  // stand while retaining small clearings and irregular forest boundaries.
  const cellSize=0.0045;
  const occupied=new Map<string,Array<{x:number;z:number}>>();
  for(let gz=3;gz<field.height-3;gz++)for(let gx=3;gx<field.width-3;gx++){
    const forest=forestAt(gx,gz);
    if(forest<0.10||hash(seed+601,gx,gz)>0.12+forest*0.84)continue;
    const jx=(hash(seed+31,gx,gz)-0.5)*0.92,jz=(hash(seed+47,gx,gz)-0.5)*0.92;
    const sx=Math.max(1,Math.min(field.width-2,gx+jx)),sz=Math.max(1,Math.min(field.height-2,gz+jz));
    const {x,z}=toWorld(sx,sz),surface=sampleSurface(field,x,z);
    if(surface.elevation<0.028||surface.elevation>0.88||surface.slope>0.78)continue;
    if(water[Math.round(sz)*field.width+Math.round(sx)]!==0)continue;
    const bx=Math.floor(x/cellSize),bz=Math.floor(z/cellSize);
    let crowded=false;
    for(let dz=-2;dz<=2&&!crowded;dz++)for(let dx=-2;dx<=2&&!crowded;dx++){
      for(const other of occupied.get((bx+dx)+":"+(bz+dz))??[]){
        const minDistance=0.0042+hash(seed+619,gx,gz)*0.0028;
        if((x-other.x)**2+(z-other.z)**2<minDistance*minDistance){crowded=true;break;}
      }
    }
    if(crowded)continue;
    const key=bx+":"+bz,group=occupied.get(key)??[];group.push({x,z});occupied.set(key,group);
    const variety=hash(seed+239,gx,gz);
    const species:TreeSpecies=surface.elevation>0.52
      ?(variety<0.78?1:2)
      :(variety<0.58?0:variety<0.84?1:2);
    trees.push({
      x,y:surface.elevation+0.0002,z,
      height:0.020+hash(seed+83,gx,gz)*0.024,
      tint:hash(seed+97,gx,gz),
      species,
    });
  }

  // Sub-cell sampling plus reservoir sampling prevents scan-order bias.
  // Continuous grass colour/texture is supplied by the terrain shader;
  // these instances add readable blades and understory in close views.
  const coverLimit=40000;
  let coverCandidates=0;
  for(let gz=2;gz<field.height-2;gz+=0.42)for(let gx=2;gx<field.width-2;gx+=0.42){
    const forest=forestAt(gx,gz),meadow=1-forest;
    const jx=(hash(seed+131,Math.floor(gx*10),Math.floor(gz*10))-0.5)*0.72;
    const jz=(hash(seed+149,Math.floor(gx*10),Math.floor(gz*10))-0.5)*0.72;
    const sx=Math.max(1,Math.min(field.width-2,gx+jx)),sz=Math.max(1,Math.min(field.height-2,gz+jz));
    const {x,z}=toWorld(sx,sz);
    const surface=sampleSurface(field,x,z);
    if(surface.elevation<0.018||surface.elevation>0.94||surface.slope>1.0)continue;
    const nearWater=water[Math.round(sz)*field.width+Math.round(sx)]!==0;
    const roll=hash(seed+167,Math.floor(gx*10),Math.floor(gz*10));
    const chance=0.18+meadow*0.26+forest*0.30+(nearWater?0.14:0);
    if(roll>chance)continue;
    let kind:GroundCoverInstance["kind"];
    if(surface.slope>0.72&&roll>0.46)kind=3;
    else if(nearWater&&roll<0.30)kind=2;
    else if(forest>0.48&&roll<0.66)kind=1;
    else kind=0;
    const scale=kind===3?0.0020+hash(seed+181,Math.floor(gx*10),Math.floor(gz*10))*0.0018
      :kind===2?0.0022+hash(seed+181,Math.floor(gx*10),Math.floor(gz*10))*0.0018
      :kind===1?0.0022+hash(seed+181,Math.floor(gx*10),Math.floor(gz*10))*0.0018
      :0.0018+hash(seed+181,Math.floor(gx*10),Math.floor(gz*10))*0.0015;
    const item={x,y:surface.elevation+0.00012,z,scale,tint:hash(seed+193,Math.floor(gx*10),Math.floor(gz*10)),kind};
    coverCandidates++;
    if(groundCover.length<coverLimit)groundCover.push(item);
    else{
      const replacement=Math.floor(hash(seed+227,coverCandidates,0)*coverCandidates);
      if(replacement<coverLimit)groundCover[replacement]=item;
    }
  }
  return{instances:trees,groundCover,diagnostics:{
    candidates:(field.width-6)*(field.height-6),trees:trees.length,groundCover:groundCover.length,
  }};
}
