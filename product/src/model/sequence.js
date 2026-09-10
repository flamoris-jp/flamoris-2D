import { cloneProject } from "./project.js";
import { canonicalizeClipInstances } from "./clip-instance.js";

export const VIEW_LANE_ITEM_KINDS = Object.freeze({
  KEY_ART_HOLD: "KeyArtHold",
  TRANSITION_INSTANCE: "TransitionInstance",
});

export function compareViewLaneItems(left, right) {
  return left.startTicks - right.startTicks ||
    left.endTicks - right.endTicks ||
    (String(left.id) < String(right.id) ? -1 : String(left.id) > String(right.id) ? 1 : 0);
}

export function canonicalizeViewLaneItems(items = []) {
  return cloneProject(items).sort(compareViewLaneItems);
}

export function normalizeSequence(sequence) {
  return {
    ...cloneProject(sequence),
    viewLaneItems: canonicalizeViewLaneItems(sequence.viewLaneItems || []),
    clipInstances: canonicalizeClipInstances(sequence.clipInstances || []),
    metadata: cloneProject(sequence.metadata || {}),
  };
}

export function createSequence({
  id,
  displayName,
  temporalProgramId,
  viewLaneItems = [],
  metadata = {},
}) {
  return normalizeSequence({
    id,
    displayName,
    temporalProgramId,
    viewLaneItems,
    clipInstances: [],
    metadata,
  });
}
