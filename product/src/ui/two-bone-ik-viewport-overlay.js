import { imageToScreen } from "../mesh.js";

function project(point, view) {
  return imageToScreen(point.x, point.y, view);
}

export function projectTwoBoneIkOverlay({ authoring, chain, view }) {
  if (!authoring?.activeConstraint || !chain || !view) {
    return { joints: [], segments: [], target: null, diagnostics: [] };
  }
  const preview = authoring.preview;
  const documentJoints = preview?.solution?.joints || {
    root: chain.root.head,
    mid: chain.mid.head,
    end: chain.end.head,
  };
  const joints = ["root", "mid", "end"].map((kind) => ({
    kind,
    screen: project(documentJoints[kind], view),
    document: { ...documentJoints[kind] },
  }));
  const targetDocument = authoring.target || documentJoints.end;
  return {
    joints,
    segments: [
      { from: joints[0].screen, to: joints[1].screen },
      { from: joints[1].screen, to: joints[2].screen },
    ],
    target: {
      screen: project(targetDocument, view),
      document: { ...targetDocument },
    },
    diagnostics: [...(preview?.diagnostics || [])],
  };
}

export function hitTwoBoneIkTarget(overlay, screenPoint, radius = 12) {
  if (!overlay?.target) return false;
  return Math.hypot(
    overlay.target.screen.x - screenPoint.x,
    overlay.target.screen.y - screenPoint.y,
  ) <= radius;
}
