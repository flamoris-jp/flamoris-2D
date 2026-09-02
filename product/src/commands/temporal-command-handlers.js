import { cloneProject } from "../model/project.js";
import { CommandError } from "./errors.js";

function temporalProgramFor(project, programId) {
  const program = project.temporalPrograms.find((entry) => entry.id === programId);
  if (!program) {
    throw new CommandError("Unknown TemporalProgram " + programId + ".", "animation.program_not_found", { programId });
  }
  return program;
}

function temporalTrackFor(program, trackId) {
  const track = program.tracks.find((entry) => entry.trackId === trackId);
  if (!track) {
    throw new CommandError("Unknown temporal track " + trackId + ".", "animation.track_not_found", { trackId });
  }
  return track;
}

function temporalChannelFor(track, channelName) {
  const channel = track.channels?.[channelName];
  if (!channel) {
    throw new CommandError("Unknown temporal channel " + channelName + ".", "animation.channel_not_found", { channelName });
  }
  return channel;
}

function keyframeIndex(channel, keyframeId) {
  const index = channel.keyframes.findIndex((entry) => entry.id === keyframeId);
  if (index < 0) {
    throw new CommandError("Unknown keyframe " + keyframeId + ".", "animation.keyframe_not_found", { keyframeId });
  }
  return index;
}

