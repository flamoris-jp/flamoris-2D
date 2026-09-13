import { ExportJobController, validateExportRequest } from "../core/export-job-controller.js";
import { FrameSequenceExportJob } from "../core/frame-sequence-export.js";
import {
  exportFrameRatePresets,
  exportResolutionPresets,
  transitionRenderAssetStatus,
} from "../core/export-settings.js";
import { createDesktopFrameSequenceSink } from "./desktop-frame-sequence-sink.js";
import { DesktopMp4ExportJob } from "./desktop-video-export.js";

function option(value, label) {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}

function selectOptions(select, entries, value) {
  select.replaceChildren(...entries);
  select.value = value ?? "";
}

function buildDialog() {
  const dialog = document.createElement("dialog");
  dialog.className = "app-dialog export-dialog";
  dialog.setAttribute("aria-labelledby", "exportDialogTitle");
  dialog.innerHTML = `
    <form method="dialog">
      <h2 id="exportDialogTitle">書き出し</h2>
      <label>トランジション
        <select data-export="transition"></select>
      </label>
      <label>解像度
        <select data-export="resolution-preset"></select>
      </label>
      <div class="field-grid">
        <label>幅 <input data-export="width" type="number" min="1" step="1" /></label>
        <label>高さ <input data-export="height" type="number" min="1" step="1" /></label>
      </div>
      <label>FPS
        <select data-export="fps-preset"></select>
      </label>
      <div class="field-grid">
        <label>Numerator <input data-export="fps-numerator" type="number" min="1" step="1" /></label>
        <label>Denominator <input data-export="fps-denominator" type="number" min="1" step="1" /></label>
      </div>
      <label>形式
        <select data-export="format">
          <option value="mp4">MP4 · H.264</option>
          <option value="png-sequence">PNG sequence</option>
        </select>
      </label>
      <dl class="identity-list">
        <div><dt>保存先</dt><dd><output data-export="destination">書き出し時に選択</output></dd></div>
      </dl>
      <progress data-export="progress" max="1" value="0"></progress>
      <output data-export="status" class="authoring-status">準備完了</output>
      <ul data-export="diagnostics" class="diagnostics-list"></ul>
      <div class="dialog-actions">
        <button data-export="close" type="button" class="secondary">閉じる</button>
        <button data-export="cancel" type="button" class="secondary" disabled>キャンセル</button>
        <button data-export="start" type="button">書き出す</button>
      </div>
    </form>`;
  document.body.append(dialog);
  return dialog;
}

function queryDialog(dialog, name) {
  return dialog.querySelector(`[data-export="${name}"]`);
}

function renderAssetsFromState(state) {
  return Array.isArray(state.psdParts) ? state.psdParts : [];
}

