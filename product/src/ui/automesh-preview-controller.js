import { cloneProject } from "../model/project.js";
import {
  DEFAULT_CONTOUR_AUTOMESH_SETTINGS,
  generateContourAutoMesh,
  normalizeAutoMeshSettings,
} from "../core/contour-automesh.js";

/** Owns only transient AutoMesh input, settings, candidate geometry, and diagnostics. */
export class AutoMeshPreviewController {
  constructor({ generator = generateContourAutoMesh, onChange = null } = {}) {
    this.generator = generator;
    this.onChange = onChange;
    this.settings = { ...DEFAULT_CONTOUR_AUTOMESH_SETTINGS };
    this.candidate = null;
    this.diagnostics = [];
  }

  notify(reason) { this.onChange?.(reason, this); }

  generate(imageData, { settings = {}, localBounds = null } = {}) {
    this.settings = normalizeAutoMeshSettings({ ...this.settings, ...settings });
    const result = this.generator(imageData, this.settings, localBounds);
    this.candidate = result.candidate ? cloneProject(result.candidate) : null;
    this.diagnostics = cloneProject(result.diagnostics);
    this.notify("automesh-preview");
    return this.getState();
  }

  clear() {
    this.candidate = null;
    this.diagnostics = [];
    this.notify("automesh-preview-cleared");
  }

  apply(meshTools, { replaceExisting = false } = {}) {
    if (!this.candidate || this.diagnostics.some(({ severity = "error" }) => severity === "error")) {
      throw new Error("Generate a valid AutoMesh preview before Apply.");
    }
    const result = meshTools.execute("topology.automesh", {
      candidate: cloneProject(this.candidate),
      replaceExisting,
    });
    this.clear();
    return result;
  }

  getState() {
    return {
      settings: { ...this.settings },
      candidate: this.candidate ? cloneProject(this.candidate) : null,
      diagnostics: cloneProject(this.diagnostics),
      vertexCount: this.candidate ? this.candidate.positions.length / 2 : 0,
      triangleCount: this.candidate ? this.candidate.indices.length / 3 : 0,
    };
  }
}
