function targetText(target = {}) {
  return [
    target.semanticSlotId && `SemanticSlot ${target.semanticSlotId}`,
    target.endpoint && `Endpoint ${target.endpoint === "from" ? "A" : "B"}`,
    target.partTransitionId && `PartTransition ${target.partTransitionId}`,
    target.nodeId && `Node ${target.nodeId}`,
    target.fromNodeId && `A node ${target.fromNodeId}`,
    target.toNodeId && `B node ${target.toNodeId}`,
    target.topologyId && `Topology ${target.topologyId}`,
    (target.keyformId || target.fromKeyformId || target.toKeyformId) &&
      `Keyform ${target.keyformId || target.fromKeyformId || target.toKeyformId}`,
    target.trackId && `Track ${target.trackId}`,
    target.keyframeId && `Keyframe ${target.keyframeId}`,
    target.preview && "Transition Preview",
  ].filter(Boolean).join(" · ");
}

function diagnosticItem(diagnostic, selected) {
  const item = document.createElement("li");
  item.className = "diagnostic-item";
  item.dataset.severity = diagnostic.severity;
  item.classList.toggle("selected", selected);
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.diagnosticKey = diagnostic.key;
  button.setAttribute("aria-label", `Focus ${diagnostic.code}`);

  const heading = document.createElement("span");
  heading.className = "diagnostic-heading";
  heading.textContent = `${diagnostic.severity.toUpperCase()} · ${diagnostic.code}`;
  const message = document.createElement("span");
  message.className = "diagnostic-message";
  message.textContent = diagnostic.message;
  const context = document.createElement("span");
  context.className = "diagnostic-context";
  context.textContent = [
    diagnostic.source,
    diagnostic.authorityImpact === "blocks" ? "Blocks preview authority" : "Advisory",
    `Transition ${diagnostic.transitionId || "missing"}`,
    targetText(diagnostic.target),
    diagnostic.timeTicks != null && `Tick ${diagnostic.timeTicks}`,
  ].filter(Boolean).join(" · ");
  button.append(heading, message, context);
  item.append(button);
  return item;
}

export function createTransitionDiagnosticsView({ state, elements, setStatus }) {
  function controller() {
    return state.editor?.transitionDiagnostics || null;
  }

  elements.transitionDiagnosticsList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-diagnostic-key]");
    if (!button) return;
    try {
      const result = controller()?.focusDiagnostic(button.dataset.diagnosticKey);
      elements.transitionDiagnosticFocusStatus.textContent = result?.missing
        ? "Diagnostic target is currently missing. Undo/Redo restoration is safe."
        : result?.focused
          ? "Focused the referenced authoring context."
          : "Diagnostic has no more specific focus target.";
      render();
    } catch (error) {
      console.error(error);
      setStatus(error.message || String(error));
      render();
    }
  });

  function render() {
    const diagnostics = controller();
    elements.transitionDiagnosticsCard.hidden = !diagnostics;
    if (!diagnostics) return;
    const diagnosticState = diagnostics.getState();
    const hasTransition = Boolean(diagnosticState.transitionId);
    elements.transitionDiagnosticsAuthority.textContent = diagnosticState.authoritative
      ? "Authoritative preview · no blocking diagnostics"
      : "Non-authoritative preview";
    elements.transitionDiagnosticsAuthority.dataset.authority = diagnosticState.authoritative ? "yes" : "no";
    const items = diagnosticState.diagnostics.map((entry) => diagnosticItem(
      entry,
      entry.key === diagnosticState.selectedDiagnosticKey,
    ));
    if (!items.length) {
      const empty = document.createElement("li");
      empty.className = "panel-empty";
      empty.textContent = hasTransition
        ? "No diagnostics for the current evaluated/rendered state."
        : "Select an active Transition";
      items.push(empty);
    }
    elements.transitionDiagnosticsList.replaceChildren(...items);
    if (diagnosticState.selectedDiagnosticMissing) {
      elements.transitionDiagnosticFocusStatus.textContent =
        "Selected diagnostic is no longer present. It can be focused again if the same stable target returns.";
    }
  }

  return { render };
}
