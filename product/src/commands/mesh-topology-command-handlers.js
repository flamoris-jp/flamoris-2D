import { cloneProject } from "../model/project.js";
import { CommandError } from "./errors.js";

const TRIANGLE_AREA_EPSILON = 2e-4;

function topologyFor(project, topologyId) {
  const topology = project.meshTopologies.find((entry) => entry.id === topologyId);
  if (!topology) {
    throw new CommandError("MeshTopology does not exist.", "mesh_topology.not_found", {
      topologyId,
    });
  }
  return topology;
}

function advanceVertexSequence(topology, vertexId) {
  const match = /^vtx_(\d+)$/.exec(vertexId);
  if (!match) return;
  topology.nextVertexSequence = Math.max(
    Number.isSafeInteger(topology.nextVertexSequence) ? topology.nextVertexSequence : 1,
    Number(match[1]) + 1,
  );
}

function keyformFor(project, keyformId) {
  const keyform = project.meshKeyforms.find((entry) => entry.id === keyformId);
  if (!keyform) {
    throw new CommandError("MeshKeyform does not exist.", "mesh_keyform.not_found", {
      keyformId,
    });
  }
  return keyform;
}

function keyformsFor(project, topologyId) {
  return project.meshKeyforms.filter((entry) => entry.topologyId === topologyId);
}

function vertexIndex(topology, vertexId) {
  const index = topology.vertexIds.indexOf(vertexId);
  if (index < 0) {
    throw new CommandError("Stable vertex ID does not exist in this topology.",
      "MESH_TOPOLOGY_VERTEX_NOT_FOUND", { topologyId: topology.id, vertexId });
  }
  return index;
}

function snapshot(project, topology) {
  return {
    topology: cloneProject(topology),
    keyforms: keyformsFor(project, topology.id).map(cloneProject),
  };
}

function snapshotInverse(project, topology) {
  return {
    type: "mesh_topology.restore_snapshot",
    payload: { snapshot: snapshot(project, topology) },
  };
}

function restoreSnapshot(project, saved) {
  const topology = topologyFor(project, saved.topology.id);
  const inverse = snapshotInverse(project, topology);
  const topologyIndex = project.meshTopologies.findIndex((entry) => entry.id === topology.id);
  project.meshTopologies[topologyIndex] = cloneProject(saved.topology);
  for (const savedKeyform of saved.keyforms) {
    const index = project.meshKeyforms.findIndex((entry) => entry.id === savedKeyform.id);
    if (index < 0) {
      throw new CommandError("Topology snapshot references a missing MeshKeyform.",
        "MESH_TOPOLOGY_SNAPSHOT_INVALID", { keyformId: savedKeyform.id });
    }
    project.meshKeyforms[index] = cloneProject(savedKeyform);
  }
  return {
    inverse,
    affectedIds: [
      saved.topology.id,
      ...saved.topology.vertexIds,
      ...saved.keyforms.map((keyform) => keyform.id),
    ],
  };
}

function assertFinitePoint(point, label) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new CommandError(`${label} requires finite x/y coordinates.`,
      "MESH_TOPOLOGY_INITIALIZATION_INVALID");
  }
}

function assertNewVertexId(project, topology, vertexId) {
  const existing = project.meshTopologies
    .flatMap((topology) => topology.vertexIds || [])
    .includes(vertexId);
  if (existing) {
    throw new CommandError("Stable vertex ID already exists.",
      "MESH_TOPOLOGY_DUPLICATE_VERTEX", { vertexId });
  }
  const match = /^vtx_(\d+)$/.exec(vertexId);
  if (match && Number.isSafeInteger(topology.nextVertexSequence) &&
    Number(match[1]) < topology.nextVertexSequence) {
    throw new CommandError("Stable vertex ID was already issued by this topology.",
      "MESH_TOPOLOGY_VERTEX_ID_REUSED", {
        topologyId: topology.id,
        vertexId,
        nextVertexSequence: topology.nextVertexSequence,
      });
  }
}

function assertLabelAvailable(topology, vertexId, semanticLabel) {
  const owner = Object.entries(topology.vertexMetadata || {}).find(([candidateId, metadata]) =>
    candidateId !== vertexId && metadata?.semanticLabel === semanticLabel);
  if (owner) {
    throw new CommandError("Semantic label already exists in this topology.",
      "MESH_TOPOLOGY_DUPLICATE_SEMANTIC_LABEL", {
        topologyId: topology.id,
        vertexId,
        existingVertexId: owner[0],
        semanticLabel,
      });
  }
}