export const temporalCommandHandlers = {
  "animation.temporal.create_program": (project, payload) => {
    if (project.temporalPrograms.some((entry) => entry.id === payload.programId)) {
      throw new CommandError("TemporalProgram ID already exists.", "identity.duplicate", { programId: payload.programId });
    }
    project.temporalPrograms.push({
      id: payload.programId,
      durationTicks: payload.durationTicks,
      tracks: [],
      events: [],
      regions: [],
    });
    return {
      inverse: { type: "animation.temporal.remove_program", payload: { programId: payload.programId } },
      affectedIds: [payload.programId],
    };
  },

  "animation.temporal.remove_program": (project, payload) => {
    const index = project.temporalPrograms.findIndex((entry) => entry.id === payload.programId);
    if (index < 0) throw new CommandError("Unknown TemporalProgram.", "animation.program_not_found");
    const [program] = project.temporalPrograms.splice(index, 1);
    return {
      inverse: { type: "animation.temporal.restore_program", payload: { program, index } },
      affectedIds: [payload.programId],
    };
  },

  "animation.temporal.restore_program": (project, payload) => {
    project.temporalPrograms.splice(payload.index, 0, cloneProject(payload.program));
    return {
      inverse: { type: "animation.temporal.remove_program", payload: { programId: payload.program.id } },
      affectedIds: [payload.program.id],
    };
  },

  "animation.temporal.add_track": (project, payload) => {
    const program = temporalProgramFor(project, payload.programId);
    if (program.tracks.some((entry) => entry.trackId === payload.track.trackId)) {
      throw new CommandError("Temporal track ID already exists.", "identity.duplicate", { trackId: payload.track.trackId });
    }
    program.tracks.push(cloneProject(payload.track));
    return {
      inverse: {
        type: "animation.temporal.remove_track",
        payload: { programId: program.id, trackId: payload.track.trackId },
      },
      affectedIds: [program.id, payload.track.trackId],
    };
  },

  "animation.temporal.remove_track": (project, payload) => {
    const program = temporalProgramFor(project, payload.programId);
    const index = program.tracks.findIndex((entry) => entry.trackId === payload.trackId);
    if (index < 0) throw new CommandError("Unknown temporal track.", "animation.track_not_found");
    const [track] = program.tracks.splice(index, 1);
    return {
      inverse: {
        type: "animation.temporal.restore_track",
        payload: { programId: program.id, track, index },
      },
      affectedIds: [program.id, track.trackId],
    };
  },

  "animation.temporal.restore_track": (project, payload) => {
    const program = temporalProgramFor(project, payload.programId);
    program.tracks.splice(payload.index, 0, cloneProject(payload.track));
    return {
      inverse: {
        type: "animation.temporal.remove_track",
        payload: { programId: program.id, trackId: payload.track.trackId },
      },
      affectedIds: [program.id, payload.track.trackId],
    };
  },

  "animation.temporal.add_keyframe": (project, payload) => {
    const program = temporalProgramFor(project, payload.programId);
    const track = temporalTrackFor(program, payload.trackId);
    const channel = temporalChannelFor(track, payload.channel);
    channel.keyframes.push(cloneProject(payload.keyframe));
    return {
      inverse: {
        type: "animation.temporal.remove_keyframe",
        payload: {
          programId: program.id,
          trackId: track.trackId,
          channel: payload.channel,
          keyframeId: payload.keyframe.id,
        },
      },
      affectedIds: [program.id, track.trackId, payload.keyframe.id],
    };
  },

  "animation.temporal.update_keyframe": (project, payload) => {
    const program = temporalProgramFor(project, payload.programId);
    const track = temporalTrackFor(program, payload.trackId);
    const channel = temporalChannelFor(track, payload.channel);
    const index = keyframeIndex(channel, payload.keyframeId);
    if (payload.keyframe.id !== payload.keyframeId) {
      throw new CommandError("Keyframe updates must preserve the stable ID.", "animation.keyframe_identity_changed");
    }
    const previous = cloneProject(channel.keyframes[index]);
    channel.keyframes[index] = cloneProject(payload.keyframe);
    return {
      inverse: {
        type: "animation.temporal.update_keyframe",
        payload: {
          programId: program.id,
          trackId: track.trackId,
          channel: payload.channel,
          keyframeId: payload.keyframe.id,
          keyframe: previous,
        },
      },
      affectedIds: [program.id, track.trackId, payload.keyframe.id],
    };
  },

  "animation.temporal.remove_keyframe": (project, payload) => {
    const program = temporalProgramFor(project, payload.programId);
    const track = temporalTrackFor(program, payload.trackId);
    const channel = temporalChannelFor(track, payload.channel);
    const index = keyframeIndex(channel, payload.keyframeId);
    const [keyframe] = channel.keyframes.splice(index, 1);
    return {
      inverse: {
        type: "animation.temporal.restore_keyframe",
        payload: { programId: program.id, trackId: track.trackId, channel: payload.channel, keyframe, index },
      },
      affectedIds: [program.id, track.trackId, keyframe.id],
    };
  },

  "animation.temporal.restore_keyframe": (project, payload) => {
    const program = temporalProgramFor(project, payload.programId);
    const track = temporalTrackFor(program, payload.trackId);
    const channel = temporalChannelFor(track, payload.channel);
    channel.keyframes.splice(payload.index, 0, cloneProject(payload.keyframe));
    return {
      inverse: {
        type: "animation.temporal.remove_keyframe",
        payload: { programId: program.id, trackId: track.trackId, channel: payload.channel, keyframeId: payload.keyframe.id },
      },
      affectedIds: [program.id, track.trackId, payload.keyframe.id],
    };
  },

  "animation.temporal.add_event": (project, payload) => {
    const program = temporalProgramFor(project, payload.programId);
    program.events.push(cloneProject(payload.event));
    return {
      inverse: { type: "animation.temporal.remove_event", payload: { programId: program.id, eventId: payload.event.id } },
      affectedIds: [program.id, payload.event.id],
    };
  },

  "animation.temporal.remove_event": (project, payload) => {
    const program = temporalProgramFor(project, payload.programId);
    const index = program.events.findIndex((entry) => entry.id === payload.eventId);
    if (index < 0) throw new CommandError("Unknown motion event.", "animation.event_not_found");
    const [event] = program.events.splice(index, 1);
    return {
      inverse: { type: "animation.temporal.restore_event", payload: { programId: program.id, event, index } },
      affectedIds: [program.id, event.id],
    };
  },

  "animation.temporal.restore_event": (project, payload) => {
    const program = temporalProgramFor(project, payload.programId);
    program.events.splice(payload.index, 0, cloneProject(payload.event));
    return {
      inverse: { type: "animation.temporal.remove_event", payload: { programId: program.id, eventId: payload.event.id } },
      affectedIds: [program.id, payload.event.id],
    };
  },

  "animation.temporal.add_region": (project, payload) => {
    const program = temporalProgramFor(project, payload.programId);
    program.regions.push(cloneProject(payload.region));
    return {
      inverse: { type: "animation.temporal.remove_region", payload: { programId: program.id, regionId: payload.region.id } },
      affectedIds: [program.id, payload.region.id],
    };
  },

  "animation.temporal.remove_region": (project, payload) => {
    const program = temporalProgramFor(project, payload.programId);
    const index = program.regions.findIndex((entry) => entry.id === payload.regionId);
    if (index < 0) throw new CommandError("Unknown motion region.", "animation.region_not_found");
    const [region] = program.regions.splice(index, 1);
    return {
      inverse: { type: "animation.temporal.restore_region", payload: { programId: program.id, region, index } },
      affectedIds: [program.id, region.id],
    };
  },

  "animation.temporal.restore_region": (project, payload) => {
    const program = temporalProgramFor(project, payload.programId);
    program.regions.splice(payload.index, 0, cloneProject(payload.region));
    return {
      inverse: { type: "animation.temporal.remove_region", payload: { programId: program.id, regionId: payload.region.id } },
      affectedIds: [program.id, payload.region.id],
    };
  },
};
