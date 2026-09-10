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

function owners(project) {
  return [
    ...(project.transitions || []).map((entity, index) => ({
      kind: "Transition",
      id: entity?.id,
      temporalProgramId: entity?.temporalProgramId,
      path: "transitions." + index + ".temporalProgramId",
    })),
    ...(project.animation?.clips || []).map((entity, index) => ({
      kind: "AnimationClip",
      id: entity?.id,
      temporalProgramId: entity?.temporalProgramId,
      path: "animation.clips." + index + ".temporalProgramId",
    })),
    ...(project.sequences || []).map((entity, index) => ({
      kind: "Sequence",
      id: entity?.id,
      temporalProgramId: entity?.temporalProgramId,
      path: "sequences." + index + ".temporalProgramId",
    })),
  ].filter((owner) => typeof owner.temporalProgramId === "string" && owner.temporalProgramId);
}

export function temporalProgramOwners(project) {
  const result = new Map();
  for (const owner of owners(project)) {
    const entries = result.get(owner.temporalProgramId) || [];
    entries.push(owner);
    result.set(owner.temporalProgramId, entries);
  }
  for (const entries of result.values()) {
    entries.sort((left, right) =>
      (left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0) ||
      (String(left.id) < String(right.id) ? -1 : String(left.id) > String(right.id) ? 1 : 0));
  }
  return result;
}

export function validateTemporalProgramOwnership(project) {
  const issues = [];
  for (const [programId, programOwners] of [...temporalProgramOwners(project).entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    if (programOwners.length < 2) continue;
    const details = {
      temporalProgramId: programId,
      owners: programOwners.map(({ kind, id }) => ({ kind, id })),
    };
    for (const owner of programOwners) {
      issues.push(problem(
        "TEMPORAL_PROGRAM_OWNERSHIP_CONFLICT",
        owner.path,
        "A TemporalProgram may be owned by only one Transition, AnimationClip, or Sequence.",
        owner.id,
        details,
      ));
    }
  }
  return issues;
}

export function validateTemporalProgramOwnerTracks(project) {
  const issues = [];
  const ownersByProgram = temporalProgramOwners(project);

  (project.temporalPrograms || []).forEach((program, programIndex) => {
    const programOwners = ownersByProgram.get(program?.id) || [];
    const soleOwner = programOwners.length === 1 ? programOwners[0] : null;
    const sequenceOwner = soleOwner?.kind === "Sequence" ? soleOwner : null;
    const tracks = Array.isArray(program?.tracks) ? program.tracks : [];

    tracks.forEach((track, trackIndex) => {
      const path = "temporalPrograms." + programIndex + ".tracks." + trackIndex;
      if (track?.kind === "CameraTrack" && !sequenceOwner) {
        issues.push(problem(
          "ANIMATION_TRACK_OWNER_INVALID",
          path + ".kind",
          "CameraTrack is valid only in a Sequence-owned TemporalProgram.",
          track?.trackId || program?.id,
          {
            temporalProgramId: program?.id,
            owners: programOwners.map(({ kind, id }) => ({ kind, id })),
          },
        ));
      } else if (sequenceOwner && track?.kind !== "CameraTrack") {
        issues.push(problem(
          "ANIMATION_TRACK_OWNER_INVALID",
          path + ".kind",
          "A Sequence-owned TemporalProgram may initially contain only CameraTrack.",
          track?.trackId || program?.id,
          {
            temporalProgramId: program?.id,
            owner: { kind: sequenceOwner.kind, id: sequenceOwner.id },
            trackKind: track?.kind,
          },
        ));
      }
    });

    const cameraTracks = tracks.filter((track) => track?.kind === "CameraTrack");
    if (sequenceOwner && cameraTracks.length > 1) {
      issues.push(problem(
        "SEQUENCE_CAMERA_TRACK_MULTIPLE",
        "temporalPrograms." + programIndex + ".tracks",
        "A Sequence-owned TemporalProgram may contain at most one CameraTrack.",
        sequenceOwner.id,
        {
          temporalProgramId: program.id,
          trackIds: cameraTracks.map((track) => track.trackId).sort(),
        },
      ));
    }
  });

  return issues;
}

export function validateTemporalProgramOwnershipChange(beforeProject, afterProject) {
  const issues = [];
  const afterSequenceIds = new Set((afterProject.sequences || []).map((entry) => entry.id));
  const afterProgramIds = new Set((afterProject.temporalPrograms || []).map((entry) => entry.id));

  for (const sequence of [...(beforeProject.sequences || [])]
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)) {
    if (afterSequenceIds.has(sequence.id) || !afterProgramIds.has(sequence.temporalProgramId)) {
      continue;
    }
    issues.push(problem(
      "SEQUENCE_PROGRAM_REMOVAL_NOT_ATOMIC",
      "sequences",
      "Removing a Sequence and its owned TemporalProgram must be one transaction.",
      sequence.id,
      { temporalProgramId: sequence.temporalProgramId },
    ));
  }

  return issues;
}