export function createExportDialogView({
  state,
  elements,
  setStatus,
  desktopApi = globalThis.flamorisDesktop || null,
} = {}) {
  const openButton = elements.exportOpenButton || document.createElement("button");
  if (!elements.exportOpenButton) {
    openButton.type = "button";
    openButton.className = "secondary";
    openButton.textContent = "書き出し…";
    openButton.title = "使用中のトランジションを書き出す";
    const anchor = elements.activeTransitionSelect?.closest("label") ||
      elements.activeTransitionSelect;
    anchor?.insertAdjacentElement("afterend", openButton);
  }

  const dialog = buildDialog();
  const transitionSelect = queryDialog(dialog, "transition");
  const resolutionPreset = queryDialog(dialog, "resolution-preset");
  const widthInput = queryDialog(dialog, "width");
  const heightInput = queryDialog(dialog, "height");
  const fpsPreset = queryDialog(dialog, "fps-preset");
  const fpsNumerator = queryDialog(dialog, "fps-numerator");
  const fpsDenominator = queryDialog(dialog, "fps-denominator");
  const formatSelect = queryDialog(dialog, "format");
  const destinationOutput = queryDialog(dialog, "destination");
  const progress = queryDialog(dialog, "progress");
  const statusOutput = queryDialog(dialog, "status");
  const diagnosticsList = queryDialog(dialog, "diagnostics");
  const closeButton = queryDialog(dialog, "close");
  const cancelButton = queryDialog(dialog, "cancel");
  const startButton = queryDialog(dialog, "start");

  const runners = {};
  if (desktopApi) {
    runners["png-sequence"] = new FrameSequenceExportJob({
      sequenceSink: createDesktopFrameSequenceSink(desktopApi),
    });
    runners.mp4 = new DesktopMp4ExportJob({ desktopApi });
  }
  const jobController = new ExportJobController({
    runners,
    onChange: () => render(),
  });

  function session() {
    return state.editor?.session || null;
  }

  function project() {
    return session()?.project || null;
  }

  function authoring() {
    return state.editor?.transitionAuthoring?.getState?.() || null;
  }

  function transitionLabel(transition) {
    return transition?.displayName || transition?.id || "Transition";
  }

  function applyResolutionPreset() {
    const preset = exportResolutionPresets(project())
      .find((entry) => entry.id === resolutionPreset.value);
    const custom = !preset || preset.id === "custom";
    if (!custom) {
      widthInput.value = String(preset.width);
      heightInput.value = String(preset.height);
    }
    widthInput.disabled = custom ? jobController.getState().status === "running" : true;
    heightInput.disabled = custom ? jobController.getState().status === "running" : true;
  }

  function applyFpsPreset() {
    const preset = exportFrameRatePresets(project())
      .find((entry) => entry.id === fpsPreset.value);
    const custom = !preset || preset.id === "custom";
    if (!custom) {
      fpsNumerator.value = String(preset.frameRate.numerator);
      fpsDenominator.value = String(preset.frameRate.denominator);
    }
    fpsNumerator.disabled = custom ? jobController.getState().status === "running" : true;
    fpsDenominator.disabled = custom ? jobController.getState().status === "running" : true;
  }

  function currentRequest() {
    const currentProject = project();
    const selectedTransition = (currentProject?.transitions || [])
      .find((entry) => entry.id === transitionSelect.value);
    return {
      project: currentProject,
      transitionId: transitionSelect.value,
      outputWidth: Number(widthInput.value),
      outputHeight: Number(heightInput.value),
      frameRate: {
        numerator: Number(fpsNumerator.value),
        denominator: Number(fpsDenominator.value),
      },
      format: formatSelect.value,
      renderAssets: renderAssetsFromState(state),
      suggestedName: `${currentProject?.displayName || "FLAMORIS"}-${transitionLabel(selectedTransition)}`,
    };
  }

  function preflight() {
    const request = currentRequest();
    const validation = validateExportRequest(request);
    const diagnostics = [...validation.diagnostics];
    if (!desktopApi) {
      diagnostics.push(Object.freeze({
        code: "export.desktop_required",
        message: "Phase 4 export requires the Windows Desktop application.",
      }));
    }
    if (validation.ok) {
      const assets = transitionRenderAssetStatus(
        request.project,
        request.transitionId,
        request.renderAssets,
      );
      if (!assets.ok) {
        diagnostics.push(Object.freeze({
          code: "export.render_assets_unavailable",
          message: assets.reason || "Required render assets are unavailable.",
          missingNodeIds: assets.missingNodeIds,
        }));
      }
    }
    return Object.freeze({ ok: diagnostics.length === 0, diagnostics, request });
  }

  function renderDiagnostics(entries) {
    diagnosticsList.replaceChildren();
    for (const entry of entries) {
      const item = document.createElement("li");
      item.textContent = `${entry.code}: ${entry.message}`;
      diagnosticsList.append(item);
    }
    diagnosticsList.hidden = entries.length === 0;
  }

  function render() {
    const currentProject = project();
    const transitionState = authoring();
    const activeTransitionId = transitionState?.activeTransition?.id || null;
    openButton.disabled = !desktopApi || !currentProject ||
      !(currentProject.transitions || []).length;
    if (!dialog.open) return;

    const running = jobController.getState().status === "running";
    const check = preflight();
    for (const control of [transitionSelect, resolutionPreset, fpsPreset, formatSelect]) {
      control.disabled = running;
    }
    applyResolutionPreset();
    applyFpsPreset();
    startButton.disabled = running || !check.ok;
    cancelButton.disabled = !running;
    closeButton.disabled = running;

    const jobState = jobController.getState();
    progress.value = jobState.progress?.ratio || 0;
    if (jobState.progress?.phase === "encoding") {
      statusOutput.textContent = "Encoding MP4…";
    } else if (jobState.progress?.totalFrames) {
      statusOutput.textContent = `Frame ${jobState.progress.completedFrames} / ${jobState.progress.totalFrames}`;
    } else if (jobState.status === "completed") {
      statusOutput.textContent = "Export complete";
    } else if (jobState.status === "cancelled") {
      statusOutput.textContent = "Export cancelled";
    } else if (jobState.status === "failed") {
      statusOutput.textContent = "Export failed";
    } else {
      statusOutput.textContent = check.ok ? "Ready" : "Export unavailable";
    }

    if (jobState.result?.destination) {
      destinationOutput.textContent = jobState.result.destination;
    }
    const diagnostics = jobState.diagnostics.length
      ? jobState.diagnostics
      : check.diagnostics;
    renderDiagnostics(diagnostics);

    if (!transitionSelect.value && activeTransitionId) {
      transitionSelect.value = activeTransitionId;
    }
  }

  function initialize() {
    const currentProject = project();
    const transitionState = authoring();
    const transitions = currentProject?.transitions || [];
    const activeTransitionId = transitionState?.activeTransition?.id ||
      transitions[0]?.id || "";
    selectOptions(
      transitionSelect,
      transitions.map((entry) => option(entry.id, transitionLabel(entry))),
      activeTransitionId,
    );

    const resolutionPresets = exportResolutionPresets(currentProject);
    selectOptions(
      resolutionPreset,
      resolutionPresets.map((entry) => option(entry.id, entry.label)),
      resolutionPresets.some((entry) => entry.id === "project") ? "project" : "custom",
    );
    const frameRatePresets = exportFrameRatePresets(currentProject);
    const projectRate = currentProject?.renderSettings?.frameRate;
    const defaultFpsId = frameRatePresets.find((entry) => entry.frameRate &&
      entry.frameRate.numerator === projectRate?.numerator &&
      entry.frameRate.denominator === projectRate?.denominator)?.id || "30";
    selectOptions(
      fpsPreset,
      frameRatePresets.map((entry) => option(entry.id, entry.label)),
      defaultFpsId,
    );
    formatSelect.value = desktopApi ? "mp4" : "png-sequence";
    destinationOutput.textContent = "書き出し時に選択";
    if (jobController.getState().status !== "running") jobController.reset();
    applyResolutionPreset();
    applyFpsPreset();
    render();
  }

  async function startExport() {
    const check = preflight();
    if (!check.ok) {
      render();
      return;
    }
    const result = await jobController.start(check.request);
    if (result.ok) {
      setStatus(`Export complete: ${result.destination || "output ready"}`);
    } else if (result.canceled) {
      setStatus("Export cancelled");
    } else {
      setStatus(result.diagnostics?.[0]?.message || "Export failed");
    }
    render();
  }

  openButton.addEventListener("click", () => {
    initialize();
    dialog.showModal();
    render();
  });
  closeButton.addEventListener("click", () => {
    if (jobController.getState().status !== "running") dialog.close();
  });
  cancelButton.addEventListener("click", () => jobController.cancel());
  startButton.addEventListener("click", startExport);
  dialog.addEventListener("cancel", (event) => {
    if (jobController.getState().status === "running") event.preventDefault();
  });
  resolutionPreset.addEventListener("change", () => {
    applyResolutionPreset();
    render();
  });
  fpsPreset.addEventListener("change", () => {
    applyFpsPreset();
    render();
  });
  for (const control of [transitionSelect, widthInput, heightInput,
    fpsNumerator, fpsDenominator, formatSelect]) {
    control.addEventListener("input", render);
    control.addEventListener("change", render);
  }

  return Object.freeze({
    open() {
      initialize();
      dialog.showModal();
      render();
    },
    render,
    controller: jobController,
  });
}
