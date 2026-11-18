import { buildHeightfieldMesh } from "../../world/mesh/heightfield-mesh";
import { sampleElevation, type Heightfield } from "../../world/fields/heightfield";
import type { DrainageField } from "../../world/hydrology/drainage";
import type { RiverNetwork } from "../../world/hydrology/rivers";
import type { GroundCoverInstance, VegetationInstance } from "../../world/ecology/vegetation";
import type { VolumeMesh, VolumeMeshChunk, VolumeMeshLod } from "../../world/volume/density-world";

export type TerrainViewMode = "world" | "first-person" | "shaded" | "elevation" | "slope" | "normals" | "wireframe" | "hydrology";

const waterVertexSource = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
uniform mat4 uMvp;
void main(){ gl_Position=uMvp*vec4(aPosition,1.0); }`;
const waterFragmentSource = `#version 300 es
precision highp float;
out vec4 outColor;
void main(){ outColor=vec4(0.055,0.34,0.43,0.94); }`;

const vertexSource = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in float aAccumulation;
layout(location=3) in float aChannel;
uniform mat4 uMvp;
uniform mat4 uModel;
out vec3 vNormal;
out vec3 vPosition;
out float vAccumulation;
out float vChannel;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vPosition = world.xyz;
  vNormal = mat3(uModel) * aNormal;
  vAccumulation = aAccumulation;
  vChannel = aChannel;
  gl_Position = uMvp * vec4(aPosition, 1.0);
}`;

const fragmentSource = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vPosition;
in float vAccumulation;
in float vChannel;
uniform int uMode;
uniform float uMaxAccumulation;
uniform vec3 uCameraPosition;
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise2(vec2 p) {
  vec2 i=floor(p),f=fract(p);
  f=f*f*(3.0-2.0*f);
  return mix(mix(hash21(i),hash21(i+vec2(1.0,0.0)),f.x),
             mix(hash21(i+vec2(0.0,1.0)),hash21(i+vec2(1.0,1.0)),f.x),f.y);
}
float fbm2(vec2 p) {
  float value=0.0,amplitude=0.5;
  for(int i=0;i<4;i++){value+=noise2(p)*amplitude;p=p*2.03+vec2(17.1,9.2);amplitude*=0.5;}
  return value;
}
vec3 terrainColor(float height, float slope) {
  vec3 valley = vec3(0.13, 0.22, 0.15);
  vec3 meadow = vec3(0.25, 0.39, 0.21);
  vec3 alpineGrass = vec3(0.34, 0.39, 0.24);
  vec3 earth = vec3(0.39, 0.29, 0.19);
  vec3 weatheredRock = vec3(0.39, 0.38, 0.33);
  vec3 paleStone = vec3(0.57, 0.54, 0.46);
  vec3 snow = vec3(0.82, 0.84, 0.78);
  vec3 color = mix(valley, meadow, smoothstep(0.035, 0.24, height));
  color = mix(color, alpineGrass, smoothstep(0.27, 0.48, height));
  color = mix(color, earth, smoothstep(0.46, 0.66, height));
  color = mix(color, weatheredRock, smoothstep(0.65, 0.84, height));
  color = mix(color, paleStone, smoothstep(0.82, 0.94, height));
  color = mix(color, snow, smoothstep(0.96, 1.08, height));
  float exposedRock = smoothstep(0.24, 0.68, slope);
  float highRock = smoothstep(0.58, 0.82, height);
  color = mix(color, weatheredRock, exposedRock * (0.48 + highRock * 0.30));
  float soilPatches = noise2(vec2(height * 17.0, vPosition.x * 23.0 + vPosition.z * 19.0));
  color = mix(color, earth * (0.88 + soilPatches * 0.22),
    (1.0 - exposedRock) * smoothstep(0.38, 0.70, height) * 0.42);
  return color;
}

