import { evaluateTransition } from "../core/transition-evaluator.js";
import {
  clippingBindingForTarget,
  findClippingDependencyCycles,
  isRenderableClippingNode,
} from "./clipping-validation.js";

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

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cycleKey(nodeIds) {
  return [...nodeIds].sort(compareText).join("\u0000");
}

function clippingTrackTargets(project, program, track) {
  if (track.target?.nodeId) return [track.target.nodeId];
  if (track.target?.semanticSlotId) {
    const slot = (project.semanticSlots || []).find((entry) =>
      entry.id === track.target.semanticSlotId);
    return [...new Set((slot?.mappings || []).map((mapping) => mapping.nodeId))]
      .sort(compareText);
  }
  if (track.target?.transitionDefault !== true) return [];
  const nodeIds = new Set();
  for (const transition of project.transitions || []) {
    if (transition.temporalProgramId !== program.id) continue;
    const slotIds = new Set((transition.partTransitions || []).map((part) =>
      part.semanticSlotId));
    for (const slot of project.semanticSlots || []) {
      if (!slotIds.has(slot.id)) continue;
      for (const mapping of slot.mappings || []) {
        if ([transition.fromKeyArtId, transition.toKeyArtId].includes(mapping.keyArtId)) {
          nodeIds.add(mapping.nodeId);
        }
      }
    }
  }
  return [...nodeIds].sort(compareText);
}

function validateAuthoredReferences(project) {
  const issues = [];
  const seen = new Set();
  const add = (entry) => {
    const key = [entry.code, entry.path, entry.entityId || ""].join("\u0000");
    if (!seen.has(key)) {
      seen.add(key);
      issues.push(entry);
    }
  };
  const nodes = project.scene?.nodes || {};

  for (const [keyArtIndex, keyArt] of (project.keyArts || []).entries()) {
    for (const [memberIndex, member] of (keyArt.members || []).entries()) {
      const sourceNodeId = member?.clipping?.sourceNodeId;
      if (!sourceNodeId) continue;
      const path = `keyArts.${keyArtIndex}.members.${memberIndex}.clipping.sourceNodeId`;
      if (sourceNodeId === member.nodeId) {
        add(problem(
          "CLIPPING_SELF_REFERENCE",
          path,
          "A node cannot clip itself.",
          member.nodeId,
          { keyArtId: keyArt.id, nodeId: member.nodeId },
        ));
      }
      if (nodes[member.nodeId] && !isRenderableClippingNode(nodes[member.nodeId])) {
        add(problem(
          "CLIPPING_TARGET_NOT_RENDERABLE",
          path,
          "Clipping target must be a renderable part node.",
          member.nodeId,
          { keyArtId: keyArt.id, targetNodeId: member.nodeId },
        ));
      }
      if (nodes[sourceNodeId] && !isRenderableClippingNode(nodes[sourceNodeId])) {
        add(problem(
          "CLIPPING_SOURCE_NOT_RENDERABLE",
          path,
          "Clipping source must be a renderable part node.",
          sourceNodeId,
          { keyArtId: keyArt.id, sourceNodeId },
        ));
      }
    }
  }

  for (const [programIndex, program] of (project.temporalPrograms || []).entries()) {
    for (const [trackIndex, track] of (program.tracks || []).entries()) {
      if (track?.kind !== "ClippingTrack") continue;
      const targets = clippingTrackTargets(project, program, track);
      const keyframes = track.channels?.clipping?.keyframes || [];
      for (const [keyframeIndex, keyframe] of keyframes.entries()) {
        const sourceNodeId = keyframe?.value?.sourceNodeId;
        if (!sourceNodeId) continue;
        const path = `temporalPrograms.${programIndex}.tracks.${trackIndex}` +
          `.channels.clipping.keyframes.${keyframeIndex}.value.sourceNodeId`;
        if (nodes[sourceNodeId] && !isRenderableClippingNode(nodes[sourceNodeId])) {
          add(problem(
            "CLIPPING_SOURCE_NOT_RENDERABLE",
            path,
            "Clipping source must be a renderable part node.",
            sourceNodeId,
            { trackId: track.trackId, sourceNodeId },
          ));
        }
        for (const targetNodeId of targets) {
          if (nodes[targetNodeId] && !isRenderableClippingNode(nodes[targetNodeId])) {
            add(problem(
              "CLIPPING_TARGET_NOT_RENDERABLE",
              path,
              "Clipping target must be a renderable part node.",
              track.trackId,
              { trackId: track.trackId, targetNodeId },
            ));
          }
          if (sourceNodeId === targetNodeId) {
            add(problem(
              "CLIPPING_SELF_REFERENCE",
              path,
              "A node cannot clip itself.",
              track.trackId,
              { trackId: track.trackId, targetNodeId, sourceNodeId },
            ));
          }
        }
      }
    }
  }
  return issues;
}

