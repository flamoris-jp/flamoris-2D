import {
  TEMPORAL_TRACK_DEFINITIONS,
  sampleKeyframes,
} from "../core/temporal.js";

const EVENT_TYPES = new Set([
  "contact", "release", "blink", "occlusion_change",
  "depth_crossing", "pose_switch", "marker",
]);
const REGION_TYPES = new Set([
  "idle", "anticipation", "action", "contact", "settle", "hold",
]);

function problem(
  code,
  path,
  message,
  entityId = null,
  severity = "error",
  details = null,
) {
  return {
    code,
    path,
    message,
    entityId,
    severity,
    ...(details ? { details } : {}),
  };
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validTime(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function hasExactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function validateInterpolation(value, path, issues, discrete) {
  if (!object(value) || !["step", "linear", "bezier"].includes(value.kind)) {
    issues.push(problem("ANIMATION_INVALID_CURVE", path, "Interpolation kind must be step, linear, or bezier."));
    return;
  }
  if (discrete && value.kind !== "step") {
    issues.push(problem("ANIMATION_INVALID_CURVE", path, "Discrete channels require step interpolation."));
  }
  const keys = Object.keys(value).sort();
  const expected = value.kind === "bezier"
    ? ["kind", "x1", "x2", "y1", "y2"].sort()
    : ["kind"];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    issues.push(problem("ANIMATION_INVALID_CURVE", path, "Interpolation contains missing or unknown fields."));
    return;
  }
  if (value.kind === "bezier") {
    if (![value.x1, value.y1, value.x2, value.y2].every(finite) ||
      value.x1 < 0 || value.x1 > 1 || value.x2 < 0 || value.x2 > 1) {
      issues.push(problem(
        "ANIMATION_INVALID_CURVE",
        path,
        "Bezier controls must be finite and x1/x2 must be within 0..1.",
      ));
    }
  }
}

function validateTarget(track, definition, program, project, path, issues) {
  const target = track.target;
  if (!object(target)) {
    issues.push(problem("ANIMATION_UNKNOWN_TARGET", path, "Track target must be a typed object.", track.trackId));
    return;
  }
  const hasNode = typeof target.nodeId === "string" && target.nodeId.length > 0;
  const hasSemantic = typeof target.semanticSlotId === "string" && target.semanticSlotId.length > 0;
  const hasTransitionDefault = target.transitionDefault === true;
  const fields = Object.keys(target);
  let valid = false;
  if (definition.target === "semantic") valid = hasSemantic && fields.length === 1;
  if (definition.target === "transition") {
    valid = (hasSemantic !== hasTransitionDefault) && fields.length === 1;
  }
  if (definition.target === "node-or-semantic") valid = hasNode !== hasSemantic && fields.length === 1;
  if (definition.target === "node-semantic-or-transition") {
    valid = Number(hasNode) + Number(hasSemantic) + Number(hasTransitionDefault) === 1 &&
      fields.length === 1;
  }
  if (definition.target === "node") {
    valid = hasNode && target.coordinateSpace === "node-local" && fields.length === 2;
  }
  if (definition.target === "mesh") {
    valid = typeof target.meshId === "string" && target.meshId.length > 0 && fields.length === 1;
  }
  if (definition.target === "camera") valid = target.cameraId === "main" && fields.length === 1;
  if (!valid) {
    issues.push(problem("ANIMATION_UNKNOWN_TARGET", path, "Target shape is invalid for " + track.kind + ".", track.trackId));
    return;
  }
  if (hasNode && !project.scene?.nodes?.[target.nodeId]) {
    issues.push(problem("ANIMATION_UNKNOWN_TARGET", path + ".nodeId", "Target scene node does not exist.", target.nodeId));
  }
  if (hasSemantic && !(project.semanticSlots || []).some((slot) => slot.id === target.semanticSlotId)) {
    issues.push(problem("ANIMATION_UNKNOWN_TARGET", path + ".semanticSlotId", "Target semantic slot does not exist.", target.semanticSlotId));
  }
  if (hasTransitionDefault && !(project.transitions || []).some((transition) =>
    transition.temporalProgramId === program.id)) {
    issues.push(problem(
      "ANIMATION_UNKNOWN_TARGET",
      path + ".transitionDefault",
      "transitionDefault may target only a Transition-owned TemporalProgram.",
      track.trackId,
    ));
  }
  if (target.meshId && !(project.meshes || []).some((mesh) => mesh.id === target.meshId)) {
    issues.push(problem("ANIMATION_UNKNOWN_TARGET", path + ".meshId", "Target mesh does not exist.", target.meshId));
  }
}

function validateValue(value, valueType, path, issues, project) {
  if (valueType === "number" && !finite(value)) {
    issues.push(problem("ANIMATION_INVALID_VALUE", path, "Channel value must be finite."));
  } else if (valueType === "unit-number" && (!finite(value) || value < 0 || value > 1)) {
    issues.push(problem("ANIMATION_INVALID_VALUE", path, "Channel value must be within 0..1."));
  } else if (valueType === "integer" && !Number.isSafeInteger(value)) {
    issues.push(problem("ANIMATION_INVALID_DRAW_ORDER", path, "Draw order must be a safe integer."));
  } else if (valueType === "presence" && !["present", "occluded", "absent"].includes(value)) {
    issues.push(problem("ANIMATION_INVALID_PRESENCE_VALUE", path, "Presence must be present, occluded, or absent."));
  } else if (valueType === "weights") {
    if (!object(value) || Object.keys(value).length === 0 ||
      Object.values(value).some((weight) => !finite(weight) || weight < 0)) {
      issues.push(problem("ANIMATION_INVALID_VALUE", path, "Appearance weights must be a non-empty map of finite non-negative weights."));
    } else {
      const sum = Object.values(value).reduce((total, weight) => total + weight, 0);
      if (Math.abs(sum - 1) > 1e-9) {
        issues.push(problem("ANIMATION_INVALID_VALUE", path, "Appearance weights must sum to 1."));
      }
    }
  } else if (valueType === "clipping") {
    if (!object(value) || !Object.hasOwn(value, "sourceNodeId") ||
      (value.sourceNodeId !== null && (typeof value.sourceNodeId !== "string" || !value.sourceNodeId))) {
      issues.push(problem("ANIMATION_INVALID_VALUE", path, "Clipping value must contain sourceNodeId as a stable ID or null."));
    } else if (value.sourceNodeId !== null && !project.scene?.nodes?.[value.sourceNodeId]) {
      issues.push(problem("ANIMATION_UNKNOWN_TARGET", path + ".sourceNodeId", "Clipping source node does not exist.", value.sourceNodeId));
    }
  } else if (valueType === "deformation") {
    if (!object(value) || typeof value.deformationSampleId !== "string" || !value.deformationSampleId ||
      !finite(value.weight)) {
      issues.push(problem("ANIMATION_INVALID_VALUE", path, "Deformation value requires deformationSampleId and a finite weight."));
    }
  }
}

function validateTrack(track, program, project, path, issues, register) {
  if (!object(track) || typeof track.trackId !== "string" || !track.trackId) {
    issues.push(problem("identity.missing", path + ".trackId", "Stable trackId is required."));
    return;
  }
  register(track.trackId, path + ".trackId");
  if (!hasExactKeys(track, ["trackId", "version", "kind", "target", "channels"])) {
    issues.push(problem("ANIMATION_INVALID_TRACK", path, "Track contains missing or unknown fields.", track.trackId));
  }
  const definition = TEMPORAL_TRACK_DEFINITIONS[track.kind];
  if (!definition) {
    issues.push(problem("ANIMATION_UNKNOWN_TRACK_KIND", path + ".kind", "Unknown temporal track kind.", track.trackId));
    return;
  }
  if (track.version !== 1) {
    issues.push(problem("ANIMATION_TRACK_VERSION_UNSUPPORTED", path + ".version", "Track version must be 1.", track.trackId));
  }
  validateTarget(track, definition, program, project, path + ".target", issues);
  if (!object(track.channels) || Object.keys(track.channels).length === 0) {
    issues.push(problem("ANIMATION_INVALID_CHANNEL", path + ".channels", "Track must contain at least one typed channel.", track.trackId));
    return;
  }
  for (const [channelName, channel] of Object.entries(track.channels)) {
    const channelPath = path + ".channels." + channelName;
    if (!definition.channels.includes(channelName)) {
      issues.push(problem("ANIMATION_INVALID_CHANNEL", channelPath, "Channel is not valid for " + track.kind + ".", track.trackId));
      continue;
    }
    if (!object(channel) || !Array.isArray(channel.keyframes)) {
      issues.push(problem("ANIMATION_INVALID_CHANNEL", channelPath, "Channel keyframes must be an array.", track.trackId));
      continue;
    }
    if (!hasExactKeys(channel, ["keyframes"])) {
      issues.push(problem("ANIMATION_INVALID_CHANNEL", channelPath, "Channel contains unknown fields.", track.trackId));
    }
    const times = new Set();
    channel.keyframes.forEach((keyframe, keyIndex) => {
      const keyPath = channelPath + ".keyframes." + keyIndex;
      if (!object(keyframe) || typeof keyframe.id !== "string" || !keyframe.id) {
        issues.push(problem("identity.missing", keyPath + ".id", "Stable keyframe ID is required."));
        return;
      }
      register(keyframe.id, keyPath + ".id");
      if (!hasExactKeys(keyframe, ["id", "timeTicks", "value", "interpolationToNext"])) {
        issues.push(problem("ANIMATION_INVALID_KEYFRAME", keyPath, "Keyframe contains missing or unknown fields.", keyframe.id));
      }
      if (!validTime(keyframe.timeTicks)) {
        issues.push(problem("ANIMATION_INVALID_TIME", keyPath + ".timeTicks", "Keyframe time must be a non-negative safe integer.", keyframe.id));
      } else {
        if (keyframe.timeTicks > program.durationTicks) {
          issues.push(problem("ANIMATION_KEY_OUTSIDE_PROGRAM", keyPath + ".timeTicks", "Keyframe lies outside the program duration.", keyframe.id));
        }
        if (times.has(keyframe.timeTicks)) {
          issues.push(problem("ANIMATION_DUPLICATE_KEY_TIME", keyPath + ".timeTicks", "Channel keyframe times must be unique.", keyframe.id));
        }
        times.add(keyframe.timeTicks);
      }
      validateValue(keyframe.value, definition.value, keyPath + ".value", issues, project);
      validateInterpolation(keyframe.interpolationToNext, keyPath + ".interpolationToNext", issues, definition.discrete);
    });
    if (definition.value === "deformation") {
      const ordered = [...channel.keyframes].sort((a, b) => a.timeTicks - b.timeTicks);
      for (let keyIndex = 0; keyIndex < ordered.length - 1; keyIndex += 1) {
        const current = ordered[keyIndex];
        const next = ordered[keyIndex + 1];
        if (current.interpolationToNext?.kind !== "step" &&
          current.value?.deformationSampleId !== next.value?.deformationSampleId) {
          issues.push(problem(
            "ANIMATION_MESH_SAMPLE_INCOMPATIBLE",
            channelPath,
            "Continuous interpolation requires the same deformationSampleId at both endpoints.",
            track.trackId,
          ));
        }
      }
    }
  }
}

function validateDrawOrderConflicts(program, project, path, issues) {
  const tracks = program.tracks.filter((track) =>
    track?.kind === "DrawOrderTrack" &&
    Array.isArray(track.channels?.drawOrder?.keyframes) &&
    track.channels.drawOrder.keyframes.every((keyframe) =>
      typeof keyframe?.id === "string" &&
      validTime(keyframe.timeTicks) &&
      Number.isSafeInteger(keyframe.value) &&
      keyframe.interpolationToNext?.kind === "step"));
  if (tracks.length < 2) return;

  const transitionOwner = (project.transitions || []).find((transition) =>
    transition.temporalProgramId === program.id);
  const sampleTimes = new Set([0, program.durationTicks]);
  for (const track of tracks) {
    for (const keyframe of track.channels.drawOrder.keyframes) {
      if (keyframe.timeTicks <= program.durationTicks) {
        sampleTimes.add(keyframe.timeTicks);
      }
    }
  }
  for (const timeTicks of [...sampleTimes].sort((a, b) => a - b)) {
    const byDrawOrder = new Map();
    for (const track of tracks) {
      const drawOrder = sampleKeyframes(
        track.channels.drawOrder.keyframes,
        timeTicks,
      );
      if (drawOrder === null) continue;
      const trackIds = byDrawOrder.get(drawOrder) || [];
      trackIds.push(track.trackId);
      byDrawOrder.set(drawOrder, trackIds);
    }
    for (const [drawOrder, trackIds] of byDrawOrder) {
      if (trackIds.length < 2) continue;
      issues.push(problem(
        "ANIMATION_TRACK_CONFLICT",
        path + ".tracks",
        "DrawOrderTrack values must be unique within the Phase 2A TemporalProgram scope.",
        program.id,
        "error",
        {
          trackKind: "DrawOrderTrack",
          scope: transitionOwner ? "transition" : "temporal-program",
          ...(transitionOwner ? { transitionId: transitionOwner.id } : {}),
          timeTicks,
          drawOrder,
          trackIds: [...trackIds].sort(),
        },
      ));
    }
  }
}

function validateDuplicateTrackTargets(program, path, issues) {
  const owners = new Map();
  for (const track of program.tracks) {
    if (!track?.kind || !track?.target || !track?.channels) continue;
    const targetKey = JSON.stringify(Object.fromEntries(Object.entries(track.target).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0)));
    for (const channel of Object.keys(track.channels).sort()) {
      const key = track.kind + "\u0000" + targetKey + "\u0000" + channel;
      const previous = owners.get(key);
      if (previous) {
        issues.push(problem(
          "ANIMATION_TRACK_CONFLICT",
          path + ".tracks",
          "Tracks at the same target specificity may not author the same typed channel twice.",
          program.id,
          "error",
          { trackKind: track.kind, target: track.target, channel, trackIds: [previous, track.trackId].sort() },
        ));
      } else owners.set(key, track.trackId);
    }
  }
}