void main() {
  vec3 n = normalize(vNormal);
  float height = clamp(vPosition.y / 0.92, 0.0, 1.0);
  float slope = 1.0 - clamp(n.y, 0.0, 1.0);
  vec3 color;

  if (uMode == 5) {
    float flow = clamp(log(1.0 + vAccumulation) / log(1.0 + max(uMaxAccumulation, 1.0)), 0.0, 1.0);
    color = mix(vec3(0.035, 0.10, 0.17), vec3(0.12, 0.58, 0.58), smoothstep(0.02, 0.48, flow));
    color = mix(color, vec3(0.91, 0.70, 0.31), smoothstep(0.48, 0.95, flow));
    color = mix(color, vec3(0.96, 0.88, 0.62), smoothstep(0.88, 1.0, flow));
    color = mix(color, vec3(0.96, 0.88, 0.55), vChannel * 0.96);
  } else if (uMode == 1) {
    color = mix(vec3(0.08,0.17,0.24), vec3(0.88,0.84,0.65), height);
  } else if (uMode == 2) {
    color = mix(vec3(0.12,0.36,0.25), vec3(0.91,0.43,0.22), smoothstep(0.04,0.78,slope));
  } else if (uMode == 3) {
    color = n * 0.5 + 0.5;
  } else {
    vec3 base = terrainColor(height, slope);
    vec2 texCoord = vPosition.xz;
    float grassSuitability=(1.0-smoothstep(0.30,0.58,height))*(1.0-smoothstep(0.12,0.52,slope))*smoothstep(0.018,0.10,height);
    float cameraDistance=length(vPosition-uCameraPosition);
    bool distant=cameraDistance>1.35;
    float meadowPatch=fbm2(texCoord*5.2+vec2(13.7,4.1));
    float meadowDetail=distant?meadowPatch:fbm2(texCoord*28.0+vec2(2.3,17.9));
    float grassGrain=distant?0.5:noise2(texCoord*260.0+vec2(meadowDetail*3.0,meadowPatch*2.0));
    vec3 meadowColor=mix(vec3(0.16,0.29,0.105),vec3(0.31,0.43,0.16),meadowPatch*0.72+meadowDetail*0.28);
    meadowColor*=0.91+grassGrain*0.16;
    float forestSuitability=(1.0-smoothstep(0.48,0.76,height))*(1.0-smoothstep(0.20,0.62,slope))*smoothstep(0.025,0.12,height);
    float forestNoise=fbm2(texCoord*6.8+vec2(31.7,12.1))*0.72+fbm2(texCoord*17.0+vec2(4.7,28.3))*0.28;
    float forestPatch=forestSuitability*smoothstep(0.43,0.66,forestNoise);
    vec3 forestColor=mix(vec3(0.075,0.17,0.085),vec3(0.16,0.27,0.12),meadowPatch*0.7+meadowDetail*0.3);
    base=mix(base,forestColor,forestPatch*0.62);
    float meadowCoverage=grassSuitability*(0.48+smoothstep(0.30,0.68,meadowPatch)*0.44)*(1.0-forestPatch*0.88);
    base=mix(base,meadowColor,meadowCoverage);
    float broadTexture=distant?noise2(texCoord*5.0):fbm2(texCoord*18.0);
    float stoneGrain=distant?0.5:fbm2(texCoord*74.0);
    float fineGrain=distant?0.5:noise2(texCoord*190.0);
    float rockExposure=smoothstep(0.34,0.68,slope);
    float striation=distant?0.5:1.0-abs(noise2(texCoord*31.0+vec2(height*7.0,height*3.0))*2.0-1.0);
    vec3 earthTint=vec3(0.78,0.76,0.65)*(0.82+broadTexture*0.32);
    vec3 rockTint=vec3(0.68,0.66,0.59)*(0.76+broadTexture*0.42);
    rockTint*=0.91+striation*0.12;
    base=mix(base*(0.88+broadTexture*0.24),earthTint,(1.0-rockExposure)*0.12);
    base=mix(base,rockTint,rockExposure*0.58);
    base*=0.94+stoneGrain*0.12+fineGrain*0.035;
    vec3 lightDirection = normalize(vec3(-0.55, 0.82, 0.42));
    vec3 viewDirection = normalize(uCameraPosition - vPosition);
    vec3 halfDirection = normalize(lightDirection + viewDirection);
    float diffuse = max(dot(n, lightDirection), 0.0);
    float skyFill = 0.34 + 0.16 * max(n.y, 0.0);
    float specular = pow(max(dot(n, halfDirection), 0.0), 28.0) * 0.10;
    float rim = pow(1.0 - max(dot(n, viewDirection), 0.0), 3.0) * 0.07;
    color = base * (skyFill + diffuse * 0.76) + vec3(specular) + vec3(0.35,0.48,0.42) * rim;
  }

  float distanceFog = smoothstep(2.0, 5.5, length(vPosition.xz));
  vec3 fog = vec3(0.10, 0.16, 0.145);
  if (uMode == 0) color = mix(color, fog, distanceFog * 0.24);
  outColor = vec4(color, 1.0);
}`;


const treeVertexSource = "#version 300 es\nprecision highp float;\nlayout(location=0) in vec3 aPosition;\nlayout(location=1) in vec3 aNormal;\nlayout(location=2) in vec3 iOffset;\nlayout(location=3) in float iScale;\nlayout(location=4) in float iTint;\nlayout(location=5) in float iSpecies;\nuniform mat4 uMvp;\nout vec3 vNormal;\nout float vHeight;\nout float vTint;\nout float vSpecies;\nvoid main(){float angle=iTint*6.2831853;mat2 rotation=mat2(cos(angle),-sin(angle),sin(angle),cos(angle));vec3 local=aPosition;vec3 normal=aNormal;float species=floor(iSpecies+0.5);float crown=0.82+fract(iTint*19.17)*0.34;float radialScale=1.0,verticalScale=1.0;if(species<0.5){radialScale=1.12+0.10*sin(aPosition.y*5.0);local.xz*=radialScale;}else if(species<1.5){radialScale=mix(1.28,0.48,smoothstep(0.20,1.0,aPosition.y));local.xz*=radialScale;}else{radialScale=0.72;verticalScale=1.16;local.xz*=radialScale;local.y*=verticalScale;}normal=normalize(vec3(normal.x/radialScale,normal.y/verticalScale,normal.z/radialScale));local*=iScale;local.xz=rotation*local.xz;normal.xz=rotation*normal.xz;local.xz*=crown;normal.xz/=crown;vec3 world=local+iOffset;vNormal=normal;vHeight=aPosition.y;vTint=iTint;vSpecies=iSpecies;gl_Position=uMvp*vec4(world,1.0);}";
const treeFragmentSource = "#version 300 es\nprecision highp float;\nin vec3 vNormal;in float vHeight;in float vTint;in float vSpecies;out vec4 outColor;\nvoid main(){vec3 n=normalize(vNormal);vec3 light=normalize(vec3(-0.45,0.82,0.36));float diffuse=max(dot(n,light),0.0);vec3 bark=mix(vec3(0.19,0.13,0.085),vec3(0.34,0.23,0.13),vTint*0.55);vec3 leaf;if(vSpecies<0.5)leaf=mix(vec3(0.055,0.20,0.085),vec3(0.24,0.43,0.18),vTint*0.72);else if(vSpecies<1.5)leaf=mix(vec3(0.045,0.16,0.12),vec3(0.16,0.34,0.23),vTint*0.72);else leaf=mix(vec3(0.18,0.20,0.08),vec3(0.43,0.43,0.16),vTint*0.72);vec3 color=vHeight<0.38?bark:leaf;color*=0.42+diffuse*0.72;outColor=vec4(color,1.0);}";
const groundVertexSource = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in float aKind;
layout(location=3) in vec3 iOffset;
layout(location=4) in float iScale;
layout(location=5) in float iTint;
layout(location=6) in float iKind;
uniform mat4 uMvp;
out vec3 vNormal;
out float vTint;
out float vKind;
void main(){
  vec3 world=aPosition*iScale+iOffset;
  vNormal=aNormal;vTint=iTint;vKind=iKind;gl_Position=uMvp*vec4(world,1.0);
}`;
const groundFragmentSource = `#version 300 es
precision highp float;
in vec3 vNormal;in float vTint;in float vKind;out vec4 outColor;
void main(){
  vec3 n=normalize(vNormal),light=normalize(vec3(-0.42,0.84,0.34));
  float diffuse=max(dot(n,light),0.0);vec3 base;
  if(vKind<0.5)base=mix(vec3(0.13,0.27,0.075),vec3(0.39,0.49,0.18),vTint);
  else if(vKind<1.5)base=mix(vec3(0.055,0.20,0.095),vec3(0.22,0.39,0.16),vTint);
  else if(vKind<2.5)base=mix(vec3(0.12,0.23,0.10),vec3(0.34,0.43,0.20),vTint);
  else base=mix(vec3(0.25,0.25,0.22),vec3(0.48,0.46,0.39),vTint);
  outColor=vec4(base*(0.52+diffuse*0.68),1.0);
}`;
interface GroundGeometryData { readonly data:Float32Array; readonly ranges:readonly {first:number;count:number}[]; }
function buildGroundCoverGeometry(): GroundGeometryData {
  const out:number[]=[];
  const ranges=Array.from({length:4},()=>({first:0,count:0}));
  const tri=(a:number[],b:number[],c:number[],kind:number)=>{
    const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
    let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const len=Math.hypot(nx,ny,nz)||1;
    nx/=len;ny/=len;nz/=len;
    const range=ranges[kind];if(range.count===0)range.first=out.length/7;range.count+=3;
    for(const p of [a,b,c])out.push(p[0],p[1],p[2],nx,ny,nz,kind);
  };
  const smoothTri=(a:number[],na:number[],b:number[],nb:number[],c:number[],nc:number[],kind:number)=>{
    const range=ranges[kind];if(range.count===0)range.first=out.length/7;range.count+=3;
    for(const [p,n] of [[a,na],[b,nb],[c,nc]] as const)out.push(p[0],p[1],p[2],n[0],n[1],n[2],kind);
  };
  const blade=(angle:number,width:number,height:number,bend:number,kind:number,rootX=0,rootZ=0)=>{
    const dx=Math.cos(angle),dz=Math.sin(angle),px=-dz,pz=dx,steps=4;
    for(let i=0;i<steps;i++){
      const t0=i/steps,t1=(i+1)/steps;
      const curve=(t:number)=>bend*t*t;
      const w0=width*(1-t0*0.88),w1=width*(1-t1*0.88);
      const y0=height*t0,y1=height*t1;
      const cx0=dx*curve(t0),cz0=dz*curve(t0),cx1=dx*curve(t1),cz1=dz*curve(t1);
      const a=[rootX+cx0-px*w0,y0,rootZ+cz0-pz*w0],b=[rootX+cx0+px*w0,y0,rootZ+cz0+pz*w0];
      const c=[rootX+cx1+px*w1,y1,rootZ+cz1+pz*w1],d=[rootX+cx1-px*w1,y1,rootZ+cz1-pz*w1];
      const normal=(t:number)=>{const n=[dx,-(2*bend*t/Math.max(height,0.001)),dz],len=Math.hypot(...n)||1;return n.map(v=>v/len);};
      const n0=normal(t0),n1=normal(t1),reverse0=n0.map(v=>-v),reverse1=n1.map(v=>-v);
      smoothTri(a,n0,b,n0,c,n1,kind);smoothTri(a,n0,c,n1,d,n1,kind);
      smoothTri(c,reverse1,b,reverse0,a,reverse0,kind);smoothTri(d,reverse1,c,reverse1,a,reverse0,kind);
    }
  };
  const fernLeaf=(base:number[],side:number[],width:number,stemDirection:number[])=>{
    const sideLength=Math.hypot(...side)||1,sideDir=side.map(v=>v/sideLength);
    const widthAxis=normalize([stemDirection[0],0.32,stemDirection[1]]);
    const normal=normalize([
      sideDir[1]*widthAxis[2]-sideDir[2]*widthAxis[1],
      sideDir[2]*widthAxis[0]-sideDir[0]*widthAxis[2],
      sideDir[0]*widthAxis[1]-sideDir[1]*widthAxis[0],
    ]);
    const section=(t:number)=>{
      const center=[base[0]+sideDir[0]*sideLength*t,base[1]+Math.sin(Math.PI*t)*0.018,base[2]+sideDir[2]*sideLength*t];
      const w=width*Math.sin(Math.PI*t);
      return {
        left:center.map((v,i)=>v+widthAxis[i]*w),
        right:center.map((v,i)=>v-widthAxis[i]*w),
      };
    };
    for(let i=0;i<2;i++){
      const a=section(i/2),b=section((i+1)/2);
      smoothTri(a.left,normal,a.right,normal,b.left,normal,1);
      smoothTri(a.right,normal,b.right,normal,b.left,normal,1);
      const back=normal.map(v=>-v);
      smoothTri(b.left,back,a.right,back,a.left,back,1);
      smoothTri(b.left,back,b.right,back,a.right,back,1);
    }
  };
  // Grass blades are curved, tapered strips, with varied azimuth and lean.
  for(let i=0;i<4;i++){
    const a=i*Math.PI*0.5+0.31,r=0.12+(i%2)*0.12;
    blade(a,0.052+(i%2)*0.012,0.72+(i%3)*0.16,0.18+(i%2)*0.07,0,Math.cos(a)*r,Math.sin(a)*r);
  }
  // Fern fronds: arched stems with paired leaflets, not solid triangular fans.
  for(let i=0;i<4;i++){
    const a=i*Math.PI/2+0.22,dx=Math.cos(a),dz=Math.sin(a),px=-dz,pz=dx;
    const stem=(t:number)=>[dx*t*0.62,0.05+Math.sin(t*Math.PI)*0.24+t*0.25,dz*t*0.62];
    for(let j=0;j<4;j++){
      const t=0.14+j*0.19,p=stem(t),leaf=0.105*(1-t*0.45);
      fernLeaf(p,[px*leaf*1.45,-0.012,pz*leaf*1.45],leaf*0.30,[dx,dz]);
      fernLeaf(p,[-px*leaf*1.45,-0.012,-pz*leaf*1.45],leaf*0.30,[dx,dz]);
    }
    const p=stem(1),q=stem(0.78);tri(q,[p[0],p[1]+0.10,p[2]],p,1);
  }
  // Moss is a shallow, smoothly shaded cushion rather than a flat polygon fan.
  const mossPoint=(u:number,v:number)=>{
    const phi=(v/4)*Math.PI*0.5,theta=(u/10)*Math.PI*2;
    const ripple=1+0.055*Math.sin(theta*3.0+phi*4.0);
    return [Math.cos(theta)*Math.sin(phi)*0.48*ripple,0.018+Math.cos(phi)*0.075*ripple,Math.sin(theta)*Math.sin(phi)*0.44*ripple];
  };
  for(let v=0;v<4;v++)for(let u=0;u<10;u++){
    const a=mossPoint(u,v),b=mossPoint(u+1,v),c=mossPoint(u+1,v+1),d=mossPoint(u,v+1);
    const normal=(p:number[])=>{const n=[p[0]/0.48,(p[1]-0.018)/0.075,p[2]/0.44],len=Math.hypot(...n)||1;return n.map(x=>x/len);};
    smoothTri(a,normal(a),b,normal(b),c,normal(c),2);
    smoothTri(a,normal(a),c,normal(c),d,normal(d),2);
  }
  // Small grounded stones with a faceted, low profile.
  const rockRing=[[0.52,0.13,0.05],[0.26,0.16,0.43],[-0.34,0.12,0.40],[-0.53,0.11,-0.20],[-0.10,0.18,-0.48],[0.38,0.13,-0.36]];
  const top=[0.02,0.25,0.01],bottom=[-0.02,0.015,-0.01];
  for(let i=0;i<rockRing.length;i++){tri(top,rockRing[i],rockRing[(i+1)%rockRing.length],3);tri(bottom,rockRing[(i+1)%rockRing.length],rockRing[i],3);}
  return {data:new Float32Array(out),ranges};
}

