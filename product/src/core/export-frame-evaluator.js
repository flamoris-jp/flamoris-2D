import { evaluateTransition } from "./transition-evaluator.js";
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

/**
 * Projects an export frame onto the canonical tick grid and delegates the
 * evaluated state to the production Transition evaluator used by preview.
 */
export function evaluateTransitionExportFrame(
  project,
  { transitionId, frameRate, frameIndex },
) {
  const planner = planTransitionExportFrames(project, transitionId, frameRate);
  const frame = planner.frameAt(frameIndex);
  return {
    frame,
    evaluatedTransition: evaluateTransition(project, transitionId, frame.timeTicks),
  };
}
