import { cloneProject } from "../model/project.js";

const SEVERITIES = new Set(["error", "warning", "info"]);

function rendererDiagnostic(transitionId, message, index) {
  return {
    key: `renderer|${transitionId}|${index}|${message}`,
    code: "TRANSITION_RENDERER_UNSUPPORTED",
    severity: "warning",
    message,
    transitionId,
    source: "renderer",
    authorityImpact: "blocks",
    target: { transitionId, preview: true },
  };
}

function diagnosticTarget(entry) {
  const details = entry.details || {};
  const missingEndpoints = Array.isArray(details.missingEndpoints)
    ? details.missingEndpoints : [];
  return {
    transitionId: entry.transitionId || null,
    semanticSlotId: entry.semanticSlotId || details.semanticSlotId || null,
    endpoint: details.endpoint || (missingEndpoints.length === 1 ? missingEndpoints[0] : null),
    topologyId: details.topologyId || null,
    keyformId: details.keyformId || null,
    fromKeyformId: details.fromKeyformId || null,
    toKeyformId: details.toKeyformId || null,
    trackId: details.trackId || entry.trackId || null,
    channel: details.channel || entry.channel || null,
    keyframeId: details.keyframeId || entry.keyframeId || null,
    preview: false,
  };
}

function projectCoreDiagnostic(entry, source) {
  const severity = SEVERITIES.has(entry.severity) ? entry.severity : "error";
  return {
    ...cloneProject(entry),
    key: entry.key || `${source}|${entry.code}|${entry.transitionId || "-"}|${entry.semanticSlotId || "-"}`,
    severity,
    message: entry.message || entry.code,
    source,
    authorityImpact: severity === "error" ? "blocks" : "advisory",
    target: diagnosticTarget(entry),
  };
}

function uniqueDiagnostics(entries) {
  const byKey = new Map();
  for (const entry of entries) {
    const existing = byKey.get(entry.key);
    if (!existing || (existing.source === "validation" && entry.source === "evaluation")) {
      byKey.set(entry.key, entry);
    }
  }
  return [...byKey.values()];
}

/**
 * Projects existing validation/evaluation diagnostics and renderer capability
 * reports into one preview contract. It does not re-evaluate Transition
 * semantics; authority follows source severity plus renderer support status.
 */
export function projectTransitionPreviewDiagnostics({
  transitionId,
  validationDiagnostics = [],
  evaluation = null,
  evaluationError = null,
  renderReport = null,
}) {
  const diagnostics = [
    ...validationDiagnostics.map((entry) => projectCoreDiagnostic(entry, "validation")),
    ...(evaluation?.diagnostics || []).map((entry) => projectCoreDiagnostic(entry, "evaluation")),
  ];

  if (evaluationError) {
    diagnostics.push({
      key: `evaluation-error|${transitionId}|${evaluationError.message || String(evaluationError)}`,
      code: "TRANSITION_EVALUATION_ERROR",
      severity: "error",
      message: evaluationError.message || String(evaluationError),
      transitionId,
      source: "evaluation",
      authorityImpact: "blocks",
      target: { transitionId, preview: true },
    });
  }

  if (evaluation && !renderReport) {
    diagnostics.push({
      key: `renderer-pending|${transitionId}`,
      code: "TRANSITION_RENDERER_VALIDATION_PENDING",
      severity: "info",
      message: "Renderer validation pending or unavailable.",
      transitionId,
      source: "renderer",
      authorityImpact: "blocks",
      target: { transitionId, preview: true },
    });
  } else if (renderReport) {
    diagnostics.push(...(renderReport.unsupportedReasons || []).map((message, index) =>
      rendererDiagnostic(transitionId, message, index)));
  }

  const projected = uniqueDiagnostics(diagnostics);
  const blockers = projected.filter((entry) => entry.authorityImpact === "blocks");
  return {
    diagnostics: projected,
    authoritative: Boolean(evaluation && renderReport && blockers.length === 0),
    authorityReasons: blockers.map((entry) => entry.message),
  };
}
