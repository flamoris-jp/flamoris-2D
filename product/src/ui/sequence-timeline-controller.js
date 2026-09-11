import {
  TEMPORAL_TRACK_DEFINITIONS,
  temporalChannelDefinition,
} from "../core/temporal.js";
import { CLIP_LOOP_MODES } from "../model/animation-clip.js";
import { cloneProject } from "../model/project.js";
import {
  temporalTrackKindsForOwner,
} from "../model/temporal-program-ownership.js";
import { VIEW_LANE_ITEM_KINDS } from "../model/sequence.js";
import {
  TIMELINE_DISPLAY_UNITS,
  TIMELINE_PLAYBACK_MODES,
  TransientPlaybackClock,
  clampTimelineTick,
  projectTimelineItems,
  projectTimelineTime,
} from "./timeline-primitives.js";

function defaultIdFactory() {
  let sequence = 0;
  const nonce = Date.now().toString(36);
  return (kind) => `${kind}_${nonce}_${String(++sequence).padStart(4, "0")}`;
}

function persistentOwner(value) {
  if (!value) return null;
  const { durationTicks: ignored, ...owner } = value;
  return cloneProject(owner);
}

function compareText(left, right) {
  return String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0;
}

function canonicalViewItems(items) {
  return [...items].map(cloneProject).sort((left, right) =>
    left.startTicks - right.startTicks || left.endTicks - right.endTicks ||
    compareText(left.id, right.id));
}

function validateViewPlacement(items, durationTicks) {
  const ordered = canonicalViewItems(items);
  if (!ordered.length) throw new Error("ViewLane must contain at least one item.");
  if (ordered[0].startTicks !== 0) throw new Error("ViewLane must start at tick 0.");
  for (const [index, item] of ordered.entries()) {
    if (!Number.isSafeInteger(item.startTicks) || !Number.isSafeInteger(item.endTicks) ||
      item.startTicks < 0 || item.startTicks >= item.endTicks || item.endTicks > durationTicks) {
      throw new Error(`ViewLane item ${item.id} must have a positive in-range duration.`);
    }
    if (index && ordered[index - 1].endTicks !== item.startTicks) {
      throw new Error("ViewLane items must remain contiguous without gaps or overlap.");
    }
  }
  if (ordered.at(-1).endTicks !== durationTicks) {
    throw new Error("ViewLane must end at the Sequence duration.");
  }
  return ordered;
}

function normalizedError(error) {
  const issues = Array.isArray(error?.issues) ? error.issues :
    Array.isArray(error?.details?.issues) ? error.details.issues : [];
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
    issues: cloneProject(issues),
  };
}

function gcd(left, right) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) [a, b] = [b, a % b];
  return a;
}

