import { buildHeightfieldMesh } from "../../world/mesh/heightfield-mesh";
import type { Heightfield } from "../../world/fields/heightfield";
export type TerrainViewMode = "shaded" | "elevation" | "slope" | "normals" | "wireframe";
const vertexSource = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
uniform mat4 uMvp;
uniform mat4 uModel;
out vec3 vNormal;
out vec3 vPosition;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vPosition = world.xyz;
  vNormal = mat3(uModel) * aNormal;
  gl_Position = uMvp * vec4(aPosition, 1.0);
}`;
const fragmentSource = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vPosition;
uniform int uMode;
out vec4 outColor;
vec3 ramp(float t) {
  vec3 a = vec3(0.10, 0.19, 0.19);
  vec3 b = vec3(0.28, 0.43, 0.34);
  vec3 c = vec3(0.68, 0.67, 0.49);
  vec3 d = vec3(0.83, 0.86, 0.78);
  return t < 0.48 ? mix(a,b,t/0.48) : (t < 0.82 ? mix(b,c,(t-0.48)/0.34) : mix(c,d,(t-0.82)/0.18));
}
void main() {
  vec3 n = normalize(vNormal);
  float h = clamp(vPosition.y / 1.5, 0.0, 1.0);
  float slope = 1.0 - clamp(n.y, 0.0, 1.0);
  vec3 color;
  if (uMode == 1) color = ramp(h);
  else if (uMode == 2) color = mix(vec3(0.15,0.35,0.26), vec3(0.88,0.45,0.22), smoothstep(0.05,0.8,slope));
  else if (uMode == 3) color = n * 0.5 + 0.5;
  else color = ramp(h) * (0.38 + 0.62 * max(dot(n, normalize(vec3(-0.45,0.85,0.35))),0.0));
  outColor = vec4(color,1.0);
}`;
function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("ไม่สามารถสร้าง Shader ได้");
  gl.shaderSource(shader, source); gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Shader compilation failed";
    gl.deleteShader(shader); throw new Error(message);
  }
  return shader;
}
function program(gl: WebGL2RenderingContext): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, vertexSource), fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const result = gl.createProgram();
  if (!result) throw new Error("ไม่สามารถสร้าง WebGL Program ได้");
  gl.attachShader(result, vs); gl.attachShader(result, fs); gl.linkProgram(result);
  gl.deleteShader(vs); gl.deleteShader(fs);
  if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(result) ?? "Program link failed");
  return result;
}
function normalize(v: number[]): number[] { const n = Math.hypot(...v); return v.map(x => x / n); }
function subtract(a: number[], b: number[]): number[] { return a.map((v,i) => v - b[i]); }
function cross(a: number[], b: number[]): number[] { return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]; }
function dot(a: number[], b: number[]): number { return a.reduce((s,v,i)=>s+v*b[i],0); }
function lookAt(eye: number[], center: number[], up: number[]): Float32Array {
  const z = normalize(subtract(eye,center)), x = normalize(cross(up,z)), y = cross(z,x);
  return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1]);
}
function ortho(left:number,right:number,bottom:number,top:number,near:number,far:number):Float32Array {
  return new Float32Array([2/(right-left),0,0,0,0,2/(top-bottom),0,0,0,0,-2/(far-near),0,-(right+left)/(right-left),-(top+bottom)/(top-bottom),-(far+near)/(far-near),1]);
}
function multiply(a: Float32Array,b:Float32Array):Float32Array {
  const out=new Float32Array(16);
  for(let c=0;c<4;c++)for(let r=0;r<4;r++)out[c*4+r]=a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3];
  return out;
}
const MODE: Record<TerrainViewMode,number>={shaded:0,elevation:1,slope:2,normals:3,wireframe:4};
export class TerrainPreviewRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly positionBuffer: WebGLBuffer;
  private readonly normalBuffer: WebGLBuffer;
  private readonly indexBuffer: WebGLBuffer;
  private readonly lineBuffer: WebGLBuffer;
  private triangleCount=0;
  private lineCount=0;
  private mode:TerrainViewMode="shaded";
  private readonly mvpLocation:WebGLUniformLocation;
  private readonly modelLocation:WebGLUniformLocation;
  private readonly modeLocation:WebGLUniformLocation;
  constructor(private readonly canvas:HTMLCanvasElement) {
    const gl=canvas.getContext("webgl2",{antialias:true,alpha:false,powerPreference:"low-power"});
    if(!gl)throw new Error("อุปกรณ์หรือเบราว์เซอร์นี้ไม่รองรับ WebGL2");
    this.gl=gl;this.program=program(gl);
    const vao=gl.createVertexArray(),p=gl.createBuffer(),n=gl.createBuffer(),i=gl.createBuffer(),l=gl.createBuffer();
    if(!vao||!p||!n||!i||!l)throw new Error("ไม่สามารถจองหน่วยความจำกราฟิกได้");
    this.vao=vao;this.positionBuffer=p;this.normalBuffer=n;this.indexBuffer=i;this.lineBuffer=l;
    this.mvpLocation=gl.getUniformLocation(this.program,"uMvp")!;
    this.modelLocation=gl.getUniformLocation(this.program,"uModel")!;
    this.modeLocation=gl.getUniformLocation(this.program,"uMode")!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER,p);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,n);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,i);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);
  }
  setMode(mode:TerrainViewMode):void{this.mode=mode;}
  setTerrain(field:Heightfield):void {
    const gl=this.gl,mesh=buildHeightfieldMesh(field,1);
    const lines=new Uint32Array((field.width-1)*field.height*2+(field.height-1)*field.width*2);
    let k=0;
    for(let z=0;z<field.height;z++)for(let x=0;x<field.width-1;x++){const a=z*field.width+x;lines[k++]=a;lines[k++]=a+1;}
    for(let x=0;x<field.width;x++)for(let z=0;z<field.height-1;z++){const a=z*field.width+x;lines[k++]=a;lines[k++]=a+field.width;}
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.positionBuffer);gl.bufferData(gl.ARRAY_BUFFER,mesh.positions,gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.normalBuffer);gl.bufferData(gl.ARRAY_BUFFER,mesh.normals,gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indexBuffer);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,mesh.indices,gl.STATIC_DRAW);
    // Upload the wireframe index buffer, then restore the triangle index buffer
    // while this VAO is still bound. ELEMENT_ARRAY_BUFFER binding is VAO state.
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.lineBuffer);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,lines,gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indexBuffer);
    gl.bindVertexArray(null);
    this.triangleCount=mesh.indices.length;this.lineCount=lines.length;
    this.render();
  }
  resize():void {
    const rect=this.canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,1.25);
    const w=Math.max(1,Math.round(rect.width*dpr)),h=Math.max(1,Math.round(rect.height*dpr));
    if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
    this.render();
  }
  render():void {
    const gl=this.gl;if(!this.triangleCount)return;
    gl.viewport(0,0,this.canvas.width,this.canvas.height);
    gl.clearColor(0.055,0.09,0.085,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    const aspect=this.canvas.width/Math.max(1,this.canvas.height),view=lookAt([2.7,2.35,3.2],[0,0.22,0],[0,1,0]);
    const projection=ortho(-1.8*aspect,1.8*aspect,-1.8,1.8,0.1,20);
    const mvp=multiply(projection,view),model=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
    gl.uniformMatrix4fv(this.mvpLocation,false,mvp);gl.uniformMatrix4fv(this.modelLocation,false,model);
    gl.uniform1i(this.modeLocation,MODE[this.mode]);
    gl.bindVertexArray(this.vao);
    if(this.mode==="wireframe"){gl.disable(gl.CULL_FACE);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.lineBuffer);gl.drawElements(gl.LINES,this.lineCount,gl.UNSIGNED_INT,0);gl.enable(gl.CULL_FACE);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indexBuffer);}
    else gl.drawElements(gl.TRIANGLES,this.triangleCount,gl.UNSIGNED_INT,0);
    gl.bindVertexArray(null);
  }
  dispose():void {
    const gl=this.gl;gl.deleteBuffer(this.positionBuffer);gl.deleteBuffer(this.normalBuffer);gl.deleteBuffer(this.indexBuffer);gl.deleteBuffer(this.lineBuffer);gl.deleteVertexArray(this.vao);gl.deleteProgram(this.program);
  }
}