function buildTreeGeometry(): Float32Array {
  const out:number[]=[];
  const tri=(a:number[],b:number[],c:number[])=>{
    const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
    let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const len=Math.hypot(nx,ny,nz)||1;
    nx/=len;ny/=len;nz/=len;
    for(const p of [a,b,c])out.push(p[0],p[1],p[2],nx,ny,nz);
  };
  const smoothTri=(p0:number[],n0:number[],p1:number[],n1:number[],p2:number[],n2:number[])=>{
    for(const [p,n] of [[p0,n0],[p1,n1],[p2,n2]] as const)out.push(p[0],p[1],p[2],n[0],n[1],n[2]);
  };
  const tube=(a:number[],b:number[],ra:number,rb:number,segments=10)=>{
    const axis=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],length=Math.hypot(...axis)||1;
    const ux=axis[0]/length,uy=axis[1]/length,uz=axis[2]/length;
    const ref=Math.abs(uy)>0.92?[1,0,0]:[0,1,0];
    let vx=uy*ref[2]-uz*ref[1],vy=uz*ref[0]-ux*ref[2],vz=ux*ref[1]-uy*ref[0];
    const vl=Math.hypot(vx,vy,vz)||1;vx/=vl;vy/=vl;vz/=vl;
    const wx=uy*vz-uz*vy,wy=uz*vx-ux*vz,wz=ux*vy-uy*vx;
    const ring=(center:number[],r:number,t:number)=>[center[0]+(vx*Math.cos(t)+wx*Math.sin(t))*r,center[1]+(vy*Math.cos(t)+wy*Math.sin(t))*r,center[2]+(vz*Math.cos(t)+wz*Math.sin(t))*r];
    const radial=(t:number)=>normalize([vx*Math.cos(t)+wx*Math.sin(t),vy*Math.cos(t)+wy*Math.sin(t),vz*Math.cos(t)+wz*Math.sin(t)]);
    for(let i=0;i<segments;i++){
      const p=i/segments*Math.PI*2,q=(i+1)/segments*Math.PI*2;
      const a0=ring(a,ra,p),a1=ring(a,ra,q),b0=ring(b,rb,p),b1=ring(b,rb,q);
      const np=radial(p),nq=radial(q);
      smoothTri(a0,np,b0,np,a1,nq);smoothTri(a1,nq,b0,np,b1,nq);
    }
  };
  // Individual lance-shaped leaves replace the old ellipsoid canopy masses.
  // Each leaf has a raised midrib and a tapered outline, with both sides visible.
  const leaf=(base:number[],tip:number[],width:number,phase:number)=>{
    const dx=tip[0]-base[0],dy=tip[1]-base[1],dz=tip[2]-base[2];
    const length=Math.hypot(dx,dy,dz)||1;
    const axis=[dx/length,dy/length,dz/length];
    const side=normalize(cross(axis,[Math.sin(phase),0.25,Math.cos(phase)]));
    const up=normalize(cross(side,axis));
    const sections=[0,0.48,1];
    const centers=sections.map(t=>[
      base[0]+dx*t+up[0]*Math.sin(Math.PI*t)*width*0.20,
      base[1]+dy*t+up[1]*Math.sin(Math.PI*t)*width*0.20,
      base[2]+dz*t+up[2]*Math.sin(Math.PI*t)*width*0.20,
    ]);
    const widths=[0,width,0];
    const left=centers.map((p,i)=>p.map((v,k)=>v+side[k]*widths[i]));
    const right=centers.map((p,i)=>p.map((v,k)=>v-side[k]*widths[i]));
    const front=normalize(cross(axis,side));
    for(let i=0;i<2;i++){
      const a=left[i],b=right[i],c=left[i+1],d=right[i+1];
      const midNormal=normalize([front[0]+up[0]*0.45,front[1]+up[1]*0.45,front[2]+up[2]*0.45]);
      smoothTri(a,front,b,front,c,midNormal);smoothTri(b,front,d,midNormal,c,midNormal);
      const back=front.map(v=>-v),backMid=midNormal.map(v=>-v);
      smoothTri(c,back,b,back,a,back);smoothTri(c,backMid,d,backMid,b,back);
    }
  };
  const canopyBlob=(center:number[],radii:number[],phase:number)=>{
    const lat=4,lon=8,points:number[][]=[],normals:number[][]=[];
    for(let y=0;y<=lat;y++)for(let x=0;x<=lon;x++){
      const phi=0.08+(y/lat)*(Math.PI-0.16),theta=(x/lon)*Math.PI*2+phase;
      const wobble=1+0.075*Math.sin(theta*3.0+phase)*Math.sin(phi*2.0)+0.035*Math.cos(theta*5.0-phase);
      const unit=[Math.sin(phi)*Math.cos(theta),Math.cos(phi),Math.sin(phi)*Math.sin(theta)];
      points.push([center[0]+unit[0]*radii[0]*wobble,center[1]+unit[1]*radii[1]*wobble,center[2]+unit[2]*radii[2]*wobble]);
      const n=[unit[0]/radii[0],unit[1]/radii[1],unit[2]/radii[2]],length=Math.hypot(...n)||1;
      normals.push(n.map(v=>v/length));
    }
    for(let y=0;y<lat;y++)for(let x=0;x<lon;x++){
      const a=y*(lon+1)+x,b=a+1,d=(y+1)*(lon+1)+x,c=d+1;
      smoothTri(points[a],normals[a],points[b],normals[b],points[c],normals[c]);
      smoothTri(points[a],normals[a],points[c],normals[c],points[d],normals[d]);
    }
  };

  // Buttress roots and tapered branches use smooth radial normals to avoid a faceted trunk.
  for(let root=0;root<5;root++){
    const angle=root/7*Math.PI*2+0.19;
    const start=[Math.cos(angle)*0.035,0.105,Math.sin(angle)*0.035];
    const middle=[Math.cos(angle)*0.16,0.035,Math.sin(angle)*0.16];
    const tip=[Math.cos(angle)*0.30,-0.045,Math.sin(angle)*0.30];
    tube(start,middle,0.034,0.022,6);tube(middle,tip,0.022,0.0035,5);
  }
  const trunk0=[0,0,0],trunk1=[0.018,0.36,-0.008],trunk2=[-0.012,0.70,0.012],trunk3=[0.015,1,0];
  tube(trunk0,trunk1,0.075,0.052,10);tube(trunk1,trunk2,0.052,0.029,9);tube(trunk2,trunk3,0.029,0.008,8);
  for(let tier=0;tier<4;tier++){
    const y=0.34+tier*0.15;
    const center=[Math.sin(tier*1.7)*0.018,y,Math.cos(tier*1.3)*0.014];
    for(let j=0;j<3;j++){
      const angle=j/3*Math.PI*2+tier*1.91;
      const length=(0.34-tier*0.035)*(0.82+0.18*Math.sin(j*4.1+tier));
      const end=[center[0]+Math.cos(angle)*length,y+length*(0.34+(j%2)*0.08),center[2]+Math.sin(angle)*length];
      const mid=[center[0]+Math.cos(angle)*length*0.52,y+length*0.18,center[2]+Math.sin(angle)*length*0.52];
      tube(center,mid,0.027-tier*0.002,0.014-tier*0.001,5);tube(mid,end,0.014-tier*0.001,0.0035,4);
      const leafBase=[mid[0]+(end[0]-mid[0])*0.68,mid[1]+(end[1]-mid[1])*0.68,mid[2]+(end[2]-mid[2])*0.68];
      const clusterCenter=[end[0],end[1]+0.018,end[2]];
      // Small irregular clusters follow the branch direction instead of forming round balls.
      for(let l=0;l<3;l++){
        const phase=angle+l*Math.PI*2/3+tier*0.73;
        const spread=0.052+(l%2)*0.012;
        leaf(leafBase,[leafBase[0]+Math.cos(phase)*spread,leafBase[1]+0.055,leafBase[2]+Math.sin(phase)*spread],0.022,phase);
        leaf(clusterCenter,[clusterCenter[0]+Math.cos(phase)*0.078,clusterCenter[1]+0.038+(l===1?0.018:0),clusterCenter[2]+Math.sin(phase)*0.078],0.027,phase+0.4);
      }
    }
  }
  // The crown is made only from visible branches and leaf clusters; no spherical canopy fill.
  return new Float32Array(out);
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("ไม่สามารถสร้าง Shader ได้");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Shader compilation failed";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const result = gl.createProgram();
  if (!result) throw new Error("ไม่สามารถสร้าง WebGL Program ได้");
  gl.attachShader(result, vs);
  gl.attachShader(result, fs);
  gl.linkProgram(result);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(result, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(result) ?? "Program link failed";
    gl.deleteProgram(result);
    throw new Error(message);
  }
  return result;
}

