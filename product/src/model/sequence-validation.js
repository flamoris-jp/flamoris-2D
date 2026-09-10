import {
  VIEW_LANE_ITEM_KINDS,
  canonicalizeViewLaneItems,
} from "./sequence.js";
import {
  evaluateKeyArtBaseState,
  evaluateTransition,
} from "../core/transition-evaluator.js";

function problem(code, path, message, entityId = null, details = null) {
  return {
    code,
    path,
    message,
    entityId,
    severity: "error",
    ...(details ? { details } : {}),
  };
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function hasExactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  return actual.length === canonical.length &&
    actual.every((key, index) => key === canonical[index]);
}

function endpointKeyArtIds(item, transitionById) {
  if (item.kind === VIEW_LANE_ITEM_KINDS.KEY_ART_HOLD) {
    return { start: item.keyArtId, end: item.keyArtId };
  }
  const transition = transitionById.get(item.transitionId);
  return transition
    ? { start: transition.fromKeyArtId, end: transition.toKeyArtId }
    : { start: null, end: null };
}

function baseSelectionsForTransition(project, transition, endpoint) {
  const keyArtId = endpoint === "start" ? transition.fromKeyArtId : transition.toKeyArtId;
  return [...(project.semanticSlots || [])]
    .filter((slot) => (slot.mappings || []).some((mapping) => mapping.keyArtId === keyArtId) ||
      transition.partTransitions.some((part) => part.semanticSlotId === slot.id))
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    .map((slot) => {
      const part = transition.partTransitions.find((entry) => entry.semanticSlotId === slot.id);
      const keyformId = endpoint === "start" ? part?.fromKeyformId : part?.toKeyformId;
      const keyform = (project.meshKeyforms || []).find((entry) => entry.id === keyformId);
      return { semanticSlotId: slot.id, keyformId: keyform?.id ?? null,
        topologyId: keyform?.topologyId ?? null };
    });
}

function normalizedEvaluatedParts(parts) {
  return parts.map((part) => ({
    semanticSlotId: part.semanticSlotId,
    presence: part.presence,
    renderInstances: part.renderInstances.map((renderInstance) => {
      const { renderInstanceId: ignored, clipping, ...rest } = renderInstance;
      return {
        ...rest,
        clipping: clipping ? {
          sourceNodeId: clipping.sourceNodeId ?? null,
          mode: clipping.mode,
        } : null,
      };
    }),
  }));
}

function endpointSignature(project, item, endpoint, transitionById) {
  if (item.kind === VIEW_LANE_ITEM_KINDS.KEY_ART_HOLD) {
    const base = evaluateKeyArtBaseState(project, item.keyArtId, { evaluationId: "sequence-validation" });
    return JSON.stringify({
      keyArtId: item.keyArtId,
      selections: base.baseSelections,
      evaluatedParts: normalizedEvaluatedParts(base.evaluatedParts),
    });
  }
  const transition = transitionById.get(item.transitionId);
  if (!transition) return null;
  const program = (project.temporalPrograms || []).find((entry) =>
    entry.id === transition.temporalProgramId);
  if (!program) return null;
  const timeTicks = endpoint === "start" ? 0 : program.durationTicks;
  const base = evaluateTransition(project, transition.id, timeTicks);
  return JSON.stringify({
    keyArtId: endpoint === "start" ? transition.fromKeyArtId : transition.toKeyArtId,
    selections: baseSelectionsForTransition(project, transition, endpoint),
    evaluatedParts: normalizedEvaluatedParts(base.evaluatedParts),
  });
}

export function sequenceForId(project, sequenceId) {
  return (project.sequences || []).find((sequence) => sequence.id === sequenceId) || null;
}

export function sequenceDurationTicks(project, sequence) {
  return (project.temporalPrograms || [])
    .find((program) => program.id === sequence?.temporalProgramId)?.durationTicks ?? null;
}

