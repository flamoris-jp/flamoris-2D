import {
  mixWeightedPremultiplied,
  createEvaluatedRenderPlan,
  rendererProofBatches,
} from "./core/evaluated-render.js";

export { mixWeightedPremultiplied };

export function prepareEvaluatedTransition(evaluatedTransition) {
  return rendererProofBatches(evaluatedTransition);
}

export { createEvaluatedRenderPlan };

function renderTargetSize(canvas, renderTarget) {
  const width = renderTarget?.viewportWidth ?? canvas.clientWidth ?? canvas.width;
  const height = renderTarget?.viewportHeight ?? canvas.clientHeight ?? canvas.height;
  if (!Number.isFinite(width) || width <= 0 ||
    !Number.isFinite(height) || height <= 0) {
    throw new RangeError("Composition render target dimensions must be positive and finite.");
  }
  return { width, height };
}

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_uv0;
in vec2 a_uv1;
uniform vec2 u_viewport;
uniform vec2 u_origin;
uniform vec2 u_partOffset;
uniform float u_scale;
uniform mat3 u_world;
out vec2 v_uv0;
out vec2 v_uv1;

void main() {
  vec2 documentPosition = (u_world * vec3(a_position + u_partOffset, 1.0)).xy;
  vec2 screen = u_origin + documentPosition * u_scale;
  vec2 clip = (screen / u_viewport) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv0 = a_uv0;
  v_uv1 = a_uv1;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_texture0;
uniform sampler2D u_texture1;
uniform vec2 u_appearanceWeights;
uniform int u_appearanceCount;
uniform float u_opacity;
uniform float u_contribution;
in vec2 v_uv0;
in vec2 v_uv1;
out vec4 outColor;

void main() {
  vec4 mixed = texture(u_texture0, v_uv0) * u_appearanceWeights.x;
  if (u_appearanceCount > 1) {
    mixed += texture(u_texture1, v_uv1) * u_appearanceWeights.y;
  }
  outColor = mixed * u_opacity * u_contribution;
}`;

const COMPOSITE_VERTEX_SHADER = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 position = gl_VertexID == 0 ? vec2(-1.0, -1.0)
    : gl_VertexID == 1 ? vec2(3.0, -1.0) : vec2(-1.0, 3.0);
  gl_Position = vec4(position, 0.0, 1.0);
  v_uv = position * 0.5 + 0.5;
}`;

const COMPOSITE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_accumulation;
in vec2 v_uv;
out vec4 outColor;
void main() { outColor = texture(u_accumulation, v_uv); }`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compilation failed: ${message}`);
  }
  return shader;
}

function createProgram(gl) {
  const program = gl.createProgram();
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Program linking failed: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

function createCompositeProgram(gl) {
  const program = gl.createProgram();
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, COMPOSITE_VERTEX_SHADER));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, COMPOSITE_FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Composite program linking failed: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

