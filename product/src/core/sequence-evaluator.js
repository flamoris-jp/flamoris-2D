import { roundHalfUpRatio } from "./temporal.js";
import {
  evaluateKeyArtBaseState,
  evaluateTransition,
} from "./transition-evaluator.js";
import {
  VIEW_LANE_ITEM_KINDS,
  canonicalizeViewLaneItems,
} from "../model/sequence.js";
import { sequenceDurationTicks, sequenceForId } from "../model/sequence-validation.js";
import { semanticMappingFor } from "../model/transition-validation.js";
import {
  createSequenceAnimationContext,
  evaluateSequenceCamera,
  evaluateSequenceEvents,
  resolveActiveClipSamples,
  sortSequenceDiagnostics,
} from "./sequence-mixer.js";

export function projectTransitionInstanceTick(sequenceTick, viewItem, transitionDurationTicks) {
  if (!Number.isSafeInteger(sequenceTick) ||
    !Number.isSafeInteger(viewItem?.startTicks) ||
    !Number.isSafeInteger(viewItem?.endTicks) ||
    !Number.isSafeInteger(transitionDurationTicks) ||
    transitionDurationTicks <= 0 || sequenceTick < viewItem.startTicks ||
    sequenceTick > viewItem.endTicks || viewItem.startTicks >= viewItem.endTicks) {
    throw new RangeError("TransitionInstance tick projection requires a valid inclusive placement tick.");
  }
  if (sequenceTick === viewItem.startTicks) return 0;
  if (sequenceTick === viewItem.endTicks) return transitionDurationTicks;
  return roundHalfUpRatio(
    BigInt(sequenceTick - viewItem.startTicks) * BigInt(transitionDurationTicks),
    BigInt(viewItem.endTicks - viewItem.startTicks),
  );
}

export function resolveSequenceViewItem(project, sequenceId, timeTicks) {
  const sequence = sequenceForId(project, sequenceId);
  if (!sequence) throw new Error("Unknown Sequence " + sequenceId + ".");
  const durationTicks = sequenceDurationTicks(project, sequence);
  if (!Number.isSafeInteger(timeTicks) || timeTicks < 0 || timeTicks > durationTicks) {
    throw new RangeError("Sequence timeTicks must be within its owned TemporalProgram duration.");
  }
  const items = canonicalizeViewLaneItems(sequence.viewLaneItems);
  if (timeTicks === durationTicks) return items.at(-1) || null;
  return items.find((item) => item.startTicks <= timeTicks && timeTicks < item.endTicks) || null;
}

function addSemanticNode(result, slotId, mapping) {
  if (!mapping) return;
  const nodes = result.get(slotId) || new Set();
  nodes.add(mapping.nodeId);
  result.set(slotId, nodes);
}

function activeSemanticNodes(project, viewItem, localTimeTicks, transitionDurationTicks = null) {
  const result = new Map();
  if (viewItem.kind === VIEW_LANE_ITEM_KINDS.KEY_ART_HOLD) {
    for (const slot of project.semanticSlots) {
      addSemanticNode(result, slot.id, semanticMappingFor(slot, viewItem.keyArtId));
    }
    return result;
  }
  const transition = project.transitions.find((entry) => entry.id === viewItem.transitionId);
  if (!transition) return result;
  const partBySlot = new Map(transition.partTransitions.map((part) =>
    [part.semanticSlotId, part]));
  for (const slot of project.semanticSlots) {
    const from = semanticMappingFor(slot, transition.fromKeyArtId);
    const to = semanticMappingFor(slot, transition.toKeyArtId);
    if (localTimeTicks === 0) {
      addSemanticNode(result, slot.id, from);
      continue;
    }
    if (localTimeTicks === transitionDurationTicks) {
      addSemanticNode(result, slot.id, to);
      continue;
    }
    const part = partBySlot.get(slot.id);
    if (!part) continue;
    if (part.mode === "morph" || part.mode === "replace") {
      addSemanticNode(result, slot.id, from);
      addSemanticNode(result, slot.id, to);
    } else if (part.mode === "appear") {
      addSemanticNode(result, slot.id, to);
    } else if (part.mode === "hold") {
      addSemanticNode(result, slot.id,
        part.configuration?.holdEndpoint === "to" ? to : from || to);
    } else {
      addSemanticNode(result, slot.id, from);
    }
  }
  return result;
}

