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
  vec3 low = vec3(0.105, 0.205, 0.17);
  vec3 grass = vec3(0.29, 0.43, 0.29);
  vec3 highland = vec3(0.49, 0.48, 0.35);
  vec3 rock = vec3(0.49, 0.46, 0.40);
  vec3 snow = vec3(0.82, 0.84, 0.78);
  vec3 color = mix(low, grass, smoothstep(0.04, 0.28, height));
  color = mix(color, highland, smoothstep(0.30, 0.57, height));
  color = mix(color, rock, smoothstep(0.62, 0.82, height));
  color = mix(color, snow, smoothstep(0.88, 1.04, height));
  float exposedRock = smoothstep(0.22, 0.66, slope) * (1.0 - smoothstep(0.82, 1.0, height));
  return mix(color, rock, exposedRock * 0.68);
}

void main() {
  vec3 n = normalize(vNormal);
  float height = clamp(vPosition.y / 1.5, 0.0, 1.0);
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
    float broadTexture = fbm2(texCoord * 18.0);
    float stoneGrain = fbm2(texCoord * 74.0);
    float fineGrain = noise2(texCoord * 190.0);
    float rockExposure = smoothstep(0.34, 0.68, slope);
    float striation = 1.0 - abs(noise2(texCoord * 31.0 + vec2(height * 7.0, height * 3.0)) * 2.0 - 1.0);
    vec3 earthTint = vec3(0.78, 0.76, 0.65) * (0.82 + broadTexture * 0.32);
    vec3 rockTint = vec3(0.68, 0.66, 0.59) * (0.76 + broadTexture * 0.42);
    rockTint *= 0.91 + striation * 0.12;
    base = mix(base * (0.88 + broadTexture * 0.24), earthTint, (1.0 - rockExposure) * 0.12);
    base = mix(base, rockTint, rockExposure * 0.58);
    base *= 0.94 + stoneGrain * 0.12 + fineGrain * 0.035;
    float bumpStep = 0.003;
    vec2 bumpGradient = vec2(
      fbm2((texCoord + vec2(bumpStep, 0.0)) * 74.0) - stoneGrain,
      fbm2((texCoord + vec2(0.0, bumpStep)) * 74.0) - stoneGrain
    ) / bumpStep;
    n = normalize(n - vec3(bumpGradient.x, 0.0, bumpGradient.y) * 0.0009 * rockExposure);
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


const treeVertexSource = "#version 300 es\nprecision highp float;\nlayout(location=0) in vec3 aPosition;\nlayout(location=1) in vec3 aNormal;\nlayout(location=2) in vec3 iOffset;\nlayout(location=3) in float iScale;\nlayout(location=4) in float iTint;\nuniform mat4 uMvp;\nout vec3 vNormal;\nout float vHeight;\nout float vTint;\nvoid main(){vec3 world=aPosition*iScale+iOffset;vNormal=aNormal;vHeight=aPosition.y;vTint=iTint;gl_Position=uMvp*vec4(world,1.0);}";
const treeFragmentSource = "#version 300 es\nprecision highp float;\nin vec3 vNormal;in float vHeight;in float vTint;out vec4 outColor;\nvoid main(){vec3 n=normalize(vNormal);vec3 light=normalize(vec3(-0.45,0.82,0.36));float diffuse=max(dot(n,light),0.0);vec3 bark=mix(vec3(0.19,0.13,0.085),vec3(0.34,0.23,0.13),vTint*0.55);vec3 leaf=mix(vec3(0.055,0.19,0.105),vec3(0.20,0.34,0.16),vTint*0.72);vec3 color=vHeight<0.38?bark:leaf;color*=0.42+diffuse*0.72;outColor=vec4(color,1.0);}";
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
uniform vec3 uCameraPosition;
uniform float uRange;
out vec3 vNormal;
out float vTint;
out float vKind;
void main(){
  if(abs(aKind-iKind)>0.1 || distance(iOffset.xz,uCameraPosition.xz)>uRange){gl_Position=vec4(2.0,2.0,2.0,1.0);return;}
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
function buildGroundCoverGeometry(): Float32Array {
  const out:number[]=[];
  const tri=(a:number[],b:number[],d:number[],kind:number)=>{
    const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=d[0]-a[0],vy=d[1]-a[1],vz=d[2]-a[2];
    let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const len=Math.hypot(nx,ny,nz)||1;
    nx/=len;ny/=len;nz/=len;
    for(const p of [a,b,d])out.push(p[0],p[1],p[2],nx,ny,nz,kind);
  };
  for(let i=0;i<5;i++){
    const angle=i/5*Math.PI*2,dx=Math.cos(angle),dz=Math.sin(angle),sx=-dz*0.10,sz=dx*0.10;
    tri([-sx,0,-sz],[sx,0,sz],[dx*0.16,0.95,dz*0.16],0);
  }
  for(let i=0;i<4;i++){
    const angle=i/4*Math.PI*2,dx=Math.cos(angle),dz=Math.sin(angle),px=-dz,pz=dx;
    tri([0,0,0],[dx*0.10,0.08,dz*0.10],[dx*0.82,0.72,dz*0.82],1);
    for(let j=1;j<=3;j++){
      const t=j/4,cx=dx*t*0.72,cz=dz*t*0.72,cy=0.08+Math.sin(t*Math.PI)*0.30,leaf=0.18*(1-t*0.48);
      tri([cx,cy,cz],[cx+px*leaf,cy+0.05,cz+pz*leaf],[cx+dx*0.09,cy+0.08,cz+dz*0.09],1);
      tri([cx,cy,cz],[cx-px*leaf,cy+0.05,cz-pz*leaf],[cx+dx*0.09,cy+0.08,cz+dz*0.09],1);
    }
  }
  const mossRing:number[][]=[];
  for(let i=0;i<7;i++){const a=i/7*Math.PI*2,r=0.62+(i%2)*0.08;mossRing.push([Math.cos(a)*r,0.10+(i%3)*0.025,Math.sin(a)*r]);}
  for(let i=0;i<mossRing.length;i++)tri([0,0.30,0],mossRing[i],mossRing[(i+1)%mossRing.length],2);
  const top=[0.05,0.48,0.02],bottom=[-0.03,0.02,-0.02];
  const ring=[[0.62,0.20,0.05],[0.25,0.17,0.58],[-0.48,0.19,0.42],[-0.60,0.16,-0.28],[-0.12,0.22,-0.62],[0.48,0.16,-0.40]];
  for(let i=0;i<ring.length;i++){tri(top,ring[i],ring[(i+1)%ring.length],3);tri(bottom,ring[(i+1)%ring.length],ring[i],3);}
  return new Float32Array(out);
}

function buildTreeGeometry(): Float32Array {
  const out: number[] = [];
  const tri = (a:number[],b:number[],d:number[]) => {
    const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=d[0]-a[0],vy=d[1]-a[1],vz=d[2]-a[2];
    let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const len=Math.hypot(nx,ny,nz)||1;nx/=len;ny/=len;nz/=len;
    for(const p of [a,b,d])out.push(p[0],p[1],p[2],nx,ny,nz);
  };
  const cone=(bottom:number,top:number,radius:number,segments=7) => {const apex=[0,top,0];for(let i=0;i<segments;i++){const a=i/segments*Math.PI*2,b=(i+1)/segments*Math.PI*2;tri([Math.cos(a)*radius,bottom,Math.sin(a)*radius],apex,[Math.cos(b)*radius,bottom,Math.sin(b)*radius]);}};
  const cylinder=(bottom:number,top:number,radius:number,segments=6) => {for(let i=0;i<segments;i++){const a=i/segments*Math.PI*2,b=(i+1)/segments*Math.PI*2,p1=[Math.cos(a)*radius,bottom,Math.sin(a)*radius],p2=[Math.cos(b)*radius,bottom,Math.sin(b)*radius],p3=[Math.cos(a)*radius,top,Math.sin(a)*radius],p4=[Math.cos(b)*radius,top,Math.sin(b)*radius];tri(p1,p3,p2);tri(p2,p3,p4);}};
  cylinder(0,0.39,0.045);cone(0.18,0.60,0.25);cone(0.37,0.81,0.19);cone(0.56,1,0.125);
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
  private readonly groundCameraLocation: WebGLUniformLocation;
  private readonly groundRangeLocation: WebGLUniformLocation;
  private groundVertexCount = 0;
  private groundCount = 0;
  private treeCount = 0;
  private treeInstanceData = new Float32Array(0);
  private treeVisibleData = new Float32Array(0);
  private groundInstanceData = new Float32Array(0);
  private groundVisibleData = new Float32Array(0);
  private instanceBuffersCulled = false;
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
    gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,3,gl.FLOAT,false,20,0);gl.vertexAttribDivisor(2,1);
    gl.enableVertexAttribArray(3);gl.vertexAttribPointer(3,1,gl.FLOAT,false,20,12);gl.vertexAttribDivisor(3,1);
    gl.enableVertexAttribArray(4);gl.vertexAttribPointer(4,1,gl.FLOAT,false,20,16);gl.vertexAttribDivisor(4,1);
    gl.bindVertexArray(null);
    const groundVs=compile(gl,gl.VERTEX_SHADER,groundVertexSource),groundFs=compile(gl,gl.FRAGMENT_SHADER,groundFragmentSource);
    const groundProgram=gl.createProgram();if(!groundProgram)throw new Error("ไม่สามารถสร้าง Ground Cover Program ได้");
    gl.attachShader(groundProgram,groundVs);gl.attachShader(groundProgram,groundFs);gl.linkProgram(groundProgram);gl.deleteShader(groundVs);gl.deleteShader(groundFs);
    if(!gl.getProgramParameter(groundProgram,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(groundProgram)??"Ground cover program link failed");
    this.groundProgram=groundProgram;this.groundMvpLocation=gl.getUniformLocation(groundProgram,"uMvp")!;
    this.groundCameraLocation=gl.getUniformLocation(groundProgram,"uCameraPosition")!;
    this.groundRangeLocation=gl.getUniformLocation(groundProgram,"uRange")!;
    const groundVao=gl.createVertexArray(),groundGeometry=gl.createBuffer(),groundInstances=gl.createBuffer();
    if(!groundVao||!groundGeometry||!groundInstances)throw new Error("ไม่สามารถจองหน่วยความจำพืชพื้นได้");
    this.groundVao=groundVao;this.groundGeometryBuffer=groundGeometry;this.groundInstanceBuffer=groundInstances;
    const groundGeometryData=buildGroundCoverGeometry();this.groundVertexCount=groundGeometryData.length/7;
    gl.bindVertexArray(groundVao);gl.bindBuffer(gl.ARRAY_BUFFER,groundGeometry);gl.bufferData(gl.ARRAY_BUFFER,groundGeometryData,gl.STATIC_DRAW);
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
    const dx = (-sin * forward + cos * right) * speed;
    const dz = (-cos * forward - sin * right) * speed;
    const b = this.field.bounds;
    const x = Math.max(b.minX + 0.008, Math.min(b.maxX - 0.008, this.playerX + dx));
    const z = Math.max(b.minZ + 0.008, Math.min(b.maxZ - 0.008, this.playerZ + dz));
    this.playerX = x;
    this.playerZ = z;
    this.scheduleRender();
  }

  setVegetation(instances: readonly VegetationInstance[]): void {
    const data=new Float32Array(instances.length*5);
    for(let i=0;i<instances.length;i++){const item=instances[i],offset=i*5;data[offset]=item.x;data[offset+1]=item.y;data[offset+2]=item.z;data[offset+3]=item.height;data[offset+4]=item.tint;}
    this.treeCount=instances.length;this.treeInstanceData=data;this.treeVisibleData=new Float32Array(data.length);this.instanceBuffersCulled=false;this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.treeInstanceBuffer);this.gl.bufferData(this.gl.ARRAY_BUFFER,data,this.gl.STATIC_DRAW);
  }

  setGroundCover(instances: readonly GroundCoverInstance[]): void {
    const data=new Float32Array(instances.length*6);
    for(let i=0;i<instances.length;i++){
      const item=instances[i],offset=i*6;
      data[offset]=item.x;data[offset+1]=item.y;data[offset+2]=item.z;
      data[offset+3]=item.scale;data[offset+4]=item.tint;data[offset+5]=item.kind;
    }
    this.groundCount=instances.length;this.groundInstanceData=data;this.groundVisibleData=new Float32Array(data.length);this.instanceBuffersCulled=false;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.groundInstanceBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER,data,this.gl.STATIC_DRAW);
  }

  setTerrain(field: Heightfield): void {
    this.uploadTerrainMesh(field,buildHeightfieldMesh(field,1.18),false);
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
    const baseY=Math.min(0,minHeight*1.18-0.012),maxY=maxHeight*1.18;
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
      for(let segment=0;segment<path.length-1;segment++){
        const aIndex=path[segment],bIndex=path[segment+1];
        const key=aIndex+":"+bIndex;
        if(renderedSegments.has(key))continue;
        renderedSegments.add(key);
        const p0=point(path[Math.max(0,segment-1)]);
        const p1=point(aIndex);
        const p2=point(bIndex);
        const p3=point(path[Math.min(path.length-1,segment+2)]);
        const sections:{x:number;z:number;y:number;w:number}[]=[];
        const subdivisions=4;
        for(let step=0;step<=subdivisions;step++){
          const t=step/subdivisions;
          const x=catmull(p0.x,p1.x,p2.x,p3.x,t);
          const z=catmull(p0.z,p1.z,p2.z,p3.z,t);
          const width=Math.max(0.0012,catmull(p0.w,p1.w,p2.w,p3.w,t));
          sections.push({x,z,y:sampleElevation(field,x,z)*1.18+0.012,w:width});
        }
        for(let step=0;step<subdivisions;step++){
          const a=sections[step],b=sections[step+1];
          const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz)||1;
          const nx=-dz/len,nz=dx/len;
          const aL=[a.x+nx*a.w,a.y,a.z+nz*a.w],aR=[a.x-nx*a.w,a.y,a.z-nz*a.w];
          const bL=[b.x+nx*b.w,b.y,b.z+nz*b.w],bR=[b.x-nx*b.w,b.y,b.z-nz*b.w];
          water.push(...aL,...aR,...bL,...aR,...bR,...bL);
        }
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
      ? [this.playerX, sampleElevation(this.field, this.playerX, this.playerZ) * 1.18 + this.humanEyeHeight, this.playerZ]
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
    } else if(exploring&&activeLod&&activeLod.chunks.length>0){
      const rangeSquared=0.42*0.42;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,activeLod.indexBuffer);
      for(const chunk of activeLod.chunks){
        const dx=chunk.centerX-camera[0],dz=chunk.centerZ-camera[2];
        if(dx*dx+dz*dz>rangeSquared)continue;
        gl.drawElements(gl.TRIANGLES,chunk.indexCount,gl.UNSIGNED_INT,chunk.startIndex*Uint32Array.BYTES_PER_ELEMENT);
      }
    } else {
      if(activeLod)gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,activeLod.indexBuffer);
      gl.drawElements(gl.TRIANGLES,activeLod?.indexCount??this.triangleCount,gl.UNSIGNED_INT,0);
    }
    gl.bindVertexArray(null);
    let treeDrawCount=this.treeCount,groundDrawCount=this.groundCount;
    if(exploring){
      let treeCursor=0;
      for(let i=0;i<this.treeCount;i++){
        const source=i*5,dx=this.treeInstanceData[source]-camera[0],dz=this.treeInstanceData[source+2]-camera[2];
        if(dx*dx+dz*dz>0.28*0.28)continue;
        for(let j=0;j<5;j++)this.treeVisibleData[treeCursor++]=this.treeInstanceData[source+j];
      }
      treeDrawCount=treeCursor/5;
      gl.bindBuffer(gl.ARRAY_BUFFER,this.treeInstanceBuffer);
      gl.bufferData(gl.ARRAY_BUFFER,this.treeVisibleData.subarray(0,treeCursor),gl.DYNAMIC_DRAW);
      let groundCursor=0;
      for(let i=0;i<this.groundCount;i++){
        const source=i*6,dx=this.groundInstanceData[source]-camera[0],dz=this.groundInstanceData[source+2]-camera[2];
        if(dx*dx+dz*dz>0.22*0.22)continue;
        for(let j=0;j<6;j++)this.groundVisibleData[groundCursor++]=this.groundInstanceData[source+j];
      }
      groundDrawCount=groundCursor/6;
      gl.bindBuffer(gl.ARRAY_BUFFER,this.groundInstanceBuffer);
      gl.bufferData(gl.ARRAY_BUFFER,this.groundVisibleData.subarray(0,groundCursor),gl.DYNAMIC_DRAW);
      this.instanceBuffersCulled=true;
    }else if(this.instanceBuffersCulled){
      gl.bindBuffer(gl.ARRAY_BUFFER,this.treeInstanceBuffer);gl.bufferData(gl.ARRAY_BUFFER,this.treeInstanceData,gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER,this.groundInstanceBuffer);gl.bufferData(gl.ARRAY_BUFFER,this.groundInstanceData,gl.STATIC_DRAW);
      this.instanceBuffersCulled=false;
    }
    if((this.mode==="world" || this.mode==="first-person") && treeDrawCount>0){
      gl.useProgram(this.treeProgram);gl.uniformMatrix4fv(this.treeMvpLocation,false,mvp);
      gl.bindVertexArray(this.treeVao);gl.drawArraysInstanced(gl.TRIANGLES,0,this.treeVertexCount,treeDrawCount);gl.bindVertexArray(null);
    }
    if((this.mode==="world" || this.mode==="first-person") && groundDrawCount>0){
      gl.useProgram(this.groundProgram);gl.uniformMatrix4fv(this.groundMvpLocation,false,mvp);
      gl.uniform3f(this.groundCameraLocation,camera[0],camera[1],camera[2]);
      gl.uniform1f(this.groundRangeLocation,exploring?0.22:2.6);
      gl.bindVertexArray(this.groundVao);gl.drawArraysInstanced(gl.TRIANGLES,0,this.groundVertexCount,groundDrawCount);gl.bindVertexArray(null);
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