function normalize(v: number[]): number[] {
  const length = Math.hypot(...v);
  return v.map(value => value / length);
}
function subtract(a: number[], b: number[]): number[] { return a.map((value, i) => value - b[i]); }
function cross(a: number[], b: number[]): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: number[], b: number[]): number { return a.reduce((sum, value, i) => sum + value * b[i], 0); }

function lookAt(eye: number[], center: number[], up: number[]): Float32Array {
  const z = normalize(subtract(eye, center));
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0, x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}

function perspective(fov: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fov / 2);
  return new Float32Array([
    f / aspect, 0, 0, 0, 0, f, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, (2 * far * near) / (near - far), 0,
  ]);
}

function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] = a[row] * b[column * 4]
        + a[4 + row] * b[column * 4 + 1]
        + a[8 + row] * b[column * 4 + 2]
        + a[12 + row] * b[column * 4 + 3];
    }
  }
  return out;
}

const MODE: Record<TerrainViewMode, number> = { world: 0, "first-person": 0, shaded: 0, elevation: 1, slope: 2, normals: 3, wireframe: 4, hydrology: 5 };

const VEGETATION_BIN_SIZE=0.08;
function buildInstanceSpatialBins(data:Float32Array,start=0,end=data.length):Map<string,number[]>{
  const bins=new Map<string,number[]>();
  for(let offset=start;offset<end;offset+=6){
    const key=Math.floor(data[offset]/VEGETATION_BIN_SIZE)+":"+Math.floor(data[offset+2]/VEGETATION_BIN_SIZE);
    const bucket=bins.get(key);
    if(bucket)bucket.push(offset);else bins.set(key,[offset]);
  }
  return bins;
}
function collectVisibleInstances(
  data:Float32Array,bins:Map<string,number[]>,focus:number[],radius:number,target:Float32Array,writeOffset=0,
):number{
  const minX=Math.floor((focus[0]-radius)/VEGETATION_BIN_SIZE),maxX=Math.floor((focus[0]+radius)/VEGETATION_BIN_SIZE);
  const minZ=Math.floor((focus[2]-radius)/VEGETATION_BIN_SIZE),maxZ=Math.floor((focus[2]+radius)/VEGETATION_BIN_SIZE);
  const radiusSquared=radius*radius;
  let cursor=writeOffset;
  for(let bz=minZ;bz<=maxZ;bz++)for(let bx=minX;bx<=maxX;bx++){
    const bucket=bins.get(bx+":"+bz);if(!bucket)continue;
    for(const source of bucket){
      const dx=data[source]-focus[0],dz=data[source+2]-focus[2];
      if(dx*dx+dz*dz>radiusSquared)continue;
      for(let j=0;j<6;j++)target[cursor++]=data[source+j];
    }
  }
  return cursor;
}

interface VolumeLodGpu {readonly vao:WebGLVertexArrayObject;readonly indexBuffer:WebGLBuffer;readonly chunks:readonly VolumeMeshChunk[];readonly indexCount:number}