function activeClipProjection(active) {
  return {
    ...structuredClone(active.projection),
    weight: active.instance.weight,
    layer: active.instance.layer,
    visuallyContributing: active.instance.weight > 0,
  };
}

function finalizeSequenceFrame(sequence, timeTicks, viewItem, localTimeTicks, base,
  activeSamples, animation, camera, events) {
  const diagnostics = sortSequenceDiagnostics([
    ...base.diagnostics,
    ...animation.diagnostics,
  ]);
  return {
    sequenceId: sequence.id,
    timeTicks,
    activeViewLaneItem: { ...structuredClone(viewItem), localTimeTicks },
    activeClipInstances: activeSamples.map(activeClipProjection),
    evaluatedParts: base.evaluatedParts,
    compositeGroups: base.compositeGroups,
    camera,
    events,
    diagnostics,
    authoritative: !diagnostics.some((entry) => entry.severity === "error"),
  };
}

export function evaluateSequence(project, sequenceId, timeTicks) {
  const sequence = sequenceForId(project, sequenceId);
  if (!sequence) throw new Error("Unknown Sequence " + sequenceId + ".");
  const viewItem = resolveSequenceViewItem(project, sequenceId, timeTicks);
  if (!viewItem) throw new Error("Sequence ViewLane does not cover tick " + timeTicks + ".");
  const sequenceProgram = project.temporalPrograms.find((entry) =>
    entry.id === sequence.temporalProgramId);
  if (!sequenceProgram) throw new Error("Unknown TemporalProgram " + sequence.temporalProgramId + ".");
  const activeSamples = resolveActiveClipSamples(project, sequence, timeTicks);
  const camera = evaluateSequenceCamera(sequenceProgram, timeTicks);
  const events = evaluateSequenceEvents(sequenceProgram, timeTicks, activeSamples);
  if (viewItem.kind === VIEW_LANE_ITEM_KINDS.KEY_ART_HOLD) {
    const localTimeTicks = timeTicks - viewItem.startTicks;
    const animation = createSequenceAnimationContext(project, sequence, activeSamples, {
      activeSemanticNodes: activeSemanticNodes(project, viewItem, localTimeTicks),
    });
    const base = evaluateKeyArtBaseState(project, viewItem.keyArtId, {
      evaluationId: sequence.id + ":" + viewItem.id,
      animation,
    });
    return finalizeSequenceFrame(
      sequence, timeTicks, viewItem, localTimeTicks, base,
      activeSamples, animation, camera, events,
    );
  }
  if (viewItem.kind === VIEW_LANE_ITEM_KINDS.TRANSITION_INSTANCE) {
    const transition = project.transitions.find((entry) => entry.id === viewItem.transitionId);
    if (!transition) throw new Error("Unknown Transition " + viewItem.transitionId + ".");
    const transitionProgram = project.temporalPrograms.find((entry) =>
      entry.id === transition.temporalProgramId);
    if (!transitionProgram) throw new Error("Unknown TemporalProgram " + transition.temporalProgramId + ".");
    const localTimeTicks = projectTransitionInstanceTick(
      timeTicks, viewItem, transitionProgram.durationTicks,
    );
    const animation = createSequenceAnimationContext(project, sequence, activeSamples, {
      activeSemanticNodes: activeSemanticNodes(
        project, viewItem, localTimeTicks, transitionProgram.durationTicks,
      ),
    });
    const base = evaluateTransition(project, transition.id, localTimeTicks, { animation });
    return finalizeSequenceFrame(
      sequence, timeTicks, viewItem, localTimeTicks, base,
      activeSamples, animation, camera, events,
    );
  }
  throw new Error("Unsupported Sequence ViewLane item kind " + viewItem.kind + ".");
}
