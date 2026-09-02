import { captureOffsets, clampDuration } from "../animation.js";
import {
  clampGridSize,
  createViewTransform,
  findAlphaBounds,
  generateGridMesh,
  resetDeformation,
} from "../mesh.js";

export function createMeshEditingController({
  state,
  elements,
  renderer,
  selectedPart,
  setStatus,
  render,
  documentRoot = document,
  requestFrame = (callback) => requestAnimationFrame(callback),
  cancelFrame = (handle) => cancelAnimationFrame(handle),
  now = () => performance.now(),
}) {
  function updateButtons() {
    const enabled = Boolean(state.image);
    elements.generateButton.disabled = !enabled;
    elements.resetButton.disabled = !state.mesh;
    elements.captureAButton.disabled = !state.mesh;
    elements.captureBButton.disabled = !state.mesh;
    const complete = Boolean(state.keyframes.a && state.keyframes.b);
    elements.playButton.disabled = !complete;
    elements.timeSlider.disabled = !complete;
    elements.editButton.disabled = !state.previewMode;
    elements.captureAButton.classList.toggle("recorded", Boolean(state.keyframes.a));
    elements.captureBButton.classList.toggle("recorded", Boolean(state.keyframes.b));
    elements.keyframeStatus.textContent =
      `A ${state.keyframes.a ? "●" : "―"}　B ${state.keyframes.b ? "●" : "―"}`;
    elements.playButton.textContent = state.playing ? "Ⅱ 一時停止" : "▶ プレビュー";
  }

  function duration() {
    return clampDuration(elements.durationInput.value);
  }

  function updateTimeDisplay() {
    elements.timeSlider.value = String(state.currentTime);
    elements.timeOutput.value = `${state.currentTime.toFixed(2)}s`;
    elements.timeOutput.textContent = `${state.currentTime.toFixed(2)}s`;
  }

  function stopPlayback() {
    state.playing = false;
    if (state.animationFrame !== null) cancelFrame(state.animationFrame);
    state.animationFrame = null;
    updateButtons();
  }

  function returnToEdit() {
    stopPlayback();
    state.previewMode = false;
    state.currentTime = 0;
    updateTimeDisplay();
    updateButtons();
    render();
  }

  function clearKeyframes() {
    stopPlayback();
    state.keyframes = { a: null, b: null };
    state.previewMode = false;
    state.currentTime = 0;
    updateTimeDisplay();
  }

  function createMesh() {
    if (!state.imageData || !state.image) return;
    const columns = clampGridSize(elements.columnsInput.value);
    const rows = clampGridSize(elements.rowsInput.value);
    elements.columnsInput.value = String(columns);
    elements.rowsInput.value = String(rows);
    const bounds = findAlphaBounds(state.imageData);
    if (!bounds) {
      setStatus("透明部分しかないパーツです");
      return;
    }
    state.mesh = generateGridMesh(
      bounds,
      state.image.width,
      state.image.height,
      columns,
      rows,
    );
    state.selected.clear();
    clearKeyframes();
    renderer.setMesh(state.mesh);
    updateButtons();
    render();
    const count = state.mesh.baseVertices.length / 2;
    const part = selectedPart();
    const prefix = state.mode === "psd" && part
      ? `${part.name}・`
      : "";
    setStatus(`${prefix}${columns} × ${rows} グリッド・${count}頂点`);
  }

  function setEditableImage(
    image,
    documentWidth,
    documentHeight,
    offsetX = 0,
    offsetY = 0,
  ) {
    const contextCanvas = documentRoot.createElement("canvas");
    contextCanvas.width = image.width;
    contextCanvas.height = image.height;
    const context = contextCanvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);

    state.image = image;
    state.imageData = context.getImageData(0, 0, image.width, image.height);
    state.documentWidth = documentWidth;
    state.documentHeight = documentHeight;
    state.partOffset = { x: offsetX, y: offsetY };
    if (!state.view) {
      state.view = createViewTransform(
        elements.viewportWrap.clientWidth,
        elements.viewportWrap.clientHeight,
        documentWidth,
        documentHeight,
      );
    }
    renderer.setTexture(image);
  }

  function clearMeshEditing() {
    state.image = null;
    state.imageData = null;
    state.mesh = null;
    state.partOffset = { x: 0, y: 0 };
    state.selected.clear();
    clearKeyframes();
    renderer.clearMesh();
    updateButtons();
  }

  function captureKeyframe(name) {
    stopPlayback();
    state.previewMode = false;
    state.keyframes[name] = captureOffsets(state.mesh.vertexOffsets);
    state.currentTime = 0;
    updateTimeDisplay();
    updateButtons();
    setStatus(`キーフレーム${name.toUpperCase()}を記録しました`);
    render();
  }

  function playbackFrame(timestamp) {
    if (!state.playing) return;
    const clipDuration = duration();
    state.currentTime = ((timestamp - state.playbackStartedAt) / 1000) % clipDuration;
    updateTimeDisplay();
    render();
    state.animationFrame = requestFrame(playbackFrame);
  }

  function bind() {
    elements.generateButton.addEventListener("click", createMesh);
    elements.resetButton.addEventListener("click", () => {
      returnToEdit();
      resetDeformation(state.mesh);
      state.selected.clear();
      setStatus("変形をリセットしました");
      render();
    });
    elements.captureAButton.addEventListener("click", () => captureKeyframe("a"));
    elements.captureBButton.addEventListener("click", () => captureKeyframe("b"));
    elements.playButton.addEventListener("click", () => {
      if (state.playing) {
        stopPlayback();
        return;
      }
      state.previewMode = true;
      state.playing = true;
      state.playbackStartedAt = now() - state.currentTime * 1000;
      updateButtons();
      state.animationFrame = requestFrame(playbackFrame);
      setStatus("A → B → A を無音プレビュー中");
    });
    elements.editButton.addEventListener("click", returnToEdit);
    elements.timeSlider.addEventListener("input", () => {
      stopPlayback();
      state.previewMode = true;
      state.currentTime = Number(elements.timeSlider.value);
      updateTimeDisplay();
      updateButtons();
      render();
    });
    elements.durationInput.addEventListener("change", () => {
      const value = duration();
      elements.durationInput.value = String(value);
      elements.timeSlider.max = String(value);
      state.currentTime = Math.min(state.currentTime, value);
      updateTimeDisplay();
      render();
    });
  }

  return {
    bind,
    clearMeshEditing,
    createMesh,
    duration,
    returnToEdit,
    setEditableImage,
    updateButtons,
  };
}