export class MeshRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl2", { alpha: true, antialias: true, premultipliedAlpha: true });
    if (!this.gl) throw new Error("WebGL 2 is not available in this browser.");

    const gl = this.gl;
    this.program = createProgram(gl);
    this.compositeProgram = createCompositeProgram(gl);
    this.vao = gl.createVertexArray();
    this.compositeVao = gl.createVertexArray();
    this.positionBuffer = gl.createBuffer();
    this.uvBuffers = [gl.createBuffer(), gl.createBuffer()];
    this.indexBuffer = gl.createBuffer();
    this.textures = [gl.createTexture(), gl.createTexture()];
    this.accumulationTexture = gl.createTexture();
    this.accumulationFramebuffer = gl.createFramebuffer();
    this.accumulationSize = { width: 0, height: 0 };
    this.indexCount = 0;

    this.locations = {
      position: gl.getAttribLocation(this.program, "a_position"),
      uv0: gl.getAttribLocation(this.program, "a_uv0"),
      uv1: gl.getAttribLocation(this.program, "a_uv1"),
      viewport: gl.getUniformLocation(this.program, "u_viewport"),
      origin: gl.getUniformLocation(this.program, "u_origin"),
      partOffset: gl.getUniformLocation(this.program, "u_partOffset"),
      scale: gl.getUniformLocation(this.program, "u_scale"),
      world: gl.getUniformLocation(this.program, "u_world"),
      texture0: gl.getUniformLocation(this.program, "u_texture0"),
      texture1: gl.getUniformLocation(this.program, "u_texture1"),
      appearanceWeights: gl.getUniformLocation(this.program, "u_appearanceWeights"),
      appearanceCount: gl.getUniformLocation(this.program, "u_appearanceCount"),
      opacity: gl.getUniformLocation(this.program, "u_opacity"),
      contribution: gl.getUniformLocation(this.program, "u_contribution"),
    };
    this.compositeLocation = gl.getUniformLocation(this.compositeProgram, "u_accumulation");

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(this.locations.position);
    gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);
    for (const [index, location] of [this.locations.uv0, this.locations.uv1].entries()) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffers[index]);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);

    for (const texture of [...this.textures, this.accumulationTexture]) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  setTexture(image) {
    this.uploadTexture(0, image);
  }

  uploadTexture(index, image) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + index);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[index]);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  }

  setMesh(mesh) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    for (const buffer of this.uvBuffers) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.uvs, gl.STATIC_DRAW);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    this.indexCount = mesh.indices.length;
  }

  clearMesh() {
    this.indexCount = 0;
  }

  ensureAccumulationTarget() {
    const gl = this.gl;
    const width = this.canvas.width;
    const height = this.canvas.height;
    if (this.accumulationSize.width === width && this.accumulationSize.height === height) return;
    this.accumulationSize = { width, height };
    gl.bindTexture(gl.TEXTURE_2D, this.accumulationTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.accumulationFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.accumulationTexture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("Transition preview accumulation framebuffer is incomplete.");
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  drawInstance(renderInstance, view, resolveArtwork, contribution = 1) {
    const gl = this.gl;
    const samples = renderInstance.appearanceSamples;
    const weightSum = samples.reduce((sum, sample) => sum + sample.weight, 0);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(renderInstance.mesh.positions), gl.DYNAMIC_DRAW);
    for (let index = 0; index < 2; index += 1) {
      const sample = samples[index] || samples[0];
      gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffers[index]);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(sample.uvs), gl.DYNAMIC_DRAW);
      this.uploadTexture(index, resolveArtwork(sample.sourceNodeId));
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(renderInstance.mesh.indices), gl.DYNAMIC_DRAW);
    const targetSize = renderTargetSize(this.canvas, view);
    gl.uniform2f(this.locations.viewport, targetSize.width, targetSize.height);
    gl.uniform2f(this.locations.origin, view.originX, view.originY);
    gl.uniform2f(this.locations.partOffset, 0, 0);
    gl.uniform1f(this.locations.scale, view.scale);
    const world = renderInstance.transform;
    gl.uniformMatrix3fv(this.locations.world, false, new Float32Array([
      world[0], world[1], 0, world[2], world[3], 0, world[4], world[5], 1,
    ]));
    gl.uniform1i(this.locations.texture0, 0);
    gl.uniform1i(this.locations.texture1, 1);
    gl.uniform2f(this.locations.appearanceWeights,
      samples[0].weight / weightSum, (samples[1]?.weight || 0) / weightSum);
    gl.uniform1i(this.locations.appearanceCount, samples.length);
    gl.uniform1f(this.locations.opacity, renderInstance.opacity);
    gl.uniform1f(this.locations.contribution, contribution);
    gl.drawElements(gl.TRIANGLES, renderInstance.mesh.indices.length, gl.UNSIGNED_INT, 0);
  }

  compositeAccumulation() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.compositeProgram);
    gl.bindVertexArray(this.compositeVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.accumulationTexture);
    gl.uniform1i(this.compositeLocation, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  renderEvaluated(plan, view, resolveArtwork) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (const batch of plan.batches) {
      if (batch.kind === "instance") {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        for (const renderInstance of batch.renderInstances) {
          this.drawInstance(renderInstance, view, resolveArtwork, 1);
        }
        continue;
      }
      this.ensureAccumulationTarget();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.accumulationFramebuffer);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      const weightSum = batch.renderInstances.reduce((sum, entry) => sum + entry.compositeWeight, 0);
      for (const renderInstance of batch.renderInstances) {
        this.drawInstance(renderInstance, view, resolveArtwork, renderInstance.compositeWeight / weightSum);
      }
      this.compositeAccumulation();
    }
  }

  render(
    vertices,
    view,
    partOffset = { x: 0, y: 0 },
    world = [1, 0, 0, 1, 0, 0],
    visible = true,
  ) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.indexCount || !visible) return;

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
    gl.uniform2f(this.locations.viewport, this.canvas.clientWidth, this.canvas.clientHeight);
    gl.uniform2f(this.locations.origin, view.originX, view.originY);
    gl.uniform2f(this.locations.partOffset, partOffset.x, partOffset.y);
    gl.uniform1f(this.locations.scale, view.scale);
    gl.uniformMatrix3fv(this.locations.world, false, new Float32Array([
      world[0], world[1], 0,
      world[2], world[3], 0,
      world[4], world[5], 1,
    ]));
    gl.uniform1i(this.locations.texture0, 0);
    gl.uniform1i(this.locations.texture1, 1);
    gl.uniform2f(this.locations.appearanceWeights, 1, 0);
    gl.uniform1i(this.locations.appearanceCount, 1);
    gl.uniform1f(this.locations.opacity, 1);
    gl.uniform1f(this.locations.contribution, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[0]);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
  }
}
