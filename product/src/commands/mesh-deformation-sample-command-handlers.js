import { cloneProject } from "../model/project.js";
import {
  canonicalizeMeshDeformationSamples,
  normalizeMeshDeformationSample,
} from "../model/mesh-deformation-sample.js";
import { CommandError } from "./errors.js";

function collection(project) {
  if (!Array.isArray(project.animation?.deformationSamples)) {
    throw new CommandError("Missing animation.deformationSamples collection.", "collection.invalid");
  }
  return project.animation.deformationSamples;
}

function sampleIndex(project, sampleId) {
  const index = collection(project).findIndex((entry) => entry.id === sampleId);
  if (index < 0) throw new CommandError(
    "Unknown MeshDeformationSample.",
    "animation.deformation_sample_not_found",
    { sampleId },
  );
  return index;
}

function sortSamples(project) {
  project.animation.deformationSamples = canonicalizeMeshDeformationSamples(collection(project));
}

function remove(project, sampleId) {
  const values = collection(project);
  const index = sampleIndex(project, sampleId);
  const [sample] = values.splice(index, 1);
  return {
    inverse: { type: "animation.deformation_sample.restore", payload: { sample, index } },
    affectedIds: [sample.id, sample.meshId, sample.topologyId,
      ...sample.offsets.map((entry) => entry.vertexId)],
  };
}

export const meshDeformationSampleCommandHandlers = {
  "animation.deformation_sample.create": (project, payload) => {
    const sample = normalizeMeshDeformationSample(payload.sample);
    if (collection(project).some((entry) => entry.id === sample.id)) {
      throw new CommandError("MeshDeformationSample ID already exists.", "identity.duplicate",
        { sampleId: sample.id });
    }
    collection(project).push(sample);
    sortSamples(project);
    return {
      inverse: { type: "animation.deformation_sample.remove_internal", payload: { sampleId: sample.id } },
      affectedIds: [sample.id, sample.meshId, sample.topologyId,
        ...sample.offsets.map((entry) => entry.vertexId)],
    };
  },
  "animation.deformation_sample.update": (project, payload) => {
    const index = sampleIndex(project, payload.sampleId);
    const previous = cloneProject(collection(project)[index]);
    const next = normalizeMeshDeformationSample(payload.sample);
    if (next.id !== payload.sampleId) {
      throw new CommandError("MeshDeformationSample updates must preserve stable identity.",
        "identity.changed");
    }
    collection(project)[index] = next;
    sortSamples(project);
    return {
      inverse: { type: "animation.deformation_sample.update", payload: {
        sampleId: previous.id, sample: previous,
      } },
      affectedIds: [next.id, previous.meshId, previous.topologyId, next.meshId, next.topologyId,
        ...new Set([...previous.offsets, ...next.offsets].map((entry) => entry.vertexId))],
    };
  },
  "animation.deformation_sample.remove": (project, payload) => remove(project, payload.sampleId),
  "animation.deformation_sample.remove_internal": (project, payload) => remove(project, payload.sampleId),
  "animation.deformation_sample.restore": (project, payload) => {
    const values = collection(project);
    const sample = normalizeMeshDeformationSample(payload.sample);
    values.splice(Math.max(0, Math.min(values.length, payload.index)), 0, sample);
    sortSamples(project);
    return {
      inverse: { type: "animation.deformation_sample.remove_internal", payload: { sampleId: sample.id } },
      affectedIds: [sample.id, sample.meshId, sample.topologyId,
        ...sample.offsets.map((entry) => entry.vertexId)],
    };
  },
};
