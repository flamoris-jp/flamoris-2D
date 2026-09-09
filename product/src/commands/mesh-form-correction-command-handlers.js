import { cloneProject } from "../model/project.js";
import {
  canonicalizeMeshFormVertexOffsets,
  createMeshFormCorrectionKeyform,
} from "../model/mesh-form-correction.js";
import { CommandError } from "./errors.js";

function collection(project) {
  if (!Array.isArray(project.meshFormCorrectionKeyforms)) {
    throw new CommandError("Missing meshFormCorrectionKeyforms collection.", "collection.invalid");
  }
  return project.meshFormCorrectionKeyforms;
}

function indexFor(project, keyformId) {
  const index = collection(project).findIndex((entry) => entry.id === keyformId);
  if (index < 0) throw new CommandError("MeshFormCorrectionKeyform does not exist.",
    "mesh_form.keyform_not_found", { keyformId });
  return index;
}

function remove(project, keyformId) {
  const values = collection(project);
  const index = indexFor(project, keyformId);
  const [removed] = values.splice(index, 1);
  return {
    inverse: { type: "mesh_form.restore_keyform", payload: { keyform: removed, index } },
    affectedIds: [removed.id, removed.topologyId, removed.keyArtId,
      removed.semanticSlotId, ...removed.vertexOffsets.map((entry) => entry.vertexId)],
  };
}

export const meshFormCorrectionCommandHandlers = {
  "mesh_form.create_keyform": (project, payload) => {
    const created = createMeshFormCorrectionKeyform(payload.keyform);
    collection(project).push(created);
    return {
      inverse: { type: "mesh_form.remove_keyform_internal", payload: { keyformId: created.id } },
      affectedIds: [created.id, created.topologyId, created.keyArtId, created.semanticSlotId],
    };
  },
  "mesh_form.set_vertex_offsets": (project, payload) => {
    const current = collection(project)[indexFor(project, payload.keyformId)];
    const previous = cloneProject(current.vertexOffsets);
    current.vertexOffsets = canonicalizeMeshFormVertexOffsets(payload.vertexOffsets);
    return {
      inverse: { type: "mesh_form.set_vertex_offsets", payload: {
        keyformId: current.id, vertexOffsets: previous,
      } },
      affectedIds: [current.id, current.topologyId, current.keyArtId,
        current.semanticSlotId, ...new Set([...previous, ...current.vertexOffsets]
          .map((entry) => entry.vertexId))],
    };
  },
  "mesh_form.reset_keyform": (project, payload) => remove(project, payload.keyformId),
  "mesh_form.remove_keyform_internal": (project, payload) => remove(project, payload.keyformId),
  "mesh_form.restore_keyform": (project, payload) => {
    const values = collection(project);
    const restored = createMeshFormCorrectionKeyform(payload.keyform);
    values.splice(Math.max(0, Math.min(values.length, payload.index)), 0, restored);
    return {
      inverse: { type: "mesh_form.remove_keyform_internal", payload: { keyformId: restored.id } },
      affectedIds: [restored.id, restored.topologyId, restored.keyArtId, restored.semanticSlotId],
    };
  },
};
