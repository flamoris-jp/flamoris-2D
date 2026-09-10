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

export function evaluateSequence(project, sequenceId, timeTicks) {
  const sequence = sequenceForId(project, sequenceId);
  if (!sequence) throw new Error("Unknown Sequence " + sequenceId + ".");
  const viewItem = resolveSequenceViewItem(project, sequenceId, timeTicks);
  if (!viewItem) throw new Error("Sequence ViewLane does not cover tick " + timeTicks + ".");
  if (viewItem.kind === VIEW_LANE_ITEM_KINDS.KEY_ART_HOLD) {
    const base = evaluateKeyArtBaseState(project, viewItem.keyArtId, {
      evaluationId: sequence.id + ":" + viewItem.id,
    });
    return {
      sequenceId: sequence.id,
      timeTicks,
      activeViewLaneItem: { ...structuredClone(viewItem), localTimeTicks: timeTicks - viewItem.startTicks },
      evaluatedParts: base.evaluatedParts,
      compositeGroups: base.compositeGroups,
      diagnostics: base.diagnostics,
    };
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
    const base = evaluateTransition(project, transition.id, localTimeTicks);
    return {
      sequenceId: sequence.id,
      timeTicks,
      activeViewLaneItem: { ...structuredClone(viewItem), localTimeTicks },
      evaluatedParts: base.evaluatedParts,
      compositeGroups: base.compositeGroups,
      diagnostics: base.diagnostics,
    };
  }
  throw new Error("Unsupported Sequence ViewLane item kind " + viewItem.kind + ".");
}