function twiceArea(positions, indices) {
  const [a, b, c] = indices;
  return (positions[b * 2] - positions[a * 2]) *
    (positions[c * 2 + 1] - positions[a * 2 + 1]) -
    (positions[b * 2 + 1] - positions[a * 2 + 1]) *
    (positions[c * 2] - positions[a * 2]);
}

function affectedIds(topology, keyforms, extra = []) {
  return [topology.id, ...keyforms.map((keyform) => keyform.id), ...extra];
}

export const meshTopologyCommandHandlers = {
  "mesh_keyform.move_vertices": (project, payload) => {
    const keyform = keyformFor(project, payload.keyformId);
    const previous = [...keyform.positions];
    keyform.positions = [...payload.positions];
    return {
      inverse: {
        type: "mesh_keyform.move_vertices",
        payload: { keyformId: keyform.id, positions: previous },
      },
      affectedIds: [keyform.id, keyform.topologyId],
    };
  },

  "mesh_topology.set_vertex_label": (project, payload) => {
    const topology = topologyFor(project, payload.topologyId);
    vertexIndex(topology, payload.vertexId);
    assertLabelAvailable(topology, payload.vertexId, payload.semanticLabel);
    const previous = topology.vertexMetadata?.[payload.vertexId]?.semanticLabel || null;
    topology.vertexMetadata ||= {};
    topology.vertexMetadata[payload.vertexId] = { semanticLabel: payload.semanticLabel };
    return {
      inverse: previous
        ? {
          type: "mesh_topology.set_vertex_label",
          payload: {
            topologyId: topology.id,
            vertexId: payload.vertexId,
            semanticLabel: previous,
          },
        }
        : {
          type: "mesh_topology.clear_vertex_label",
          payload: { topologyId: topology.id, vertexId: payload.vertexId },
        },
      affectedIds: [topology.id, payload.vertexId],
    };
  },

  "mesh_topology.clear_vertex_label": (project, payload) => {
    const topology = topologyFor(project, payload.topologyId);
    vertexIndex(topology, payload.vertexId);
    const previous = topology.vertexMetadata?.[payload.vertexId]?.semanticLabel;
    if (!previous) {
      throw new CommandError("Vertex has no semantic label.",
        "MESH_TOPOLOGY_SEMANTIC_LABEL_NOT_FOUND", { vertexId: payload.vertexId });
    }
    delete topology.vertexMetadata[payload.vertexId];
    return {
      inverse: {
        type: "mesh_topology.set_vertex_label",
        payload: {
          topologyId: topology.id,
          vertexId: payload.vertexId,
          semanticLabel: previous,
        },
      },
      affectedIds: [topology.id, payload.vertexId],
    };
  },

  "mesh_topology.add_vertex": (project, payload) => {
    const topology = topologyFor(project, payload.topologyId);
    assertNewVertexId(project, topology, payload.vertexId);
    assertFinitePoint(payload.position, "Position");
    assertFinitePoint(payload.uv, "UV");
    if (payload.semanticLabel) {
      assertLabelAvailable(topology, payload.vertexId, payload.semanticLabel);
    }
    const inverse = snapshotInverse(project, topology);
    const keyforms = keyformsFor(project, topology.id);
    topology.vertexIds.push(payload.vertexId);
    advanceVertexSequence(topology, payload.vertexId);
    if (payload.semanticLabel) {
      topology.vertexMetadata ||= {};
      topology.vertexMetadata[payload.vertexId] = {
        semanticLabel: payload.semanticLabel,
      };
    }
    for (const keyform of keyforms) {
      keyform.positions.push(payload.position.x, payload.position.y);
      keyform.uvs.push(payload.uv.x, payload.uv.y);
    }
    return {
      inverse,
      affectedIds: affectedIds(topology, keyforms, [payload.vertexId]),
    };
  },

  "mesh_topology.remove_vertex": (project, payload) => {
    const topology = topologyFor(project, payload.topologyId);
    const removedIndex = vertexIndex(topology, payload.vertexId);
    if (topology.vertexIds.length <= 3) {
      throw new CommandError("Removing this vertex would leave fewer than three vertices.",
        "MESH_TOPOLOGY_REMOVE_UNSAFE", { vertexId: payload.vertexId });
    }
    const nextIndices = [];
    for (let offset = 0; offset < topology.indices.length; offset += 3) {
      const triangle = topology.indices.slice(offset, offset + 3);
      if (triangle.includes(removedIndex)) continue;
      nextIndices.push(...triangle.map((index) => index > removedIndex ? index - 1 : index));
    }
    if (nextIndices.length === 0) {
      throw new CommandError("Removing this vertex would remove every triangle.",
        "MESH_TOPOLOGY_REMOVE_UNSAFE", { vertexId: payload.vertexId });
    }
    const inverse = snapshotInverse(project, topology);
    const keyforms = keyformsFor(project, topology.id);
    topology.vertexIds.splice(removedIndex, 1);
    topology.indices = nextIndices;
    if (topology.vertexMetadata) delete topology.vertexMetadata[payload.vertexId];
    for (const keyform of keyforms) {
      keyform.positions.splice(removedIndex * 2, 2);
      keyform.uvs.splice(removedIndex * 2, 2);
    }
    return {
      inverse,
      affectedIds: affectedIds(topology, keyforms, [payload.vertexId]),
    };
  },

  "mesh_topology.create_triangle": (project, payload) => {
    const topology = topologyFor(project, payload.topologyId);
    if (payload.vertexIds.length !== 3 || new Set(payload.vertexIds).size !== 3) {
      throw new CommandError("Triangle creation requires three distinct stable vertex IDs.",
        "MESH_TOPOLOGY_TRIANGLE_REPEATED_VERTEX");
    }
    const indices = payload.vertexIds.map((vertexId) => vertexIndex(topology, vertexId));
    const signature = [...indices].sort((a, b) => a - b).join(":");
    for (let offset = 0; offset < topology.indices.length; offset += 3) {
      if ([...topology.indices.slice(offset, offset + 3)].sort((a, b) => a - b).join(":") === signature) {
        throw new CommandError("Triangle already exists.",
          "MESH_TOPOLOGY_TRIANGLE_DUPLICATE");
      }
    }
    const keyforms = keyformsFor(project, topology.id);
    if (keyforms.some((keyform) => Math.abs(twiceArea(keyform.positions, indices)) <= TRIANGLE_AREA_EPSILON)) {
      throw new CommandError("Triangle is zero-area or near-degenerate in an affected MeshKeyform.",
        "MESH_TOPOLOGY_TRIANGLE_DEGENERATE");
    }
    const inverse = snapshotInverse(project, topology);
    topology.indices.push(...indices);
    return {
      inverse,
      affectedIds: affectedIds(topology, keyforms, payload.vertexIds),
    };
  },

  "mesh_topology.subdivide_edge": (project, payload) => {
    const topology = topologyFor(project, payload.topologyId);
    if (payload.vertexIds.length !== 2 || new Set(payload.vertexIds).size !== 2) {
      throw new CommandError("Edge subdivision requires two distinct stable vertex IDs.",
        "MESH_TOPOLOGY_EDGE_INVALID");
    }
    const [a, b] = payload.vertexIds.map((vertexId) => vertexIndex(topology, vertexId));
    assertNewVertexId(project, topology, payload.newVertexId);
    const triangles = [];
    let affectedTriangles = 0;
    const newIndex = topology.vertexIds.length;
    for (let offset = 0; offset < topology.indices.length; offset += 3) {
      const triangle = topology.indices.slice(offset, offset + 3);
      const direct = triangle.findIndex((value, index) =>
        value === a && triangle[(index + 1) % 3] === b);
      const reverse = triangle.findIndex((value, index) =>
        value === b && triangle[(index + 1) % 3] === a);
      const start = direct >= 0 ? direct : reverse;
      if (start < 0) {
        triangles.push(...triangle);
        continue;
      }
      affectedTriangles += 1;
      const first = triangle[start];
      const second = triangle[(start + 1) % 3];
      const third = triangle[(start + 2) % 3];
      triangles.push(first, newIndex, third, newIndex, second, third);
    }
    if (!affectedTriangles) {
      throw new CommandError("The selected vertices do not form an existing edge.",
        "MESH_TOPOLOGY_EDGE_NOT_FOUND", { vertexIds: payload.vertexIds });
    }
    const inverse = snapshotInverse(project, topology);
    const keyforms = keyformsFor(project, topology.id);
    topology.vertexIds.push(payload.newVertexId);
    advanceVertexSequence(topology, payload.newVertexId);
    topology.indices = triangles;
    for (const keyform of keyforms) {
      keyform.positions.push(
        (keyform.positions[a * 2] + keyform.positions[b * 2]) / 2,
        (keyform.positions[a * 2 + 1] + keyform.positions[b * 2 + 1]) / 2,
      );
      keyform.uvs.push(
        (keyform.uvs[a * 2] + keyform.uvs[b * 2]) / 2,
        (keyform.uvs[a * 2 + 1] + keyform.uvs[b * 2 + 1]) / 2,
      );
    }
    return {
      inverse,
      affectedIds: affectedIds(topology, keyforms, [
        ...payload.vertexIds,
        payload.newVertexId,
      ]),
    };
  },

  "mesh_topology.restore_snapshot": (project, payload) =>
    restoreSnapshot(project, payload.snapshot),
};