export function validateSequences(project, register = () => {}) {
  const issues = [];
  if (!Array.isArray(project.sequences)) {
    return [problem("collection.invalid", "sequences", "sequences must be an array.")];
  }
  const programById = new Map((project.temporalPrograms || []).map((entry) => [entry?.id, entry]));
  const keyArtById = new Map((project.keyArts || []).map((entry) => [entry?.id, entry]));
  const transitionById = new Map((project.transitions || []).map((entry) => [entry?.id, entry]));

  for (const [sequenceIndex, sequence] of project.sequences.entries()) {
    const path = "sequences." + sequenceIndex;
    if (!object(sequence)) {
      issues.push(problem("SEQUENCE_INVALID", path, "Sequence must be an object."));
      continue;
    }
    if (!hasExactKeys(sequence, [
      "id", "displayName", "temporalProgramId", "viewLaneItems", "clipInstances", "metadata",
    ])) {
      issues.push(problem(
        "SEQUENCE_INVALID",
        path,
        "Sequence contains missing or unsupported persistent fields; duration belongs only to TemporalProgram.",
        sequence.id,
      ));
    }
    if (!nonEmpty(sequence.displayName)) {
      issues.push(problem("SEQUENCE_INVALID", path + ".displayName", "Sequence displayName is required.", sequence.id));
    }
    const program = programById.get(sequence.temporalProgramId);
    if (!program) {
      issues.push(problem(
        "SEQUENCE_PROGRAM_REFERENCE_INVALID",
        path + ".temporalProgramId",
        "Sequence TemporalProgram does not exist.",
        sequence.id,
      ));
    }
    if (!object(sequence.metadata)) {
      issues.push(problem("SEQUENCE_INVALID", path + ".metadata", "Sequence metadata must be an object.", sequence.id));
    }
    if (!Array.isArray(sequence.clipInstances)) {
      issues.push(problem("SEQUENCE_INVALID", path + ".clipInstances", "clipInstances must be an array.", sequence.id));
    } else if (sequence.clipInstances.length) {
      issues.push(problem(
        "ANIMATION_CLIP_INSTANCE_UNSUPPORTED",
        path + ".clipInstances",
        "ClipInstance persistence is introduced by Phase 8-2.",
        sequence.id,
      ));
    }
    if (!Array.isArray(sequence.viewLaneItems)) {
      issues.push(problem("SEQUENCE_INVALID", path + ".viewLaneItems", "viewLaneItems must be an array.", sequence.id));
      continue;
    }

    const items = canonicalizeViewLaneItems(sequence.viewLaneItems);
    for (const [itemIndex, item] of items.entries()) {
      const itemPath = path + ".viewLaneItems." + itemIndex;
      if (!object(item)) {
        issues.push(problem("SEQUENCE_VIEW_ITEM_INVALID", itemPath, "ViewLane item must be an object.", sequence.id));
        continue;
      }
      register(item.id, itemPath + ".id");
      const hold = item.kind === VIEW_LANE_ITEM_KINDS.KEY_ART_HOLD;
      const instance = item.kind === VIEW_LANE_ITEM_KINDS.TRANSITION_INSTANCE;
      if (!hold && !instance) {
        issues.push(problem("SEQUENCE_VIEW_ITEM_INVALID", itemPath + ".kind", "ViewLane supports only KeyArtHold and TransitionInstance.", item.id));
        continue;
      }
      const expected = hold
        ? ["id", "kind", "keyArtId", "startTicks", "endTicks"]
        : ["id", "kind", "transitionId", "startTicks", "endTicks"];
      if (!hasExactKeys(item, expected)) {
        issues.push(problem("SEQUENCE_VIEW_ITEM_INVALID", itemPath, "ViewLane item contains missing or unsupported fields.", item.id));
      }
      if (!Number.isSafeInteger(item.startTicks) || !Number.isSafeInteger(item.endTicks) ||
        item.startTicks < 0 || item.startTicks >= item.endTicks ||
        (program && item.endTicks > program.durationTicks)) {
        issues.push(problem(
          "SEQUENCE_INVALID_TIME",
          itemPath,
          "ViewLane item must satisfy 0 <= startTicks < endTicks <= Sequence duration.",
          item.id,
        ));
      }
      if (hold && !keyArtById.has(item.keyArtId)) {
        issues.push(problem("SEQUENCE_KEYART_REFERENCE_INVALID", itemPath + ".keyArtId", "KeyArtHold KeyArt does not exist.", item.id));
      }
      if (hold && keyArtById.has(item.keyArtId)) {
        for (const slot of project.semanticSlots || []) {
          if (!(slot.mappings || []).some((mapping) => mapping.keyArtId === item.keyArtId)) continue;
          const candidates = (project.meshKeyforms || [])
            .filter((keyform) => keyform.keyArtId === item.keyArtId && keyform.semanticSlotId === slot.id)
            .map((keyform) => keyform.id)
            .sort();
          if (candidates.length > 1) {
            issues.push(problem(
              "SEQUENCE_KEYART_BASE_AMBIGUOUS",
              itemPath + ".keyArtId",
              "Standalone KeyArt base state has multiple compatible MeshKeyforms.",
              item.id,
              { keyArtId: item.keyArtId, semanticSlotId: slot.id, keyformIds: candidates },
            ));
          }
        }
      }
      if (instance && !transitionById.has(item.transitionId)) {
        issues.push(problem("SEQUENCE_TRANSITION_REFERENCE_INVALID", itemPath + ".transitionId", "TransitionInstance Transition does not exist.", item.id));
      }
    }

    if (!program || items.length === 0) {
      if (program && items.length === 0) {
        issues.push(problem("SEQUENCE_VIEW_GAP", path + ".viewLaneItems", "ViewLane must cover the complete Sequence duration.", sequence.id));
      }
      continue;
    }
    if (items[0]?.startTicks !== 0) {
      issues.push(problem("SEQUENCE_VIEW_GAP", path + ".viewLaneItems", "The first ViewLane item must start at tick 0.", sequence.id));
    }
    for (let index = 1; index < items.length; index += 1) {
      const previous = items[index - 1];
      const current = items[index];
      if (!object(previous) || !object(current)) continue;
      if (previous.endTicks < current.startTicks) {
        issues.push(problem("SEQUENCE_VIEW_GAP", path + ".viewLaneItems", "Adjacent ViewLane items must be contiguous.", sequence.id, {
          previousItemId: previous.id,
          nextItemId: current.id,
        }));
      } else if (previous.endTicks > current.startTicks) {
        issues.push(problem("SEQUENCE_VIEW_OVERLAP", path + ".viewLaneItems", "ViewLane items must not overlap.", sequence.id, {
          previousItemId: previous.id,
          nextItemId: current.id,
        }));
      }
      const outgoing = endpointKeyArtIds(previous, transitionById).end;
      const incoming = endpointKeyArtIds(current, transitionById).start;
      if (outgoing && incoming && outgoing !== incoming) {
        issues.push(problem(
          "SEQUENCE_VIEW_CONTINUITY_MISMATCH",
          path + ".viewLaneItems",
          "Adjacent ViewLane endpoints must resolve to the same KeyArt.",
          sequence.id,
          { previousItemId: previous.id, nextItemId: current.id, outgoingKeyArtId: outgoing, incomingKeyArtId: incoming },
        ));
      } else if (outgoing && incoming) {
        try {
          const outgoingSignature = endpointSignature(project, previous, "end", transitionById);
          const incomingSignature = endpointSignature(project, current, "start", transitionById);
          if (outgoingSignature && incomingSignature && outgoingSignature !== incomingSignature) {
            issues.push(problem(
              "SEQUENCE_VIEW_ENDPOINT_INCOMPATIBLE",
              path + ".viewLaneItems",
              "Adjacent ViewLane items resolve incompatible evaluated endpoint state.",
              sequence.id,
              { previousItemId: previous.id, nextItemId: current.id, keyArtId: outgoing },
            ));
          }
        } catch {
          // Reference/domain diagnostics remain authoritative when endpoint
          // evaluation cannot be formed from an already-invalid Project.
        }
      }
    }
    if (items.at(-1)?.endTicks !== program.durationTicks) {
      issues.push(problem("SEQUENCE_VIEW_GAP", path + ".viewLaneItems", "The last ViewLane item must end at Sequence duration.", sequence.id));
    }
  }
  return issues;
}
