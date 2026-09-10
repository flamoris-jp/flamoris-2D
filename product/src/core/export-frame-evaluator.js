import { evaluateTransition } from "./transition-evaluator.js";
import { evaluateSequence } from "./sequence-evaluator.js";
import { ExportFramePlanner } from "./export-frame-planner.js";

function transitionProgram(project, transitionId) {
  const transition = project.transitions.find((entry) => entry.id === transitionId);
  if (!transition) throw new Error("Unknown Transition " + transitionId + ".");
  const program = project.temporalPrograms.find((entry) =>
    entry.id === transition.temporalProgramId);
  if (!program) {
    throw new Error("Unknown TemporalProgram " + transition.temporalProgramId + ".");
  }
  return program;
}

export function planTransitionExportFrames(project, transitionId, frameRate) {
  const program = transitionProgram(project, transitionId);
  return new ExportFramePlanner({
    durationTicks: program.durationTicks,
    frameRate,
  });
}

function sequenceProgram(project, sequenceId) {
  const sequence = project.sequences.find((entry) => entry.id === sequenceId);
  if (!sequence) throw new Error("Unknown Sequence " + sequenceId + ".");
  const program = project.temporalPrograms.find((entry) =>
    entry.id === sequence.temporalProgramId);
  if (!program) throw new Error("Unknown TemporalProgram " + sequence.temporalProgramId + ".");
  return program;
}

export function planSequenceExportFrames(project, sequenceId, frameRate) {
  const program = sequenceProgram(project, sequenceId);
  return new ExportFramePlanner({ durationTicks: program.durationTicks, frameRate });
}

export function planEvaluatedExportFrames(project, { transitionId, sequenceId }, frameRate) {
  if (sequenceId) return planSequenceExportFrames(project, sequenceId, frameRate);
  return planTransitionExportFrames(project, transitionId, frameRate);
}

export function evaluateExportFrame(
  project,
  { transitionId = null, sequenceId = null, frameRate, frameIndex },
) {
  const planner = planEvaluatedExportFrames(project, { transitionId, sequenceId }, frameRate);
  const frame = planner.frameAt(frameIndex);
  const evaluation = sequenceId
    ? evaluateSequence(project, sequenceId, frame.timeTicks)
    : evaluateTransition(project, transitionId, frame.timeTicks);
  return {
    frame,
    evaluation,
    ...(sequenceId
      ? { evaluatedSequence: evaluation }
      : { evaluatedTransition: evaluation }),
  };
}

/**
 * Projects an export frame onto the canonical tick grid and delegates the
 * evaluated state to the production Transition evaluator used by preview.
 */
export function evaluateTransitionExportFrame(
  project,
  { transitionId, frameRate, frameIndex },
) {
  return evaluateExportFrame(project, { transitionId, frameRate, frameIndex });
}
