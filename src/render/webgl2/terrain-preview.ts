import { buildHeightfieldMesh } from "../../world/mesh/heightfield-mesh";
import { sampleElevation, type Heightfield } from "../../world/fields/heightfield";
import type { DrainageField } from "../../world/hydrology/drainage";
import type { RiverNetwork } from "../../world/hydrology/rivers";

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
  private waterVertexCount = 0;
  private maximumAccumulation = 1;
  private vertexCount = 0;
  private surfaceVertexCount = 0;
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
        this.playerYaw -= dx * 0.006;
        this.playerPitch = Math.max(-1.05, Math.min(1.05, this.playerPitch - dy * 0.004));
      } else {
        this.azimuth -= dx * 0.008;
        this.elevation = Math.max(0.16, Math.min(1.32, this.elevation + dy * 0.006));
      }
      this.render();
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
      this.render();
    }, { passive: false });
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
    this.render();
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

  movePlayer(forward: number, right: number): void {
    if (this.mode !== "first-person" || !this.field) return;
    const speed = 0.0003;
    const sin = Math.sin(this.playerYaw), cos = Math.cos(this.playerYaw);
    const dx = (-sin * forward + cos * right) * speed;
    const dz = (-cos * forward - sin * right) * speed;
    const b = this.field.bounds;
    const x = Math.max(b.minX + 0.008, Math.min(b.maxX - 0.008, this.playerX + dx));
    const z = Math.max(b.minZ + 0.008, Math.min(b.maxZ - 0.008, this.playerZ + dz));
    this.playerX = x;
    this.playerZ = z;
    this.render();
  }

  setTerrain(field: Heightfield): void {
    this.field = field;
    const gl = this.gl;
    const mesh = buildHeightfieldMesh(field, 1.18);
    this.vertexCount = mesh.vertexCount;
    this.surfaceVertexCount = field.width * field.height;
    this.waterVertexCount = 0;
    this.maximumAccumulation = 1;
    let minHeight = Infinity;
    let maxHeight = -Infinity;
    for (const value of field.values) {
      minHeight = Math.min(minHeight, value);
      maxHeight = Math.max(maxHeight, value);
    }
    const baseY = Math.min(0, minHeight * 1.18 - 0.012);
    const maxY = maxHeight * 1.18;
    this.cameraTarget = [
      (field.bounds.minX + field.bounds.maxX) * 0.5,
      baseY + (maxY - baseY) * 0.32,
      (field.bounds.minZ + field.bounds.maxZ) * 0.5,
    ];
    this.cameraRadius = Math.hypot(
      (field.bounds.maxX - field.bounds.minX) * 0.5,
      (maxY - baseY) * 0.5,
      (field.bounds.maxZ - field.bounds.minZ) * 0.5,
    );
    const zoomRatio = this.triangleCount > 0 ? this.distance / this.fitDistance : 0.46;
    this.updateCameraFit();
    this.distance = Math.max(this.fitDistance * 0.28, Math.min(this.fitDistance * 2.2, this.fitDistance * zoomRatio));
    const lines = new Uint32Array((field.width - 1) * field.height * 2 + (field.height - 1) * field.width * 2);
    let cursor = 0;
    for (let z = 0; z < field.height; z += 1) {
      for (let x = 0; x < field.width - 1; x += 1) {
        const index = z * field.width + x;
        lines[cursor++] = index;
        lines[cursor++] = index + 1;
      }
    }
    for (let x = 0; x < field.width; x += 1) {
      for (let z = 0; z < field.height - 1; z += 1) {
        const index = z * field.width + x;
        lines[cursor++] = index;
        lines[cursor++] = index + field.width;
      }
    }

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.lineBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, lines, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.accumulationBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.vertexCount), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.channelBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.vertexCount), gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);

    this.triangleCount = mesh.indices.length;
    this.lineCount = lines.length;
    this.render();
  }

  setHydrology(field: Heightfield, drainage: DrainageField, rivers: RiverNetwork): void {
    if (drainage.accumulation.length !== this.surfaceVertexCount || rivers.channelMask.length !== this.surfaceVertexCount) {
      throw new Error("Hydrology data does not match the terrain mesh");
    }
    const accumulation = new Float32Array(this.vertexCount);
    const channels = new Float32Array(this.vertexCount);
    for (let i = 0; i < this.surfaceVertexCount; i += 1) {
      accumulation[i] = drainage.accumulation[i];
      channels[i] = rivers.channelMask[i];
    }
    this.maximumAccumulation = Math.max(1, drainage.diagnostics.maximumAccumulation);
    const gl = this.gl;
    const water:number[]=[];
    const px=(index:number)=>field.bounds.minX+(index%field.width)/(field.width-1)*(field.bounds.maxX-field.bounds.minX);
    const pz=(index:number)=>field.bounds.minZ+Math.floor(index/field.width)/(field.height-1)*(field.bounds.maxZ-field.bounds.minZ);
    const py=(index:number)=>field.values[index]*1.18+0.014;
    for(const index of rivers.channelIndices){
      const next=rivers.downstream[index];if(next<0)continue;
      const ax=px(index),az=pz(index),bx=px(next),bz=pz(next);
      const dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz)||1;
      const nx=-dz/len,nz=dx/len;
      const wa=Math.max(rivers.width[index]*0.5,0.0015),wb=Math.max(rivers.width[next]*0.5,0.0015);
      const aL=[ax+nx*wa,py(index),az+nz*wa],aR=[ax-nx*wa,py(index),az-nz*wa];
      const bL=[bx+nx*wb,py(next),bz+nz*wb],bR=[bx-nx*wb,py(next),bz-nz*wb];
      water.push(...aL,...aR,...bL,...aR,...bR,...bL);
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
    gl.bindVertexArray(this.vao);

    if (this.mode === "wireframe") {
      gl.disable(gl.CULL_FACE);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.lineBuffer);
      gl.drawElements(gl.LINES, this.lineCount, gl.UNSIGNED_INT, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
      gl.enable(gl.CULL_FACE);
    } else {
      gl.drawElements(gl.TRIANGLES, this.triangleCount, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
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
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
    gl.deleteBuffer(this.waterBuffer);gl.deleteVertexArray(this.waterVao);gl.deleteProgram(this.waterProgram);
  }
}