function bindingCycleKeys(project) {
  const nodes = project.scene?.nodes || {};
  const relations = (project.clippingBindings || []).filter((binding) =>
    binding?.enabled === true &&
    binding.targetNodeId !== binding.sourceNodeId &&
    isRenderableClippingNode(nodes[binding.targetNodeId]) &&
    isRenderableClippingNode(nodes[binding.sourceNodeId]));
  return new Set(findClippingDependencyCycles(relations).map(cycleKey));
}

function validateKeyArtCycles(project, seenCycles) {
  const issues = [];
  for (const [keyArtIndex, keyArt] of (project.keyArts || []).entries()) {
    const relations = [];
    for (const member of keyArt.members || []) {
      const binding = clippingBindingForTarget(project, member.nodeId);
      if (binding && !binding.enabled) continue;
      const sourceNodeId = member.clipping?.sourceNodeId ||
        (binding?.enabled ? binding.sourceNodeId : null);
      if (sourceNodeId && sourceNodeId !== member.nodeId) {
        relations.push({ targetNodeId: member.nodeId, sourceNodeId });
      }
    }
    for (const nodeIds of findClippingDependencyCycles(relations)) {
      const key = cycleKey(nodeIds);
      if (seenCycles.has(key)) continue;
      seenCycles.add(key);
      issues.push(problem(
        "CLIPPING_CYCLE",
        `keyArts.${keyArtIndex}.members`,
        "Clipping dependencies must not contain a cycle.",
        keyArt.id,
        { keyArtId: keyArt.id, nodeIds },
      ));
    }
  }
  return issues;
}

function transitionSampleTimes(program) {
  if (!Number.isSafeInteger(program.durationTicks) || program.durationTicks < 1) return [];
  const times = new Set([0, program.durationTicks]);
  if (program.durationTicks > 1) times.add(1);
  if (program.durationTicks > 2) times.add(program.durationTicks - 1);
  for (const track of program.tracks || []) {
    if (track?.kind !== "ClippingTrack") continue;
    for (const keyframe of track.channels?.clipping?.keyframes || []) {
      const time = keyframe?.timeTicks;
      if (!Number.isSafeInteger(time) || time < 0 || time > program.durationTicks) continue;
      times.add(time);
      if (time > 0) times.add(time - 1);
      if (time < program.durationTicks) times.add(time + 1);
    }
  }
  return [...times].filter((time) => time >= 0 && time <= program.durationTicks)
    .sort((left, right) => left - right);
}

function validateTransitionCycles(project, seenCycles) {
  const issues = [];
  const programs = new Map((project.temporalPrograms || []).map((program) =>
    [program?.id, program]));
  for (const transition of [...(project.transitions || [])].sort((left, right) =>
    compareText(left?.id || "", right?.id || ""))) {
    const program = programs.get(transition?.temporalProgramId);
    if (!program) continue;
    for (const timeTicks of transitionSampleTimes(program)) {
      let evaluation;
      try {
        evaluation = evaluateTransition(project, transition.id, timeTicks);
      } catch {
        continue;
      }
      const nodeByInstance = new Map();
      for (const part of evaluation.evaluatedParts || []) {
        for (const instance of part.renderInstances || []) {
          nodeByInstance.set(instance.renderInstanceId, instance.sourceNodeId);
        }
      }
      for (const diagnostic of evaluation.diagnostics || []) {
        if (diagnostic.code !== "CLIPPING_CYCLE") continue;
        const nodeIds = [...new Set((diagnostic.details?.renderInstanceIds || [])
          .map((id) => nodeByInstance.get(id)).filter(Boolean))].sort(compareText);
        const key = cycleKey(nodeIds);
        if (!nodeIds.length || seenCycles.has(key)) continue;
        seenCycles.add(key);
        issues.push(problem(
          "CLIPPING_CYCLE",
          "transitions",
          "Clipping dependencies must not contain a cycle.",
          transition.id,
          { transitionId: transition.id, timeTicks, nodeIds },
        ));
      }
    }
  }
  return issues;
}

export function validateTransitionClipping(project) {
  const seenCycles = bindingCycleKeys(project);
  return [
    ...validateAuthoredReferences(project),
    ...validateKeyArtCycles(project, seenCycles),
    ...validateTransitionCycles(project, seenCycles),
  ].sort((left, right) =>
    compareText(left.code, right.code) ||
    compareText(left.entityId || "", right.entityId || "") ||
    compareText(left.path, right.path));
}
