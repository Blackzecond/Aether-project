export type TreeGeometryDetail = "high" | "medium" | "low";

type Vec3 = [number, number, number];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0]*s,a[1]*s,a[2]*s];
const dot = (a: Vec3,b: Vec3): number => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross = (a: Vec3,b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const length = (a: Vec3): number => Math.hypot(a[0],a[1],a[2]);
const unit = (a: Vec3): Vec3 => { const l=length(a)||1; return mul(a,1/l); };

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Broadleaf tree prototype: curved, tapered branching hierarchy with individually
 * cut-out leaf cards. Vertex layout is position(3), normal(3), UV(2), part(1).
 */
export function buildProceduralTreeGeometry(detail: TreeGeometryDetail = "high"): Float32Array {
  const vertices: number[] = [];
  const rand = random(0xA37E2);
  const pushVertex = (p: Vec3, n: Vec3, u: number, v: number, part: number) => {
    vertices.push(p[0],p[1],p[2],n[0],n[1],n[2],u,v,part);
  };
  const triangle = (a: Vec3,na: Vec3,ua: number,va: number,
                    b: Vec3,nb: Vec3,ub: number,vb: number,
                    c: Vec3,nc: Vec3,uc: number,vc: number,part: number) => {
    pushVertex(a,na,ua,va,part);pushVertex(b,nb,ub,vb,part);pushVertex(c,nc,uc,vc,part);
  };

  const addCurvedBranch = (start: Vec3,end: Vec3,radiusStart: number,radiusEnd: number,
                           bend: Vec3,segments: number,radialSegments: number) => {
    const direction=sub(end,start);
    const c1=add(add(start,mul(direction,0.34)),bend);
    const c2=add(add(start,mul(direction,0.72)),mul(bend,0.34));
    const point=(t:number):Vec3=>{
      const s=1-t;
      return add(add(mul(start,s*s*s),mul(c1,3*s*s*t)),add(mul(c2,3*s*t*t),mul(end,t*t*t)));
    };
    const rings: {p:Vec3;n:Vec3}[][]=[];
    for(let i=0;i<=segments;i++){
      const t=i/segments,center=point(t),tangent=unit(sub(point(Math.min(1,t+0.006)),point(Math.max(0,t-0.006))));
      const reference:Vec3=Math.abs(dot(tangent,[0,1,0]))>0.92?[1,0,0]:[0,1,0];
      const side=unit(cross(tangent,reference)),up=unit(cross(side,tangent));
      const radius=radiusStart+(radiusEnd-radiusStart)*t;
      const ring:{p:Vec3;n:Vec3}[]=[];
      for(let j=0;j<=radialSegments;j++){
        const angle=j/radialSegments*Math.PI*2;
        const normal=unit(add(mul(side,Math.cos(angle)),mul(up,Math.sin(angle))));
        ring.push({p:add(center,mul(normal,radius)),n:normal});
      }
      rings.push(ring);
    }
    for(let i=0;i<segments;i++)for(let j=0;j<radialSegments;j++){
      const a=rings[i][j],b=rings[i+1][j],c=rings[i+1][j+1],d=rings[i][j+1];
      triangle(a.p,a.n,0,0,b.p,b.n,0,1,c.p,c.n,1,1,0);
      triangle(a.p,a.n,0,0,c.p,c.n,1,1,d.p,d.n,1,0,0);
    }
  };

  const addLeaf = (center:Vec3,direction:Vec3,size:number,roll:number) => {
    const axis=unit(direction);
    const reference:Vec3=Math.abs(axis[1])>0.88?[1,0,0]:[0,1,0];
    let side=unit(cross(axis,reference));
    const c=Math.cos(roll),s=Math.sin(roll);
    side=unit(add(mul(side,c),mul(cross(axis,side),s)));
    const normal=unit(cross(side,axis));
    const length=size*(0.88+rand()*0.28),width=size*(0.34+rand()*0.12);
    const base=add(center,mul(axis,-length*0.42));
    const tip=add(center,mul(axis,length*0.58));
    const leftBase=add(base,mul(side,width*0.12)),rightBase=add(base,mul(side,-width*0.12));
    const leftTip=add(tip,mul(side,width*0.02)),rightTip=add(tip,mul(side,-width*0.02));
    const leftMid=add(add(center,mul(side,width)),mul(normal,size*0.10));
    const rightMid=add(add(center,mul(side,-width)),mul(normal,size*0.10));
    triangle(leftBase,normal,-0.10,0,rightBase,normal,0.10,0,leftMid,normal,-1,0.52,1);
    triangle(rightBase,normal,0.10,0,rightMid,normal,1,0.52,leftMid,normal,-1,0.52,1);
    const back=mul(normal,-1);
    triangle(leftMid,back,-1,0.52,rightMid,back,1,0.52,leftTip,back,0.10,1,1);
    triangle(leftMid,back,-1,0.52,leftTip,back,-0.10,1,rightTip,back,0.10,1,1);
  };

  const high=detail==="high",medium=detail==="medium";
  const primaryCount=high?7:medium?7:6;
  const secondaryPerPrimary=high?3:medium?2:1;
  const twigPerSecondary=high?2:medium?1:1;
  const leafCount=high?150:medium?72:28;
  const branchRadial=high?5:4;
  const branchSegments=high?3:2;

  // A subtly leaning trunk with a broad, grounded root flare.
  addCurvedBranch([0,0,0],[0.012,1,0.006],0.068,0.006,[0.014,0,0.008],12,9);
  for(let i=0;i<5;i++){
    const a=i/5*Math.PI*2+0.3;
    const dir:[number,number,number]=[Math.cos(a),0.10,Math.sin(a)];
    addCurvedBranch([0,0.045,0],mul(dir,0.23),0.032,0.002,mul([Math.cos(a+0.7),0,Math.sin(a+0.7)],0.018),4,6);
  }

  const leafSites: {p:Vec3;d:Vec3;weight:number}[]=[];
  for(let i=0;i<primaryCount;i++){
    const angle=i/primaryCount*Math.PI*2+rand()*0.22;
    const y=0.30+(i%4)*0.145+rand()*0.045;
    const crownProfile=Math.sqrt(Math.max(0.12,1-Math.pow((y-0.61)/0.50,2)));
    const branchLength=(0.27+rand()*0.12)*crownProfile;
    const start:Vec3=[Math.sin(y*8)*0.008,y,Math.cos(y*6)*0.008];
    const end:Vec3=[start[0]+Math.cos(angle)*branchLength,start[1]+0.12+rand()*0.10,start[2]+Math.sin(angle)*branchLength];
    const bend:Vec3=[Math.cos(angle+0.9)*(0.025+rand()*0.025),0.035,Math.sin(angle+0.9)*(0.025+rand()*0.025)];
    addCurvedBranch(start,end,0.022,0.003,bend,branchSegments,branchRadial);
    for(let s=0;s<secondaryPerPrimary;s++){
      const t=0.30+s/(Math.max(1,secondaryPerPrimary-1))*0.54;
      const origin:Vec3=[start[0]+(end[0]-start[0])*t,start[1]+(end[1]-start[1])*t,start[2]+(end[2]-start[2])*t];
      for(let sideIndex=0;sideIndex<2;sideIndex++){
        const sideAngle=angle+(sideIndex===0?-1:1)*(0.58+rand()*0.32);
        const secondaryLength=branchLength*(0.36+rand()*0.16)*(1-t*0.22);
        const secondaryEnd:Vec3=[origin[0]+Math.cos(sideAngle)*secondaryLength,origin[1]+secondaryLength*(0.42+rand()*0.24),origin[2]+Math.sin(sideAngle)*secondaryLength];
        addCurvedBranch(origin,secondaryEnd,0.0075,0.0012,mul([Math.cos(sideAngle+0.6),0.25,Math.sin(sideAngle+0.6)],0.018),branchSegments,branchRadial);
        for(let twig=0;twig<twigPerSecondary;twig++){
          const twigT=0.28+twig/(Math.max(1,twigPerSecondary-1))*0.58;
          const twigStart:Vec3=[origin[0]+(secondaryEnd[0]-origin[0])*twigT,origin[1]+(secondaryEnd[1]-origin[1])*twigT,origin[2]+(secondaryEnd[2]-origin[2])*twigT];
          const twigAngle=sideAngle+(twig%2===0?-0.8:0.8)+(rand()-0.5)*0.35;
          const twigLength=secondaryLength*(0.30+rand()*0.16);
          const twigEnd:Vec3=[twigStart[0]+Math.cos(twigAngle)*twigLength,twigStart[1]+twigLength*(0.42+rand()*0.35),twigStart[2]+Math.sin(twigAngle)*twigLength];
          addCurvedBranch(twigStart,twigEnd,0.0028,0.00055,mul([Math.cos(twigAngle+0.4),0.18,Math.sin(twigAngle+0.4)],0.008),branchSegments,5);
          leafSites.push({p:twigEnd,d:unit([Math.cos(twigAngle)*0.45,0.85,Math.sin(twigAngle)*0.45]),weight:1});
          leafSites.push({p:twigStart,d:unit([Math.cos(twigAngle),0.55,Math.sin(twigAngle)]),weight:0.8});
        }
        leafSites.push({p:secondaryEnd,d:unit([Math.cos(sideAngle)*0.4,0.9,Math.sin(sideAngle)*0.4]),weight:1});
      }
    }
    leafSites.push({p:end,d:unit([Math.cos(angle)*0.35,0.9,Math.sin(angle)*0.35]),weight:1.2});
  }

  // Leaf cards are distributed along the fine branch network, not only at branch tips.
  for(let i=0;i<leafCount;i++){
    const site=leafSites[Math.floor(rand()*leafSites.length)];
    const angle=rand()*Math.PI*2;
    const radial=Math.sqrt(rand())*(0.035+rand()*0.045);
    const center:Vec3=[
      site.p[0]+Math.cos(angle)*radial,
      site.p[1]+(rand()-0.28)*0.055,
      site.p[2]+Math.sin(angle)*radial,
    ];
    const direction:Vec3=[Math.cos(angle)*(0.35+rand()*0.45),0.55+rand()*0.8,Math.sin(angle)*(0.35+rand()*0.45)];
    addLeaf(center,direction,0.048+rand()*0.018,rand()*Math.PI*2);
  }

  return new Float32Array(vertices);
}