export function validateTemporalPrograms(project, registerExternal = null) {
  const issues = [];
  const localIds = new Map();
  const register = registerExternal || ((id, path) => {
    if (localIds.has(id)) issues.push(problem("identity.duplicate", path, "Duplicate stable ID " + id + ".", id));
    else localIds.set(id, path);
  });
  if (!Array.isArray(project.temporalPrograms)) {
    return [problem("collection.invalid", "temporalPrograms", "temporalPrograms must be an array.")];
  }
  project.temporalPrograms.forEach((program, index) => {
    const path = "temporalPrograms." + index;
    if (!object(program) || typeof program.id !== "string" || !program.id) {
      issues.push(problem("identity.missing", path + ".id", "Stable program ID is required."));
      return;
    }
    register(program.id, path + ".id");
    if (!hasExactKeys(program, ["id", "durationTicks", "tracks", "events", "regions"])) {
      issues.push(problem("ANIMATION_INVALID_PROGRAM", path, "TemporalProgram contains missing or unknown fields.", program.id));
    }
    if (!Number.isSafeInteger(program.durationTicks) || program.durationTicks <= 0) {
      issues.push(problem("ANIMATION_INVALID_DURATION", path + ".durationTicks", "Program duration must be a positive safe integer.", program.id));
    }
    if (!Array.isArray(program.tracks) || !Array.isArray(program.events) || !Array.isArray(program.regions)) {
      issues.push(problem("ANIMATION_INVALID_PROGRAM", path, "Program tracks, events, and regions must be arrays.", program.id));
      return;
    }
    program.tracks.forEach((track, trackIndex) =>
      validateTrack(track, program, project, path + ".tracks." + trackIndex, issues, register));
    validateDuplicateTrackTargets(program, path, issues);
    validateDrawOrderConflicts(program, project, path, issues);
    program.events.forEach((event, eventIndex) => {
      const eventPath = path + ".events." + eventIndex;
      if (!object(event) || typeof event.id !== "string" || !event.id) {
        issues.push(problem("identity.missing", eventPath + ".id", "Stable event ID is required."));
        return;
      }
      register(event.id, eventPath + ".id");
      if (!hasExactKeys(event, ["id", "timeTicks", "type", "participants", "payload"])) {
        issues.push(problem("ANIMATION_INVALID_EVENT", eventPath, "Motion event contains missing or unknown fields.", event.id));
      }
      if (!validTime(event.timeTicks) || event.timeTicks > program.durationTicks) {
        issues.push(problem("ANIMATION_INVALID_TIME", eventPath + ".timeTicks", "Event time must lie within the program.", event.id));
      }
      if (!EVENT_TYPES.has(event.type)) {
        issues.push(problem("ANIMATION_INVALID_EVENT", eventPath + ".type", "Unknown motion event type.", event.id));
      }
      if (!Array.isArray(event.participants) || event.participants.some((id) => typeof id !== "string" || !id)) {
        issues.push(problem("ANIMATION_INVALID_EVENT", eventPath + ".participants", "Event participants must be stable ID strings.", event.id));
      }
      for (const participantId of event.participants || []) {
        const known = Boolean(project.scene?.nodes?.[participantId]) ||
          (project.semanticSlots || []).some((slot) => slot.id === participantId);
        if (!known) {
          issues.push(problem("ANIMATION_UNKNOWN_TARGET", eventPath + ".participants", "Event participant does not exist.", participantId));
        }
      }
      if (!object(event.payload)) {
        issues.push(problem("ANIMATION_INVALID_EVENT", eventPath + ".payload", "Event payload must be an object.", event.id));
      }
    });
    program.regions.forEach((region, regionIndex) => {
      const regionPath = path + ".regions." + regionIndex;
      if (!object(region) || typeof region.id !== "string" || !region.id) {
        issues.push(problem("identity.missing", regionPath + ".id", "Stable region ID is required."));
        return;
      }
      register(region.id, regionPath + ".id");
      if (!hasExactKeys(region, ["id", "startTicks", "endTicks", "type", "metadata"])) {
        issues.push(problem("ANIMATION_INVALID_REGION", regionPath, "Motion region contains missing or unknown fields.", region.id));
      }
      if (!validTime(region.startTicks) || !validTime(region.endTicks) ||
        region.startTicks > region.endTicks || region.endTicks > program.durationTicks) {
        issues.push(problem("ANIMATION_INVALID_TIME", regionPath, "Region must satisfy 0 <= startTicks <= endTicks <= durationTicks.", region.id));
      }
      if (!REGION_TYPES.has(region.type)) {
        issues.push(problem("ANIMATION_INVALID_REGION", regionPath + ".type", "Unknown motion region type.", region.id));
      }
      if (!object(region.metadata)) {
        issues.push(problem("ANIMATION_INVALID_REGION", regionPath + ".metadata", "Region metadata must be an object.", region.id));
      }
    });
  });
  return issues;
}