export class TerrainPreviewRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly positionBuffer: WebGLBuffer;
  private readonly normalBuffer: WebGLBuffer;
  private readonly indexBuffer: WebGLBuffer;
  private readonly lineBuffer: WebGLBuffer;
  private readonly accumulationBuffer: WebGLBuffer;
  private readonly channelBuffer: WebGLBuffer;
  private readonly waterProgram: WebGLProgram;
  private readonly waterVao: WebGLVertexArrayObject;
  private readonly waterBuffer: WebGLBuffer;
  private readonly waterMvpLocation: WebGLUniformLocation;
  private readonly treeProgram: WebGLProgram;
  private readonly treeVao: WebGLVertexArrayObject;
  private readonly treeGeometryBuffer: WebGLBuffer;
  private readonly treeInstanceBuffer: WebGLBuffer;
  private readonly treeMvpLocation: WebGLUniformLocation;
  private treeVertexCount = 0;
  private readonly groundProgram: WebGLProgram;
  private readonly groundVao: WebGLVertexArrayObject;
  private readonly groundGeometryBuffer: WebGLBuffer;
  private readonly groundInstanceBuffer: WebGLBuffer;
  private readonly groundMvpLocation: WebGLUniformLocation;
  private readonly groundGeometryRanges:readonly {first:number;count:number}[];
  private groundKindStarts=[0,0,0,0];
  private groundKindCounts=[0,0,0,0];
  private treeCount = 0;
  private treeInstanceData = new Float32Array(0);
  private treeVisibleData = new Float32Array(0);
  private treeSpatialBins = new Map<string,number[]>();
  private groundInstanceData = new Float32Array(0);
  private groundVisibleData = new Float32Array(0);
  private groundSpatialBins:Map<string,number[]>[]=[new Map(),new Map(),new Map(),new Map()];
  private renderRequest = 0;
  private waterVertexCount = 0;
  private maximumAccumulation = 1;
  private vertexCount = 0;
  private surfaceVertexCount = 0;
  private usesVolumeMesh = false;
  private volumeLodGpu:VolumeLodGpu[]=[];
  private triangleCount = 0;
  private lineCount = 0;
  private mode: TerrainViewMode = "world";
  private azimuth = 0.76;
  private elevation = 0.24;
  private distance = 4.35;
  private fitDistance = 4.35;
  private cameraTarget = [0, 0.34, 0];
  private cameraRadius = 1.8;
  private readonly mvpLocation: WebGLUniformLocation;
  private readonly modelLocation: WebGLUniformLocation;
  private readonly modeLocation: WebGLUniformLocation;
  private readonly cameraLocation: WebGLUniformLocation;
  private readonly maxAccumulationLocation: WebGLUniformLocation;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private previousPinch = 0;
  private field: Heightfield | null = null;
  private playerX = 0;
  private playerZ = 0;
  private playerYaw = 0;
  private playerPitch = -0.04;
  private readonly humanEyeHeight = 0.0016; // 1.6 m when one world unit represents 1 km

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: false, powerPreference: "low-power" });
    if (!gl) throw new Error("อุปกรณ์หรือเบราว์เซอร์นี้ไม่รองรับ WebGL2");
    this.gl = gl;
    this.program = createProgram(gl);
    const waterVs=compile(gl,gl.VERTEX_SHADER,waterVertexSource);
    const waterFs=compile(gl,gl.FRAGMENT_SHADER,waterFragmentSource);
    const waterProgram=gl.createProgram();
    if(!waterProgram) throw new Error("ไม่สามารถสร้าง Water Program ได้");
    gl.attachShader(waterProgram,waterVs);gl.attachShader(waterProgram,waterFs);gl.linkProgram(waterProgram);gl.deleteShader(waterVs);gl.deleteShader(waterFs);
    if(!gl.getProgramParameter(waterProgram,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(waterProgram)??"Water program link failed");
    this.waterProgram=waterProgram;
    const waterVao=gl.createVertexArray(),waterBuffer=gl.createBuffer();
    if(!waterVao||!waterBuffer) throw new Error("ไม่สามารถจองหน่วยความจำผิวน้ำได้");
    this.waterVao=waterVao;this.waterBuffer=waterBuffer;
    this.waterMvpLocation=gl.getUniformLocation(waterProgram,"uMvp")!;
    const treeVs=compile(gl,gl.VERTEX_SHADER,treeVertexSource),treeFs=compile(gl,gl.FRAGMENT_SHADER,treeFragmentSource);
    const treeProgram=gl.createProgram();if(!treeProgram)throw new Error("ไม่สามารถสร้าง Tree Program ได้");
    gl.attachShader(treeProgram,treeVs);gl.attachShader(treeProgram,treeFs);gl.linkProgram(treeProgram);gl.deleteShader(treeVs);gl.deleteShader(treeFs);
    if(!gl.getProgramParameter(treeProgram,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(treeProgram)??"Tree program link failed");
    this.treeProgram=treeProgram;this.treeMvpLocation=gl.getUniformLocation(treeProgram,"uMvp")!;
    const treeVao=gl.createVertexArray(),treeGeometry=gl.createBuffer(),treeInstances=gl.createBuffer();
    if(!treeVao||!treeGeometry||!treeInstances)throw new Error("ไม่สามารถจองหน่วยความจำพืชพรรณได้");
    this.treeVao=treeVao;this.treeGeometryBuffer=treeGeometry;this.treeInstanceBuffer=treeInstances;
    const geometry=buildTreeGeometry();this.treeVertexCount=geometry.length/6;
    gl.bindVertexArray(treeVao);gl.bindBuffer(gl.ARRAY_BUFFER,treeGeometry);gl.bufferData(gl.ARRAY_BUFFER,geometry,gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,24,0);
    gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.FLOAT,false,24,12);
    gl.bindBuffer(gl.ARRAY_BUFFER,treeInstances);
    gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,3,gl.FLOAT,false,24,0);gl.vertexAttribDivisor(2,1);
    gl.enableVertexAttribArray(3);gl.vertexAttribPointer(3,1,gl.FLOAT,false,24,12);gl.vertexAttribDivisor(3,1);
    gl.enableVertexAttribArray(4);gl.vertexAttribPointer(4,1,gl.FLOAT,false,24,16);gl.vertexAttribDivisor(4,1);
    gl.enableVertexAttribArray(5);gl.vertexAttribPointer(5,1,gl.FLOAT,false,24,20);gl.vertexAttribDivisor(5,1);
    gl.bindVertexArray(null);
    const groundVs=compile(gl,gl.VERTEX_SHADER,groundVertexSource),groundFs=compile(gl,gl.FRAGMENT_SHADER,groundFragmentSource);
    const groundProgram=gl.createProgram();if(!groundProgram)throw new Error("ไม่สามารถสร้าง Ground Cover Program ได้");
    gl.attachShader(groundProgram,groundVs);gl.attachShader(groundProgram,groundFs);gl.linkProgram(groundProgram);gl.deleteShader(groundVs);gl.deleteShader(groundFs);
    if(!gl.getProgramParameter(groundProgram,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(groundProgram)??"Ground cover program link failed");
    this.groundProgram=groundProgram;this.groundMvpLocation=gl.getUniformLocation(groundProgram,"uMvp")!;
    
    const groundVao=gl.createVertexArray(),groundGeometry=gl.createBuffer(),groundInstances=gl.createBuffer();
    if(!groundVao||!groundGeometry||!groundInstances)throw new Error("ไม่สามารถจองหน่วยความจำพืชพื้นได้");
    this.groundVao=groundVao;this.groundGeometryBuffer=groundGeometry;this.groundInstanceBuffer=groundInstances;
    const groundGeometryData=buildGroundCoverGeometry();this.groundGeometryRanges=groundGeometryData.ranges;
    gl.bindVertexArray(groundVao);gl.bindBuffer(gl.ARRAY_BUFFER,groundGeometry);gl.bufferData(gl.ARRAY_BUFFER,groundGeometryData.data,gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,28,0);
    gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.FLOAT,false,28,12);
    gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,1,gl.FLOAT,false,28,24);
    gl.bindBuffer(gl.ARRAY_BUFFER,groundInstances);
    gl.enableVertexAttribArray(3);gl.vertexAttribPointer(3,3,gl.FLOAT,false,24,0);gl.vertexAttribDivisor(3,1);
    gl.enableVertexAttribArray(4);gl.vertexAttribPointer(4,1,gl.FLOAT,false,24,12);gl.vertexAttribDivisor(4,1);
    gl.enableVertexAttribArray(5);gl.vertexAttribPointer(5,1,gl.FLOAT,false,24,16);gl.vertexAttribDivisor(5,1);
    gl.enableVertexAttribArray(6);gl.vertexAttribPointer(6,1,gl.FLOAT,false,24,20);gl.vertexAttribDivisor(6,1);
    gl.bindVertexArray(null);
    gl.bindVertexArray(waterVao);gl.bindBuffer(gl.ARRAY_BUFFER,waterBuffer);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);gl.bindVertexArray(null);

    const vao = gl.createVertexArray();
    const position = gl.createBuffer();
    const normal = gl.createBuffer();
    const indices = gl.createBuffer();
    const lines = gl.createBuffer();
    const accumulation = gl.createBuffer();
    const channels = gl.createBuffer();
    if (!vao || !position || !normal || !indices || !lines || !accumulation || !channels) throw new Error("ไม่สามารถจองหน่วยความจำกราฟิกได้");

    this.vao = vao;
    this.positionBuffer = position;
    this.normalBuffer = normal;
    this.indexBuffer = indices;
    this.lineBuffer = lines;
    this.accumulationBuffer = accumulation;
    this.channelBuffer = channels;
    this.mvpLocation = gl.getUniformLocation(this.program, "uMvp")!;
    this.modelLocation = gl.getUniformLocation(this.program, "uModel")!;
    this.modeLocation = gl.getUniformLocation(this.program, "uMode")!;
    this.cameraLocation = gl.getUniformLocation(this.program, "uCameraPosition")!;
    this.maxAccumulationLocation = gl.getUniformLocation(this.program, "uMaxAccumulation")!;

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, position);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, normal);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
    gl.bindBuffer(gl.ARRAY_BUFFER, accumulation);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, channels);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    this.attachCameraControls();
  }

  private attachCameraControls(): void {
    this.canvas.addEventListener("pointerdown", event => {
      this.canvas.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.previousPinch = this.pinchDistance();
    });
    this.canvas.addEventListener("pointermove", event => {
      const previous = this.pointers.get(event.pointerId);
      if (!previous) return;
      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pointers.size >= 2) {
        const nextPinch = this.pinchDistance();
        if (this.previousPinch > 0 && nextPinch > 0) this.distance = Math.max(this.fitDistance * 0.28, Math.min(this.fitDistance * 2.2, this.distance * this.previousPinch / nextPinch));
        this.previousPinch = nextPinch;
      } else if (this.mode === "first-person") {
        this.playerYaw += dx * 0.008;
        this.playerPitch = Math.max(-1.05, Math.min(1.05, this.playerPitch - dy * 0.006));
      } else {
        this.azimuth -= dx * 0.008;
        this.elevation = Math.max(0.16, Math.min(1.32, this.elevation + dy * 0.006));
      }
      this.scheduleRender();
    });
    const release = (event: PointerEvent): void => {
      this.pointers.delete(event.pointerId);
      this.previousPinch = this.pinchDistance();
    };
    this.canvas.addEventListener("pointerup", release);
    this.canvas.addEventListener("pointercancel", release);
    this.canvas.addEventListener("lostpointercapture", release);
    this.canvas.addEventListener("wheel", event => {
      event.preventDefault();
      this.distance = Math.max(this.fitDistance * 0.28, Math.min(this.fitDistance * 2.2, this.distance * Math.exp(event.deltaY * 0.001)));
      this.scheduleRender();
    }, { passive: false });
  }

  private scheduleRender(): void {
    if (this.renderRequest) return;
    this.renderRequest = window.requestAnimationFrame(() => {
      this.renderRequest = 0;
      this.render();
    });
  }

  private pinchDistance(): number {
    const points = [...this.pointers.values()];
    if (points.length < 2) return 0;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }

  resetCamera(): void {
    if (this.mode === "first-person") {
      this.enterFirstPerson();
      return;
    }
    this.azimuth = 0.76;
    this.elevation = 0.24;
    this.distance = this.fitDistance * 0.46;
    this.scheduleRender();
  }

  setMode(mode: TerrainViewMode): void {
    this.mode = mode;
    if (mode === "first-person") this.enterFirstPerson();
    else this.render();
  }

  enterFirstPerson(): void {
    if (!this.field) return;
    this.playerX = (this.field.bounds.minX + this.field.bounds.maxX) * 0.5;
    this.playerZ = (this.field.bounds.minZ + this.field.bounds.maxZ) * 0.5;
    this.playerYaw = 0;
    this.playerPitch = -0.04;
    this.render();
  }

  movePlayer(forward: number, right: number, deltaSeconds = 0.1): void {
    if (this.mode !== "first-person" || !this.field) return;
    const speed = 0.014 * Math.max(0, Math.min(deltaSeconds, 0.05));
    const sin = Math.sin(this.playerYaw), cos = Math.cos(this.playerYaw);
    const dx = (sin * forward + cos * right) * speed;
    const dz = (-cos * forward + sin * right) * speed;
    const b = this.field.bounds;
    const x = Math.max(b.minX + 0.008, Math.min(b.maxX - 0.008, this.playerX + dx));
    const z = Math.max(b.minZ + 0.008, Math.min(b.maxZ - 0.008, this.playerZ + dz));
    this.playerX = x;
    this.playerZ = z;
    this.scheduleRender();
  }

  setVegetation(instances: readonly VegetationInstance[]): void {
    const data=new Float32Array(instances.length*6);
    for(let i=0;i<instances.length;i++){const item=instances[i],offset=i*6;data[offset]=item.x;data[offset+1]=item.y;data[offset+2]=item.z;data[offset+3]=item.height;data[offset+4]=item.tint;data[offset+5]=item.species;}
    this.treeCount=instances.length;this.treeInstanceData=data;this.treeVisibleData=new Float32Array(data.length);
    this.treeSpatialBins=buildInstanceSpatialBins(data);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.treeInstanceBuffer);this.gl.bufferData(this.gl.ARRAY_BUFFER,data,this.gl.STATIC_DRAW);
  }

  setGroundCover(instances: readonly GroundCoverInstance[]): void {
    const buckets=[0,1,2,3].map(()=>[] as GroundCoverInstance[]);
    for(const item of instances)buckets[item.kind].push(item);
    const data=new Float32Array(instances.length*6);
    let cursor=0;
    for(let kind=0;kind<4;kind++){
      this.groundKindStarts[kind]=cursor/6;this.groundKindCounts[kind]=buckets[kind].length;
      for(const item of buckets[kind]){
        data[cursor++]=item.x;data[cursor++]=item.y;data[cursor++]=item.z;
        data[cursor++]=item.scale;data[cursor++]=item.tint;data[cursor++]=item.kind;
      }
    }
    this.groundInstanceData=data;this.groundVisibleData=new Float32Array(data.length);
    for(let kind=0;kind<4;kind++){
      const start=this.groundKindStarts[kind]*6,end=start+this.groundKindCounts[kind]*6;
      this.groundSpatialBins[kind]=buildInstanceSpatialBins(data,start,end);
    }
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.groundInstanceBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER,data,this.gl.STATIC_DRAW);
  }

  setTerrain(field: Heightfield): void {
    this.uploadTerrainMesh(field,buildHeightfieldMesh(field,1),false);
  }

  setVolumeTerrain(field: Heightfield,mesh:VolumeMesh):void {
    this.uploadTerrainMesh(field,mesh,true,mesh.lods);
  }

  private uploadTerrainMesh(
    field:Heightfield,
    mesh:{readonly positions:Float32Array;readonly normals:Float32Array;readonly indices:Uint32Array;readonly vertexCount:number},
    volume:boolean,
    lods:readonly VolumeMeshLod[] = [],
  ):void {
    this.field=field;
    this.usesVolumeMesh=volume;
    const gl=this.gl;
    this.vertexCount=mesh.vertexCount;
    this.surfaceVertexCount=field.width*field.height;
    this.waterVertexCount=0;
    this.maximumAccumulation=1;
    let minHeight=Infinity,maxHeight=-Infinity;
    for(const value of field.values){minHeight=Math.min(minHeight,value);maxHeight=Math.max(maxHeight,value);}
    const baseY=Math.min(0,minHeight-0.012),maxY=maxHeight;
    this.cameraTarget=[
      (field.bounds.minX+field.bounds.maxX)*0.5,
      baseY+(maxY-baseY)*0.32,
      (field.bounds.minZ+field.bounds.maxZ)*0.5,
    ];
    this.cameraRadius=Math.hypot(
      (field.bounds.maxX-field.bounds.minX)*0.5,
      (maxY-baseY)*0.5,
      (field.bounds.maxZ-field.bounds.minZ)*0.5,
    );
    const zoomRatio=this.triangleCount>0?this.distance/this.fitDistance:0.46;
    this.updateCameraFit();
    this.distance=Math.max(this.fitDistance*0.28,Math.min(this.fitDistance*2.2,this.fitDistance*zoomRatio));
    const lines=new Uint32Array(mesh.indices.length*2);
    for(let i=0;i<mesh.indices.length;i+=3){
      const a=mesh.indices[i],b=mesh.indices[i+1],d=mesh.indices[i+2],o=i*2;
      lines[o]=a;lines[o+1]=b;lines[o+2]=b;lines[o+3]=d;lines[o+4]=d;lines[o+5]=a;
    }
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.positionBuffer);gl.bufferData(gl.ARRAY_BUFFER,mesh.positions,gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.normalBuffer);gl.bufferData(gl.ARRAY_BUFFER,mesh.normals,gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indexBuffer);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,mesh.indices,gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.lineBuffer);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,lines,gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indexBuffer);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.accumulationBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(this.vertexCount),gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.channelBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(this.vertexCount),gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);
    this.triangleCount=mesh.indices.length;
    this.lineCount=lines.length;
    for(const old of this.volumeLodGpu.slice(1)){gl.deleteBuffer(old.indexBuffer);gl.deleteVertexArray(old.vao);}
    this.volumeLodGpu=[];
    if(volume&&lods.length>0){
      this.volumeLodGpu.push({vao:this.vao,indexBuffer:this.indexBuffer,chunks:lods[0].chunks,indexCount:lods[0].indices.length});
      for(const lod of lods.slice(1)){
        const vao=gl.createVertexArray(),position=gl.createBuffer(),normal=gl.createBuffer(),indices=gl.createBuffer();
        if(!vao||!position||!normal||!indices)continue;
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER,position);gl.bufferData(gl.ARRAY_BUFFER,lod.positions,gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);
        gl.bindBuffer(gl.ARRAY_BUFFER,normal);gl.bufferData(gl.ARRAY_BUFFER,lod.normals,gl.STATIC_DRAW);
        gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.FLOAT,false,0,0);
        gl.disableVertexAttribArray(2);gl.vertexAttrib1f(2,0);
        gl.disableVertexAttribArray(3);gl.vertexAttrib1f(3,0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indices);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,lod.indices,gl.STATIC_DRAW);
        gl.bindVertexArray(null);
        this.volumeLodGpu.push({vao,indexBuffer:indices,chunks:lod.chunks,indexCount:lod.indices.length});
      }
    }
    this.render();
  }

  setHydrology(field: Heightfield, drainage: DrainageField, rivers: RiverNetwork): void {
    if (drainage.accumulation.length !== this.surfaceVertexCount || rivers.channelMask.length !== this.surfaceVertexCount) {
      throw new Error("Hydrology data does not match the terrain mesh");
    }
    const accumulation = new Float32Array(this.vertexCount);
    const channels = new Float32Array(this.vertexCount);
    if (!this.usesVolumeMesh) {
      for (let i = 0; i < this.surfaceVertexCount; i += 1) {
        accumulation[i] = drainage.accumulation[i];
        channels[i] = rivers.channelMask[i];
      }
    }
    this.maximumAccumulation = Math.max(1, drainage.diagnostics.maximumAccumulation);
    const gl = this.gl;
    const water:number[]=[];
    const px=(index:number)=>field.bounds.minX+(index%field.width)/(field.width-1)*(field.bounds.maxX-field.bounds.minX);
    const pz=(index:number)=>field.bounds.minZ+Math.floor(index/field.width)/(field.height-1)*(field.bounds.maxZ-field.bounds.minZ);
    const renderedSegments=new Set<string>();
    const point=(index:number)=>({
      x:px(index),z:pz(index),w:Math.max(rivers.width[index]*0.5,0.0015),
    });
    const catmull=(a:number,b:number,c:number,d:number,t:number):number=>{
      const t2=t*t,t3=t2*t;
      return 0.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t2+(-a+3*b-3*c+d)*t3);
    };
    // Trace each headwater once, then spline each D8 segment with its
    // neighbouring cells as control points. This removes the staircase
    // appearance while keeping the channel attached to the same heightfield.
    for(const headwater of rivers.headwaterIndices){
      const path=[headwater];
      let current=headwater;
      while(rivers.downstream[current]>=0 && path.length<=this.surfaceVertexCount){
        current=rivers.downstream[current];
        path.push(current);
      }
      const sections:{x:number;z:number;y:number;w:number}[]=[];
      let terminalIndex=path[0];
      const subdivisions=8;
      for(let segment=0;segment<path.length-1;segment++){
        const p0=point(path[Math.max(0,segment-1)]);
        const p1=point(path[segment]);
        const p2=point(path[segment+1]);
        const p3=point(path[Math.min(path.length-1,segment+2)]);
        const segmentKey=path[segment]+":"+path[segment+1];
        if(renderedSegments.has(segmentKey))continue;
        renderedSegments.add(segmentKey);
        terminalIndex=path[segment+1];
        for(let step=0;step<subdivisions;step++){
          const t=step/subdivisions;
          const x=catmull(p0.x,p1.x,p2.x,p3.x,t);
          const z=catmull(p0.z,p1.z,p2.z,p3.z,t);
          const width=Math.max(0.0009,catmull(p0.w,p1.w,p2.w,p3.w,t));
          sections.push({x,z,y:sampleElevation(field,x,z)+0.0018,w:width});
        }
      }
      const last=point(terminalIndex);
      sections.push({...last,y:sampleElevation(field,last.x,last.z)+0.0018});
      const edges=sections.map((section,index)=>{
        const previous=sections[Math.max(0,index-1)],next=sections[Math.min(sections.length-1,index+1)];
        const dx=next.x-previous.x,dz=next.z-previous.z,length=Math.hypot(dx,dz)||1;
        const nx=-dz/length,nz=dx/length;
        return{
          left:[section.x+nx*section.w,section.y,section.z+nz*section.w],
          right:[section.x-nx*section.w,section.y,section.z-nz*section.w],
        };
      });
      for(let i=0;i<edges.length-1;i++){
        const a=edges[i],b=edges[i+1];
        water.push(...a.left,...a.right,...b.left,...a.right,...b.right,...b.left);
      }
    }
    this.waterVertexCount=water.length/3;
    gl.bindBuffer(gl.ARRAY_BUFFER,this.waterBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(water),gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.accumulationBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, accumulation, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.channelBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, channels, gl.DYNAMIC_DRAW);
    this.render();
  }

  private updateCameraFit(): void {
    const rect = this.canvas.getBoundingClientRect();
    const aspect = rect.width / Math.max(1, rect.height);
    const verticalFov = 0.72;
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov * 0.5) * aspect);
    const limitingFov = Math.min(verticalFov, horizontalFov);
    this.fitDistance = Math.max(2.4, Math.min(8, this.cameraRadius / Math.sin(limitingFov * 0.5) * 1.12));
  }

  resize(): void {
    const zoomRatio = this.distance / this.fitDistance;
    const rect = this.canvas.getBoundingClientRect();
    this.updateCameraFit();
    this.distance = Math.max(this.fitDistance * 0.28, Math.min(this.fitDistance * 2.2, this.fitDistance * zoomRatio));
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.render();
  }

  render(): void {
    const gl = this.gl;
    if (!this.triangleCount) return;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.075, 0.12, 0.105, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);

    const exploring = this.mode === "first-person";
    const camera = exploring && this.field
      ? [this.playerX, sampleElevation(this.field, this.playerX, this.playerZ) + this.humanEyeHeight, this.playerZ]
      : (() => {
          const horizontal = Math.cos(this.elevation) * this.distance;
          return [
            this.cameraTarget[0] + Math.sin(this.azimuth) * horizontal,
            this.cameraTarget[1] + Math.sin(this.elevation) * this.distance,
            this.cameraTarget[2] + Math.cos(this.azimuth) * horizontal,
          ];
        })();
    const target = exploring
      ? [camera[0] + Math.sin(this.playerYaw) * Math.cos(this.playerPitch), camera[1] + Math.sin(this.playerPitch), camera[2] - Math.cos(this.playerYaw) * Math.cos(this.playerPitch)]
      : this.cameraTarget;
    const view = lookAt(camera, target, [0, 1, 0]);
    const projection = perspective(0.72, this.canvas.width / Math.max(1, this.canvas.height), exploring ? 0.00015 : 0.1, exploring ? 8 : 100);
    const mvp = multiply(projection, view);
    const model = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);

    gl.uniformMatrix4fv(this.mvpLocation, false, mvp);
    gl.uniformMatrix4fv(this.modelLocation, false, model);
    gl.uniform1i(this.modeLocation, MODE[this.mode]);
    gl.uniform3f(this.cameraLocation, camera[0], camera[1], camera[2]);
    gl.uniform1f(this.maxAccumulationLocation, this.maximumAccumulation);
    const lodIndex=exploring?0:(this.distance<this.fitDistance*0.92?0:this.distance<this.fitDistance*1.55?1:2);
    const activeLod=this.usesVolumeMesh?this.volumeLodGpu[Math.min(lodIndex,this.volumeLodGpu.length-1)]:undefined;
    gl.bindVertexArray(activeLod?.vao??this.vao);

    if (this.mode === "wireframe") {
      gl.disable(gl.CULL_FACE);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.lineBuffer);
      gl.drawElements(gl.LINES, this.lineCount, gl.UNSIGNED_INT, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
      gl.enable(gl.CULL_FACE);
    } else if(exploring&&this.volumeLodGpu.length>0){
      const rings=[0.20,0.40,0.62];
      for(let level=0;level<Math.min(3,this.volumeLodGpu.length);level++){
        const lod=this.volumeLodGpu[level],inner=rings[level]??rings[rings.length-1];
        const outer=rings[level+1]??rings[rings.length-1],innerSquared=level===0?0:inner*inner,outerSquared=outer*outer;
        gl.bindVertexArray(lod.vao);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,lod.indexBuffer);
        for(const chunk of lod.chunks){
          const dx=chunk.centerX-camera[0],dz=chunk.centerZ-camera[2],distanceSquared=dx*dx+dz*dz;
          if(distanceSquared<innerSquared||distanceSquared>outerSquared)continue;
          gl.drawElements(gl.TRIANGLES,chunk.indexCount,gl.UNSIGNED_INT,chunk.startIndex*Uint32Array.BYTES_PER_ELEMENT);
        }
      }
      gl.bindVertexArray(this.volumeLodGpu[0].vao);
    } else {
      if(activeLod)gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,activeLod.indexBuffer);
      gl.drawElements(gl.TRIANGLES,activeLod?.indexCount??this.triangleCount,gl.UNSIGNED_INT,0);
    }
    gl.bindVertexArray(null);
    // Keep distant vegetation in the terrain material; geometry is reserved for nearby detail.
    const focus=exploring?camera:this.cameraTarget;
    const treeRadius=exploring?0.28:1.18;
    const groundRadius=exploring?0.20:(this.distance<this.fitDistance*0.65?1.15:0.82);
    const treeRadiusSquared=treeRadius*treeRadius,groundRadiusSquared=groundRadius*groundRadius;
    const treeCursor=collectVisibleInstances(this.treeInstanceData,this.treeSpatialBins,focus,treeRadius,this.treeVisibleData);
    const treeDrawCount=treeCursor/6;
    gl.bindBuffer(gl.ARRAY_BUFFER,this.treeInstanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER,0,this.treeVisibleData.subarray(0,treeCursor));
    const visibleStarts=[0,0,0,0],visibleCounts=[0,0,0,0];
    let groundCursor=0;
    for(let kind=0;kind<4;kind++){
      visibleStarts[kind]=groundCursor/6;
      const next=collectVisibleInstances(this.groundInstanceData,this.groundSpatialBins[kind],focus,groundRadius,this.groundVisibleData,groundCursor);
      visibleCounts[kind]=(next-groundCursor)/6;
      groundCursor=next;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER,this.groundInstanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER,0,this.groundVisibleData.subarray(0,groundCursor));
    if((this.mode==="world" || this.mode==="first-person") && treeDrawCount>0){
      gl.useProgram(this.treeProgram);gl.uniformMatrix4fv(this.treeMvpLocation,false,mvp);
      gl.bindVertexArray(this.treeVao);gl.drawArraysInstanced(gl.TRIANGLES,0,this.treeVertexCount,treeDrawCount);gl.bindVertexArray(null);
    }
    if(this.mode==="world" || this.mode==="first-person"){
      gl.useProgram(this.groundProgram);gl.uniformMatrix4fv(this.groundMvpLocation,false,mvp);
      gl.bindVertexArray(this.groundVao);gl.bindBuffer(gl.ARRAY_BUFFER,this.groundInstanceBuffer);
      for(let kind=0;kind<4;kind++){
        const count=visibleCounts[kind],range=this.groundGeometryRanges[kind];
        if(count===0||range.count===0)continue;
        const byteOffset=visibleStarts[kind]*24;
        gl.vertexAttribPointer(3,3,gl.FLOAT,false,24,byteOffset);
        gl.vertexAttribPointer(4,1,gl.FLOAT,false,24,byteOffset+12);
        gl.vertexAttribPointer(5,1,gl.FLOAT,false,24,byteOffset+16);
        gl.vertexAttribPointer(6,1,gl.FLOAT,false,24,byteOffset+20);
        gl.drawArraysInstanced(gl.TRIANGLES,range.first,range.count,count);
      }
      gl.bindVertexArray(null);
    }
    if((this.mode==="world" || this.mode==="first-person") && this.waterVertexCount>0){
      gl.useProgram(this.waterProgram);gl.uniformMatrix4fv(this.waterMvpLocation,false,mvp);gl.bindVertexArray(this.waterVao);
      gl.disable(gl.CULL_FACE);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.drawArrays(gl.TRIANGLES,0,this.waterVertexCount);gl.disable(gl.BLEND);gl.enable(gl.CULL_FACE);gl.bindVertexArray(null);
    }
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.positionBuffer);
    gl.deleteBuffer(this.normalBuffer);
    gl.deleteBuffer(this.indexBuffer);
    gl.deleteBuffer(this.lineBuffer);
    gl.deleteBuffer(this.accumulationBuffer);
    gl.deleteBuffer(this.channelBuffer);
    for(const lod of this.volumeLodGpu.slice(1)){gl.deleteBuffer(lod.indexBuffer);gl.deleteVertexArray(lod.vao);}
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
    gl.deleteBuffer(this.waterBuffer);gl.deleteVertexArray(this.waterVao);gl.deleteProgram(this.waterProgram);
    if (this.renderRequest) window.cancelAnimationFrame(this.renderRequest);
    gl.deleteBuffer(this.treeGeometryBuffer);gl.deleteBuffer(this.treeInstanceBuffer);gl.deleteVertexArray(this.treeVao);gl.deleteProgram(this.treeProgram);
    gl.deleteBuffer(this.groundGeometryBuffer);gl.deleteBuffer(this.groundInstanceBuffer);gl.deleteVertexArray(this.groundVao);gl.deleteProgram(this.groundProgram);
  }
}