export function normalizePlaybackRate(numerator, denominator) {
  if (!Number.isSafeInteger(numerator) || numerator <= 0 ||
    !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError("Playback rate requires positive safe-integer numerator and denominator.");
  }
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function interpolation(kind, controls = {}) {
  if (kind === "step" || kind === "linear") return { kind };
  if (kind !== "bezier") throw new Error(`Unknown interpolation ${kind}.`);
  return {
    kind,
    x1: Number(controls.x1), y1: Number(controls.y1),
    x2: Number(controls.x2), y2: Number(controls.y2),
  };
}

function defaultChannelValue(definition, { deformationSampleId = null } = {}) {
  if (definition.value === "positive-number") return 1;
  if (definition.value === "unit-number") return 1;
  if (definition.value === "integer") return 0;
  if (definition.value === "presence") return "present";
  if (definition.value === "clipping") return { sourceNodeId: null };
  if (definition.value === "deformation") {
    if (!deformationSampleId) {
      throw new Error("Choose a compatible MeshDeformationSample before adding this keyframe.");
    }
    return { deformationSampleId, weight: 1 };
  }
  return 0;
}

function targetLabel(target) {
  if (target?.cameraId) return "Camera · main";
  if (target?.semanticSlotId) return `SemanticSlot · ${target.semanticSlotId}`;
  if (target?.nodeId) return `Node · ${target.nodeId}`;
  if (target?.boneId) return `Bone · ${target.boneId}`;
  if (target?.meshId) return `Mesh · ${target.meshId}`;
  if (target?.deformerId) return `Deformer · ${target.deformerId} / ${target.controlPointId}`;
  return "Unknown target";
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Owns only transient Sequence timeline state. All persistent edits cross the
 * existing Command/Transaction boundary and every preview is query-backed.
 */
export class SequenceTimelineController {
  constructor(session, {
    onChange = null,
    idFactory = defaultIdFactory(),
    scheduleFrame,
    cancelFrame,
  } = {}) {
    this.session = session;
    this.onChange = onChange;
    this.idFactory = idFactory;
    this.selectedSequenceId = null;
    this.selectedViewItemId = null;
    this.selectedClipId = null;
    this.selectedClipInstanceId = null;
    this.ownerContext = null;
    this.selectedTrackId = null;
    this.selectedKeyframe = null;
    this.currentTick = 0;
    this.displayUnit = "ticks";
    this.viewPreview = new Map();
    this.clipPreview = new Map();
    this.keyframePreview = null;
    this.evaluation = null;
    this.evaluationError = null;
    this.renderReport = null;
    this.operationError = null;
    this.clock = new TransientPlaybackClock({
      onTick: (tick) => this.scrubToTick(tick, { notify: false }),
      onStateChange: (reason) => this.notify(`sequence-playback-${reason}`),
      ...(scheduleFrame ? { scheduleFrame } : {}),
      ...(cancelFrame ? { cancelFrame } : {}),
    });
  }

  notify(reason) {
    this.onChange?.(reason, this);
  }

  mutate(callback) {
    try {
      const result = callback();
      this.operationError = null;
      return result;
    } catch (error) {
      this.operationError = normalizedError(error);
      this.notify("sequence-operation-error");
      throw error;
    }
  }

  sequenceList() {
    return this.session.query("sequence.list");
  }

  activeSequence() {
    return this.selectedSequenceId
      ? this.session.query("sequence.get", { sequenceId: this.selectedSequenceId })
      : null;
  }

  clipList() {
    return this.session.query("animation.clip.list");
  }

  selectedClip() {
    return this.selectedClipId
      ? this.session.query("animation.clip.get", { clipId: this.selectedClipId })
      : null;
  }

  activeOwner() {
    if (this.ownerContext?.kind === "Sequence") {
      return this.sequenceList().find((entry) => entry.id === this.ownerContext.id) || null;
    }
    if (this.ownerContext?.kind === "AnimationClip") {
      return this.clipList().find((entry) => entry.id === this.ownerContext.id) || null;
    }
    return null;
  }

  activeProgram() {
    const owner = this.activeOwner();
    return owner
      ? this.session.query("animation.get_program", { programId: owner.temporalProgramId })
      : null;
  }

  selectSequence(sequenceId) {
    if (sequenceId !== null && !this.sequenceList().some((entry) => entry.id === sequenceId)) {
      throw new Error(`Unknown Sequence ${sequenceId}.`);
    }
    this.clock.pause();
    this.selectedSequenceId = sequenceId;
    this.selectedViewItemId = null;
    this.selectedClipInstanceId = null;
    this.viewPreview.clear();
    this.clipPreview.clear();
    this.currentTick = 0;
    this.evaluation = null;
    this.evaluationError = null;
    if (sequenceId) {
      this.ownerContext = { kind: "Sequence", id: sequenceId };
      this.selectedTrackId = null;
      this.selectedKeyframe = null;
      this.evaluate();
    } else if (this.ownerContext?.kind === "Sequence") {
      this.ownerContext = null;
      this.selectedTrackId = null;
      this.selectedKeyframe = null;
    }
    this.notify("sequence-selection");
  }

  selectViewItem(viewItemId) {
    const sequence = this.activeSequence();
    if (viewItemId !== null && !sequence?.viewLaneItems.some((entry) => entry.id === viewItemId)) {
      throw new Error(`Unknown ViewLane item ${viewItemId}.`);
    }
    this.selectedViewItemId = viewItemId;
    this.notify("sequence-view-selection");
  }

  selectClip(clipId, { editProgram = true } = {}) {
    if (clipId !== null && !this.clipList().some((entry) => entry.id === clipId)) {
      throw new Error(`Unknown AnimationClip ${clipId}.`);
    }
    this.selectedClipId = clipId;
    if (editProgram) {
      this.ownerContext = clipId ? { kind: "AnimationClip", id: clipId } : null;
      this.selectedTrackId = null;
      this.selectedKeyframe = null;
    }
    this.notify("sequence-clip-selection");
  }

  editSequenceProgram() {
    const sequence = this.activeSequence();
    if (!sequence) throw new Error("Select a Sequence first.");
    this.ownerContext = { kind: "Sequence", id: sequence.id };
    this.selectedTrackId = null;
    this.selectedKeyframe = null;
    this.notify("sequence-owner-context");
  }

  createSequence({
    displayName,
    durationTicks,
    keyArtId,
    sequenceId = this.idFactory("sequence"),
    programId = this.idFactory("program"),
    viewItemId = this.idFactory("view"),
  }) {
    return this.mutate(() => {
      this.session.query("keyart.get", { keyArtId });
      const result = this.session.executeTransaction([
        {
          type: "animation.temporal.create_program",
          payload: { programId, durationTicks },
        },
        {
          type: "sequence.create",
          payload: { sequence: {
            id: sequenceId,
            displayName,
            temporalProgramId: programId,
            viewLaneItems: [{
              id: viewItemId,
              kind: VIEW_LANE_ITEM_KINDS.KEY_ART_HOLD,
              keyArtId,
              startTicks: 0,
              endTicks: durationTicks,
            }],
            clipInstances: [],
            metadata: {},
          } },
        },
      ], { label: "Create Sequence" });
      this.selectedSequenceId = sequenceId;
      this.selectedViewItemId = viewItemId;
      this.ownerContext = { kind: "Sequence", id: sequenceId };
      this.currentTick = 0;
      this.evaluate();
      return { ...result, sequenceId, programId, viewItemId };
    });
  }

  renameSequence(displayName) {
    return this.mutate(() => {
      const sequence = this.activeSequence();
      if (!sequence) throw new Error("Select a Sequence first.");
      return this.session.execute({
        type: "sequence.update",
        payload: {
          sequenceId: sequence.id,
          sequence: { ...persistentOwner(sequence), displayName },
        },
      }, { label: "Rename Sequence" });
    });
  }

  removeSequence() {
    return this.mutate(() => {
      const sequence = this.activeSequence();
      if (!sequence) throw new Error("Select a Sequence first.");
      const result = this.session.executeTransaction([
        { type: "sequence.remove", payload: { sequenceId: sequence.id } },
        { type: "animation.temporal.remove_program", payload: { programId: sequence.temporalProgramId } },
      ], { label: "Remove Sequence" });
      this.clock.pause();
      this.selectedSequenceId = null;
      this.selectedViewItemId = null;
      this.selectedClipInstanceId = null;
      if (this.ownerContext?.kind === "Sequence" && this.ownerContext.id === sequence.id) {
        this.ownerContext = null;
        this.selectedTrackId = null;
        this.selectedKeyframe = null;
      }
      this.currentTick = 0;
      this.evaluation = null;
      return result;
    });
  }

  setSequenceDuration(durationTicks) {
    return this.mutate(() => {
      const sequence = this.activeSequence();
      if (!sequence) throw new Error("Select a Sequence first.");
      if (!Number.isSafeInteger(durationTicks) || durationTicks <= 0) {
        throw new RangeError("Sequence duration must be a positive integer tick.");
      }
      const items = canonicalViewItems(sequence.viewLaneItems);
      const last = items.at(-1);
      if (!last || durationTicks <= last.startTicks) {
        throw new Error("Sequence duration must remain after the last ViewLane boundary.");
      }
      const nextLast = { ...last, endTicks: durationTicks };
      const result = this.session.executeTransaction([
        {
          type: "animation.temporal.set_duration",
          payload: { programId: sequence.temporalProgramId, durationTicks },
        },
        {
          type: "sequence.update_view_item",
          payload: { sequenceId: sequence.id, viewItemId: last.id, viewItem: nextLast },
        },
      ], { label: "Set Sequence duration" });
      this.currentTick = clampTimelineTick(this.currentTick, durationTicks);
      return result;
    });
  }

  viewCommands(nextItems) {
    const sequence = this.activeSequence();
    if (!sequence) throw new Error("Select a Sequence first.");
    const next = validateViewPlacement(nextItems, sequence.durationTicks);
    const beforeById = new Map(sequence.viewLaneItems.map((entry) => [entry.id, entry]));
    const nextById = new Map(next.map((entry) => [entry.id, entry]));
    const commands = [];
    for (const item of canonicalViewItems(sequence.viewLaneItems)) {
      if (!nextById.has(item.id)) {
        commands.push({ type: "sequence.remove_view_item", payload: {
          sequenceId: sequence.id, viewItemId: item.id,
        } });
      }
    }
    for (const item of next) {
      const before = beforeById.get(item.id);
      if (!before) {
        commands.push({ type: "sequence.add_view_item", payload: {
          sequenceId: sequence.id, viewItem: cloneProject(item),
        } });
      } else if (!same(before, item)) {
        commands.push({ type: "sequence.update_view_item", payload: {
          sequenceId: sequence.id, viewItemId: item.id, viewItem: cloneProject(item),
        } });
      }
    }
    return commands;
  }

  commitViewItems(nextItems, label) {
    return this.mutate(() => {
      const commands = this.viewCommands(nextItems);
      if (!commands.length) return null;
      const result = this.session.executeTransaction(commands, { label });
      this.viewPreview.clear();
      return result;
    });
  }

  insertTransition({
    transitionId,
    startTicks,
    endTicks,
    itemId = this.idFactory("view"),
  }) {
    const sequence = this.activeSequence();
    if (!sequence) throw new Error("Select a Sequence first.");
    const transition = this.session.query("transition.get", { transitionId });
    const containing = canonicalViewItems(sequence.viewLaneItems).find((item) =>
      item.kind === VIEW_LANE_ITEM_KINDS.KEY_ART_HOLD &&
      item.startTicks <= startTicks && item.endTicks >= endTicks);
    if (!containing) throw new Error("Insert a Transition inside one KeyArtHold.");
    if (containing.keyArtId !== transition.fromKeyArtId) {
      throw new Error("Transition start KeyArt must match the containing Hold.");
    }
    const next = sequence.viewLaneItems.filter((item) => item.id !== containing.id);
    if (startTicks > containing.startTicks) {
      next.push({ ...containing, endTicks: startTicks });
    }
    next.push({
      id: itemId,
      kind: VIEW_LANE_ITEM_KINDS.TRANSITION_INSTANCE,
      transitionId,
      startTicks,
      endTicks,
    });
    if (endTicks < containing.endTicks) {
      next.push({
        id: startTicks > containing.startTicks ? this.idFactory("view") : containing.id,
        kind: VIEW_LANE_ITEM_KINDS.KEY_ART_HOLD,
        keyArtId: transition.toKeyArtId,
        startTicks: endTicks,
        endTicks: containing.endTicks,
      });
    }
    const result = this.commitViewItems(next, "Insert ViewLane Transition");
    this.selectedViewItemId = itemId;
    return result;
  }

  insertHold({ keyArtId, startTicks, endTicks, itemId = this.idFactory("view") }) {
    const sequence = this.activeSequence();
    if (!sequence) throw new Error("Select a Sequence first.");
    this.session.query("keyart.get", { keyArtId });
    const containing = canonicalViewItems(sequence.viewLaneItems).find((item) =>
      item.kind === VIEW_LANE_ITEM_KINDS.KEY_ART_HOLD &&
      item.startTicks <= startTicks && item.endTicks >= endTicks);
    if (!containing) throw new Error("Insert a Hold inside one existing Hold.");
    const next = sequence.viewLaneItems.filter((item) => item.id !== containing.id);
    if (startTicks > containing.startTicks) next.push({ ...containing, endTicks: startTicks });
    next.push({
      id: itemId,
      kind: VIEW_LANE_ITEM_KINDS.KEY_ART_HOLD,
      keyArtId,
      startTicks,
      endTicks,
    });
    if (endTicks < containing.endTicks) {
      next.push({
        ...containing,
        id: startTicks > containing.startTicks ? this.idFactory("view") : containing.id,
        startTicks: endTicks,
      });
    }
    const result = this.commitViewItems(next, "Insert ViewLane Hold");
    this.selectedViewItemId = itemId;
    return result;
  }

  changeViewReference(itemId, referenceId) {
    const sequence = this.activeSequence();
    const item = sequence?.viewLaneItems.find((entry) => entry.id === itemId);
    if (!item) throw new Error(`Unknown ViewLane item ${itemId}.`);
    if (item.kind === VIEW_LANE_ITEM_KINDS.KEY_ART_HOLD) {
      this.session.query("keyart.get", { keyArtId: referenceId });
    } else {
      this.session.query("transition.get", { transitionId: referenceId });
    }
    return this.commitViewItems(sequence.viewLaneItems.map((entry) => entry.id === item.id
      ? { ...entry, [item.kind === VIEW_LANE_ITEM_KINDS.KEY_ART_HOLD ? "keyArtId" : "transitionId"]: referenceId }
      : entry), "Change ViewLane reference");
  }

  updateViewItem(itemId, { startTicks, endTicks, referenceId }) {
    const sequence = this.activeSequence();
    const items = canonicalViewItems(sequence?.viewLaneItems || []);
    const index = items.findIndex((entry) => entry.id === itemId);
    if (index < 0) throw new Error(`Unknown ViewLane item ${itemId}.`);
    if (index === 0 && startTicks !== 0) throw new Error("The first ViewLane item must start at tick 0.");
    if (index === items.length - 1 && endTicks !== sequence.durationTicks) {
      throw new Error("The last ViewLane item must end at the Sequence duration.");
    }
    const item = items[index];
    if (item.kind === VIEW_LANE_ITEM_KINDS.KEY_ART_HOLD) {
      this.session.query("keyart.get", { keyArtId: referenceId });
      items[index] = { ...item, keyArtId: referenceId, startTicks, endTicks };
    } else {
      this.session.query("transition.get", { transitionId: referenceId });
      items[index] = { ...item, transitionId: referenceId, startTicks, endTicks };
    }
    if (index > 0) items[index - 1] = { ...items[index - 1], endTicks: startTicks };
    if (index < items.length - 1) items[index + 1] = { ...items[index + 1], startTicks: endTicks };
    return this.commitViewItems(items, "Update ViewLane item");
  }

  previewViewBoundary(leftItemId, rightItemId, boundaryTick) {
    const sequence = this.activeSequence();
    const left = sequence?.viewLaneItems.find((entry) => entry.id === leftItemId);
    const right = sequence?.viewLaneItems.find((entry) => entry.id === rightItemId);
    if (!left || !right || left.endTicks !== right.startTicks) {
      throw new Error("Choose adjacent ViewLane items.");
    }
    if (!Number.isSafeInteger(boundaryTick) || boundaryTick <= left.startTicks ||
      boundaryTick >= right.endTicks) {
      throw new Error("Boundary must preserve positive neighboring durations.");
    }
    this.viewPreview = new Map([
      [left.id, { ...left, endTicks: boundaryTick }],
      [right.id, { ...right, startTicks: boundaryTick }],
    ]);
    this.notify("sequence-view-boundary-preview");
  }

  commitViewBoundary() {
    const sequence = this.activeSequence();
    if (!sequence || this.viewPreview.size !== 2) return null;
    const next = sequence.viewLaneItems.map((item) => this.viewPreview.get(item.id) || item);
    return this.commitViewItems(next, "Adjust ViewLane boundary");
  }

  cancelViewPreview() {
    this.viewPreview.clear();
    this.notify("sequence-view-preview-cancelled");
  }

  removeViewItem(itemId, { absorb = "previous" } = {}) {
    const sequence = this.activeSequence();
    const items = canonicalViewItems(sequence?.viewLaneItems || []);
    const index = items.findIndex((entry) => entry.id === itemId);
    if (index < 0) throw new Error(`Unknown ViewLane item ${itemId}.`);
    if (items.length === 1) throw new Error("A Sequence must retain complete ViewLane coverage.");
    const removed = items[index];
    const next = items.filter((entry) => entry.id !== itemId);
    if (absorb === "previous" && index > 0) next[index - 1] = { ...next[index - 1], endTicks: removed.endTicks };
    else {
      const nextIndex = index === 0 ? 0 : index;
      next[nextIndex] = { ...next[nextIndex], startTicks: removed.startTicks };
    }
    const result = this.commitViewItems(next, "Remove ViewLane item");
    this.selectedViewItemId = null;
    return result;
  }

  moveViewItem(itemId, direction) {
    if (!["earlier", "later"].includes(direction)) throw new Error("Direction must be earlier or later.");
    const sequence = this.activeSequence();
    const items = canonicalViewItems(sequence?.viewLaneItems || []);
    const index = items.findIndex((entry) => entry.id === itemId);
    const otherIndex = direction === "earlier" ? index - 1 : index + 1;
    if (index < 0 || otherIndex < 0 || otherIndex >= items.length) return null;
    const low = Math.min(index, otherIndex);
    const high = Math.max(index, otherIndex);
    const first = items[low];
    const second = items[high];
    const firstDuration = first.endTicks - first.startTicks;
    items[low] = { ...second, startTicks: first.startTicks, endTicks: first.startTicks + (second.endTicks - second.startTicks) };
    items[high] = { ...first, startTicks: items[low].endTicks, endTicks: items[low].endTicks + firstDuration };
    return this.commitViewItems(items, "Reorder ViewLane items");
  }

  setDisplayUnit(unit) {
    if (!TIMELINE_DISPLAY_UNITS.includes(unit)) throw new Error(`Unknown display unit ${unit}.`);
    this.displayUnit = unit;
    this.notify("sequence-display-unit");
  }

  scrubToTick(timeTicks, { notify = true } = {}) {
    const sequence = this.activeSequence();
    if (!sequence) throw new Error("Select a Sequence first.");
    this.currentTick = clampTimelineTick(timeTicks, sequence.durationTicks);
    this.evaluate();
    if (notify) this.notify("sequence-scrub");
    return this.evaluation;
  }

  evaluate() {
    const sequence = this.activeSequence();
    this.evaluation = null;
    this.evaluationError = null;
    this.renderReport = null;
    if (!sequence) return null;
    try {
      this.evaluation = this.session.query("sequence.evaluate", {
        sequenceId: sequence.id,
        timeTicks: this.currentTick,
      });
      return this.evaluation;
    } catch (error) {
      this.evaluationError = normalizedError(error);
      return null;
    }
  }

  setPlaybackMode(mode) {
    if (!TIMELINE_PLAYBACK_MODES.includes(mode)) throw new Error(`Unknown playback mode ${mode}.`);
    this.clock.setMode(mode);
  }

  play(startTimeMs = null) {
    const sequence = this.activeSequence();
    if (!sequence) throw new Error("Select a Sequence first.");
    const startTick = this.clock.mode === "once" && this.currentTick === sequence.durationTicks
      ? 0 : this.currentTick;
    this.clock.play({ durationTicks: sequence.durationTicks, startTick, startTimeMs });
  }

  pause() {
    this.clock.pause();
  }

  jumpToStart() {
    this.clock.pause();
    return this.scrubToTick(0);
  }

  jumpToEnd() {
    const sequence = this.activeSequence();
    if (!sequence) throw new Error("Select a Sequence first.");
    this.clock.pause();
    return this.scrubToTick(sequence.durationTicks);
  }

  createClip({
    displayName,
    durationTicks,
    defaultLoopMode = CLIP_LOOP_MODES.ONCE,
    clipId = this.idFactory("clip"),
    programId = this.idFactory("program"),
  }) {
    return this.mutate(() => {
      const result = this.session.executeTransaction([
        { type: "animation.temporal.create_program", payload: { programId, durationTicks } },
        { type: "animation.clip.create", payload: { clip: {
          id: clipId, displayName, temporalProgramId: programId, defaultLoopMode, metadata: {},
        } } },
      ], { label: "Create AnimationClip" });
      this.selectedClipId = clipId;
      this.ownerContext = { kind: "AnimationClip", id: clipId };
      this.selectedTrackId = null;
      this.selectedKeyframe = null;
      return { ...result, clipId, programId };
    });
  }

  updateClip(patch, { durationTicks = null } = {}) {
    return this.mutate(() => {
      const clip = this.selectedClip();
      if (!clip) throw new Error("Select an AnimationClip first.");
      const commands = [{
        type: "animation.clip.update",
        payload: { clipId: clip.id, clip: { ...persistentOwner(clip), ...cloneProject(patch) } },
      }];
      if (durationTicks !== null && durationTicks !== clip.durationTicks) {
        commands.push({
          type: "animation.temporal.set_duration",
          payload: { programId: clip.temporalProgramId, durationTicks },
        });
      }
      return this.session.executeTransaction(commands, { label: "Update AnimationClip" });
    });
  }

  removeClip() {
    return this.mutate(() => {
      const clip = this.selectedClip();
      if (!clip) throw new Error("Select an AnimationClip first.");
      const result = this.session.executeTransaction([
        { type: "animation.clip.remove", payload: { clipId: clip.id } },
        { type: "animation.temporal.remove_program", payload: { programId: clip.temporalProgramId } },
      ], { label: "Remove AnimationClip" });
      this.selectedClipId = null;
      if (this.ownerContext?.kind === "AnimationClip" && this.ownerContext.id === clip.id) {
        this.ownerContext = null;
        this.selectedTrackId = null;
        this.selectedKeyframe = null;
      }
      return result;
    });
  }

  addClipInstance({
    clipId = this.selectedClipId,
    startTicks = this.currentTick,
    endTicks,
    sourceOffsetTicks = 0,
    playbackRate = { numerator: 1, denominator: 1 },
    loopMode,
    weight = 1,
    layer = 0,
    enabled = true,
    clipInstanceId = this.idFactory("clip_instance"),
  } = {}) {
    return this.mutate(() => {
      const sequence = this.activeSequence();
      if (!sequence) throw new Error("Select a Sequence first.");
      const clip = this.session.query("animation.clip.get", { clipId });
      const rate = normalizePlaybackRate(playbackRate.numerator, playbackRate.denominator);
      const resolvedEnd = endTicks ?? Math.min(sequence.durationTicks,
        startTicks + Math.max(1, Math.floor(clip.durationTicks * rate.denominator / rate.numerator)));
      const clipInstance = {
        id: clipInstanceId,
        clipId,
        startTicks,
        endTicks: resolvedEnd,
        sourceOffsetTicks,
        playbackRate: rate,
        loopMode: loopMode || clip.defaultLoopMode,
        weight,
        layer,
        enabled,
      };
      const result = this.session.execute({
        type: "sequence.add_clip_instance",
        payload: { sequenceId: sequence.id, clipInstance },
      }, { label: "Add ClipInstance" });
      this.selectedClipInstanceId = clipInstanceId;
      return { ...result, clipInstanceId };
    });
  }

  selectClipInstance(clipInstanceId) {
    const sequence = this.activeSequence();
    if (clipInstanceId !== null && !sequence?.clipInstances.some((entry) => entry.id === clipInstanceId)) {
      throw new Error(`Unknown ClipInstance ${clipInstanceId}.`);
    }
    this.selectedClipInstanceId = clipInstanceId;
    this.notify("sequence-clip-instance-selection");
  }

  selectedClipInstance() {
    return this.activeSequence()?.clipInstances
      .find((entry) => entry.id === this.selectedClipInstanceId) || null;
  }

  previewClipInstance(clipInstanceId, patch) {
    const sequence = this.activeSequence();
    const instance = sequence?.clipInstances.find((entry) => entry.id === clipInstanceId);
    if (!instance) throw new Error(`Unknown ClipInstance ${clipInstanceId}.`);
    const preview = { ...instance, ...cloneProject(patch), id: instance.id };
    if (!Number.isSafeInteger(preview.startTicks) || !Number.isSafeInteger(preview.endTicks) ||
      preview.startTicks < 0 || preview.startTicks >= preview.endTicks ||
      preview.endTicks > sequence.durationTicks) {
      throw new Error("ClipInstance preview must remain inside the Sequence.");
    }
    this.clipPreview.set(instance.id, preview);
    this.notify("sequence-clip-instance-preview");
  }

  commitClipInstance(clipInstanceId, patch = null, label = "Move ClipInstance") {
    return this.mutate(() => {
      const sequence = this.activeSequence();
      const instance = sequence?.clipInstances.find((entry) => entry.id === clipInstanceId);
      if (!instance) throw new Error(`Unknown ClipInstance ${clipInstanceId}.`);
      const preview = this.clipPreview.get(clipInstanceId);
      const next = {
        ...instance,
        ...(preview ? cloneProject(preview) : {}),
        ...(patch ? cloneProject(patch) : {}),
        id: instance.id,
      };
      if (next.playbackRate) {
        next.playbackRate = normalizePlaybackRate(
          next.playbackRate.numerator, next.playbackRate.denominator);
      }
      const result = this.session.execute({
        type: "sequence.update_clip_instance",
        payload: { sequenceId: sequence.id, clipInstanceId: instance.id, clipInstance: next },
      }, { label });
      this.clipPreview.delete(clipInstanceId);
      return result;
    });
  }

  cancelClipPreview(clipInstanceId = null) {
    if (clipInstanceId) this.clipPreview.delete(clipInstanceId);
    else this.clipPreview.clear();
    this.notify("sequence-clip-instance-preview-cancelled");
  }

  removeClipInstance(clipInstanceId = this.selectedClipInstanceId) {
    return this.mutate(() => {
      const sequence = this.activeSequence();
      if (!sequence || !clipInstanceId) throw new Error("Select a ClipInstance first.");
      const result = this.session.execute({
        type: "sequence.remove_clip_instance",
        payload: { sequenceId: sequence.id, clipInstanceId },
      }, { label: "Remove ClipInstance" });
      if (this.selectedClipInstanceId === clipInstanceId) this.selectedClipInstanceId = null;
      this.clipPreview.delete(clipInstanceId);
      return result;
    });
  }

  allowedTrackKinds() {
    return temporalTrackKindsForOwner(this.ownerContext?.kind);
  }

  targetOptions(kind) {
    if (kind === "CameraTrack") return [{ label: "Main camera", target: { cameraId: "main" } }];
    if (kind === "BoneTrack") {
      return this.session.query("bone.list").map((bone) => ({
        label: bone.displayName ? `${bone.displayName} · ${bone.id}` : bone.id,
        target: { boneId: bone.id },
      }));
    }
    if (kind === "DeformerTrack") {
      return this.session.query("deformer.list").flatMap((deformer) =>
        this.session.query("deformer.get", { deformerId: deformer.id }).controlPoints
          .filter(Boolean)
          .map((point) => ({
            label: `${deformer.id} · ${point.id}`,
            target: { deformerId: deformer.id, controlPointId: point.id },
          })));
    }
    if (kind === "MeshDeformationTrack") {
      return this.session.query("mesh.list").map((mesh) => ({
        label: mesh.displayName ? `${mesh.displayName} · ${mesh.id}` : mesh.id,
        target: { meshId: mesh.id },
      }));
    }
    const local = kind === "TransformTrack";
    const nodes = this.session.query("scene.search", { text: "", includeHidden: true })
      .sort((left, right) => compareText(left.id, right.id))
      .map((node) => ({
        label: `Node · ${node.displayName} · ${node.id}`,
        target: local ? { nodeId: node.id, coordinateSpace: "node-local" } : { nodeId: node.id },
      }));
    const slots = this.session.query("semantic_slot.list").map((slot) => ({
      label: `SemanticSlot · ${slot.displayName} · ${slot.id}`,
      target: local
        ? { semanticSlotId: slot.id, coordinateSpace: "node-local" }
        : { semanticSlotId: slot.id },
    }));
    return [...nodes, ...slots];
  }

  addTrack(kind, target, { trackId = this.idFactory("track") } = {}) {
    return this.mutate(() => {
      if (!this.allowedTrackKinds().includes(kind)) {
        throw new Error(`${kind} is not valid for the selected ${this.ownerContext?.kind || "owner"}.`);
      }
      const program = this.activeProgram();
      if (!program) throw new Error("Choose a Sequence or AnimationClip program first.");
      const validTargets = this.targetOptions(kind).map((entry) => entry.target);
      if (!validTargets.some((entry) => same(entry, target))) {
        throw new Error("Choose an existing stable typed target.");
      }
      const definition = TEMPORAL_TRACK_DEFINITIONS[kind];
      const channels = Object.fromEntries(definition.channels.map((channel) =>
        [channel, { keyframes: [] }]));
      const result = this.session.execute({
        type: "animation.temporal.add_track",
        payload: { programId: program.id, track: {
          trackId, version: 1, kind, target: cloneProject(target), channels,
        } },
      }, { label: "Add Animation track" });
      this.selectedTrackId = trackId;
      this.selectedKeyframe = null;
      return { ...result, trackId };
    });
  }

  selectTrack(trackId) {
    const program = this.activeProgram();
    if (trackId !== null && !program?.tracks.some((entry) => entry.trackId === trackId)) {
      throw new Error(`Unknown track ${trackId}.`);
    }
    this.selectedTrackId = trackId;
    this.selectedKeyframe = null;
    this.notify("sequence-track-selection");
  }

  removeTrack(trackId = this.selectedTrackId) {
    return this.mutate(() => {
      const program = this.activeProgram();
      if (!program || !trackId) throw new Error("Select a track first.");
      const result = this.session.execute({
        type: "animation.temporal.remove_track",
        payload: { programId: program.id, trackId },
      }, { label: "Remove Animation track" });
      if (this.selectedTrackId === trackId) {
        this.selectedTrackId = null;
        this.selectedKeyframe = null;
      }
      return result;
    });
  }

  selectKeyframe(trackId, channel, keyframeId) {
    const track = this.activeProgram()?.tracks.find((entry) => entry.trackId === trackId);
    const keyframe = track?.channels?.[channel]?.keyframes.find((entry) => entry.id === keyframeId);
    if (!keyframe) throw new Error(`Unknown keyframe ${keyframeId}.`);
    this.selectedTrackId = trackId;
    this.selectedKeyframe = { trackId, channel, keyframeId };
    this.notify("sequence-keyframe-selection");
  }

  addKeyframe(trackId, channel, {
    timeTicks = this.currentTick,
    value,
    interpolationKind,
    bezier = {},
    deformationSampleId = null,
    keyframeId = this.idFactory("keyframe"),
  } = {}) {
    return this.mutate(() => {
      const program = this.activeProgram();
      const track = program?.tracks.find((entry) => entry.trackId === trackId);
      const definition = track ? temporalChannelDefinition(track.kind, channel) : null;
      if (!definition || !track.channels[channel]) throw new Error(`Unknown typed channel ${channel}.`);
      const resolvedKind = definition.discrete ? "step" : interpolationKind || "linear";
      const keyframe = {
        id: keyframeId,
        timeTicks,
        value: cloneProject(value === undefined
          ? defaultChannelValue(definition, { deformationSampleId }) : value),
        interpolationToNext: interpolation(resolvedKind, bezier),
      };
      const result = this.session.execute({
        type: "animation.temporal.add_keyframe",
        payload: { programId: program.id, trackId, channel, keyframe },
      }, { label: "Add Animation keyframe" });
      this.selectedTrackId = trackId;
      this.selectedKeyframe = { trackId, channel, keyframeId };
      return { ...result, keyframeId };
    });
  }

  selectedKeyframeValue() {
    if (!this.selectedKeyframe) return null;
    const { trackId, channel, keyframeId } = this.selectedKeyframe;
    const keyframe = this.activeProgram()?.tracks.find((entry) => entry.trackId === trackId)
      ?.channels?.[channel]?.keyframes.find((entry) => entry.id === keyframeId) || null;
    if (!keyframe) return null;
    return this.keyframePreview?.keyframeId === keyframeId
      ? { ...cloneProject(keyframe), timeTicks: this.keyframePreview.timeTicks }
      : cloneProject(keyframe);
  }

  previewKeyframeTime(trackId, channel, keyframeId, timeTicks) {
    const program = this.activeProgram();
    const exists = program?.tracks.find((entry) => entry.trackId === trackId)
      ?.channels?.[channel]?.keyframes.some((entry) => entry.id === keyframeId);
    if (!exists) throw new Error(`Unknown keyframe ${keyframeId}.`);
    this.keyframePreview = {
      trackId, channel, keyframeId,
      timeTicks: clampTimelineTick(timeTicks, program.durationTicks),
    };
    this.notify("sequence-keyframe-preview");
  }

  updateKeyframe(trackId, channel, keyframeId, patch, label = "Update Animation keyframe") {
    return this.mutate(() => {
      const program = this.activeProgram();
      const keyframe = program?.tracks.find((entry) => entry.trackId === trackId)
        ?.channels?.[channel]?.keyframes.find((entry) => entry.id === keyframeId);
      if (!keyframe) throw new Error(`Unknown keyframe ${keyframeId}.`);
      const next = { ...keyframe, ...cloneProject(patch), id: keyframe.id };
      const result = this.session.execute({
        type: "animation.temporal.update_keyframe",
        payload: { programId: program.id, trackId, channel, keyframeId, keyframe: next },
      }, { label });
      this.keyframePreview = null;
      return result;
    });
  }

  commitKeyframePreview() {
    if (!this.keyframePreview) return null;
    const preview = { ...this.keyframePreview };
    return this.updateKeyframe(preview.trackId, preview.channel, preview.keyframeId,
      { timeTicks: preview.timeTicks }, "Move Animation keyframe");
  }

  cancelKeyframePreview() {
    this.keyframePreview = null;
    this.notify("sequence-keyframe-preview-cancelled");
  }

  setKeyframeInterpolation(trackId, channel, keyframeId, kind, controls = {}) {
    return this.updateKeyframe(trackId, channel, keyframeId, {
      interpolationToNext: interpolation(kind, controls),
    }, "Set keyframe interpolation");
  }

  removeKeyframe(trackId, channel, keyframeId) {
    return this.mutate(() => {
      const program = this.activeProgram();
      if (!program) throw new Error("Choose a program first.");
      const result = this.session.execute({
        type: "animation.temporal.remove_keyframe",
        payload: { programId: program.id, trackId, channel, keyframeId },
      }, { label: "Remove Animation keyframe" });
      if (this.selectedKeyframe?.keyframeId === keyframeId) this.selectedKeyframe = null;
      this.keyframePreview = null;
      return result;
    });
  }

  setRenderReport(report) {
    const next = report ? cloneProject(report) : null;
    if (same(next, this.renderReport)) return;
    this.renderReport = next;
    this.notify("sequence-render-report");
  }

  projectChanged() {
    const sequenceIds = new Set(this.sequenceList().map((entry) => entry.id));
    const clipIds = new Set(this.clipList().map((entry) => entry.id));
    if (this.selectedSequenceId && !sequenceIds.has(this.selectedSequenceId)) {
      this.clock.pause();
      this.selectedSequenceId = null;
      this.selectedViewItemId = null;
      this.selectedClipInstanceId = null;
      this.currentTick = 0;
      this.evaluation = null;
    }
    if (this.selectedClipId && !clipIds.has(this.selectedClipId)) this.selectedClipId = null;
    if (this.ownerContext && !(
      (this.ownerContext.kind === "Sequence" && sequenceIds.has(this.ownerContext.id)) ||
      (this.ownerContext.kind === "AnimationClip" && clipIds.has(this.ownerContext.id))
    )) {
      this.ownerContext = null;
      this.selectedTrackId = null;
      this.selectedKeyframe = null;
    }
    const sequence = this.activeSequence();
    if (sequence) {
      this.currentTick = clampTimelineTick(this.currentTick, sequence.durationTicks);
      if (!sequence.viewLaneItems.some((entry) => entry.id === this.selectedViewItemId)) {
        this.selectedViewItemId = null;
      }
      if (!sequence.clipInstances.some((entry) => entry.id === this.selectedClipInstanceId)) {
        this.selectedClipInstanceId = null;
      }
      this.evaluate();
    }
    const program = this.activeProgram();
    const track = program?.tracks.find((entry) => entry.trackId === this.selectedTrackId);
    if (!track) {
      this.selectedTrackId = null;
      this.selectedKeyframe = null;
    } else if (this.selectedKeyframe) {
      const { channel, keyframeId } = this.selectedKeyframe;
      if (!track.channels?.[channel]?.keyframes.some((entry) => entry.id === keyframeId)) {
        this.selectedKeyframe = null;
      }
    }
    this.viewPreview.clear();
    this.clipPreview.clear();
    this.keyframePreview = null;
  }

  getState() {
    const sequences = this.sequenceList();
    const sequence = this.activeSequence();
    const clips = this.clipList();
    const clip = this.selectedClip();
    const program = this.activeProgram();
    const tracks = program?.tracks || [];
    const selectedTrack = tracks.find((entry) => entry.trackId === this.selectedTrackId) || null;
    const renderSettings = this.session.query("project.get_render_settings");
    const viewItems = sequence ? projectTimelineItems(sequence.viewLaneItems, sequence.durationTicks, {
      selectedId: this.selectedViewItemId,
      previewById: this.viewPreview,
    }).map((item) => {
      const reference = item.kind === VIEW_LANE_ITEM_KINDS.KEY_ART_HOLD
        ? this.session.query("keyart.get", { keyArtId: item.keyArtId })
        : this.session.query("transition.get", { transitionId: item.transitionId });
      return { ...item, referenceId: reference.id, referenceName: reference.displayName };
    }) : [];
    const clipById = new Map(clips.map((entry) => [entry.id, entry]));
    const clipInstances = sequence ? projectTimelineItems(sequence.clipInstances,
      sequence.durationTicks, {
        selectedId: this.selectedClipInstanceId,
        previewById: this.clipPreview,
      }).map((instance) => ({
        ...instance,
        clipName: clipById.get(instance.clipId)?.displayName || instance.clipId,
      })) : [];
    const selectedInstance = clipInstances.find((entry) => entry.id === this.selectedClipInstanceId) || null;
    const diagnostics = sequence
      ? this.session.query("sequence.get_diagnostics", { sequenceId: sequence.id }).issues
      : [];
    const evaluationDiagnostics = Array.isArray(this.evaluation?.diagnostics)
      ? this.evaluation.diagnostics : [];
    return {
      sequences: cloneProject(sequences.map((entry) => ({
        id: entry.id, displayName: entry.displayName, durationTicks: entry.durationTicks,
        selected: entry.id === this.selectedSequenceId,
      }))),
      selectedSequenceId: this.selectedSequenceId,
      sequence: cloneProject(sequence),
      viewItems: cloneProject(viewItems),
      selectedViewItemId: this.selectedViewItemId,
      clips: cloneProject(clips.map((entry) => ({ ...entry, selected: entry.id === this.selectedClipId }))),
      selectedClip: cloneProject(clip),
      selectedClipId: this.selectedClipId,
      clipInstances: cloneProject(clipInstances),
      selectedClipInstance: cloneProject(selectedInstance),
      selectedClipInstanceId: this.selectedClipInstanceId,
      ownerContext: this.ownerContext ? {
        ...cloneProject(this.ownerContext),
        displayName: this.activeOwner()?.displayName || this.ownerContext.id,
      } : null,
      program: cloneProject(program),
      allowedTrackKinds: this.allowedTrackKinds(),
      tracks: cloneProject(tracks.map((track) => ({ ...track, targetLabel: targetLabel(track.target) }))),
      selectedTrack: cloneProject(selectedTrack),
      selectedTrackId: selectedTrack?.trackId || null,
      selectedKeyframe: cloneProject(this.selectedKeyframe),
      selectedKeyframeValue: this.selectedKeyframeValue(),
      currentTick: sequence ? clampTimelineTick(this.currentTick, sequence.durationTicks) : 0,
      timeDisplay: projectTimelineTime(this.currentTick, this.displayUnit, renderSettings.frameRate),
      displayUnit: this.displayUnit,
      playbackMode: this.clock.mode,
      playing: this.clock.playing,
      evaluation: this.evaluation,
      evaluationError: cloneProject(this.evaluationError),
      diagnostics: cloneProject([...diagnostics, ...evaluationDiagnostics]),
      operationError: cloneProject(this.operationError),
    };
  }
}
