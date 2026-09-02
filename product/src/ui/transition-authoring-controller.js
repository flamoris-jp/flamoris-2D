import { cloneProject } from "../model/project.js";

export const PART_TRANSITION_MODES = Object.freeze([
  "morph",
  "hold",
  "replace",
  "appear",
  "disappear",
  "occlusion",
]);

function defaultIdFactory() {
  let sequence = 0;
  const nonce = Date.now().toString(36);
  return (kind) => `${kind}_${nonce}_${String(++sequence).padStart(4, "0")}`;
}

function mappingFor(slot, keyArtId) {
  if (!slot || !keyArtId) return null;
  return (slot.mappings || []).find((mapping) =>
    mapping.keyArtId === keyArtId) || null;
}

function mappingProjection(project, keyArt, mapping) {
  if (!mapping) return { mapping: null, node: null, valid: false, missing: false };
  const node = project.scene?.nodes?.[mapping.nodeId] || null;
  const isMember = Boolean(keyArt?.members?.some((member) =>
    member.nodeId === mapping.nodeId));
  return {
    mapping: cloneProject(mapping),
    node: node ? cloneProject(node) : null,
    valid: Boolean(keyArt && node && isMember),
    missing: !keyArt || !node || !isMember,
  };
}

function slotStatus(from, to) {
  if (from.missing || to.missing) return "missing-invalid";
  if (from.valid && to.valid) return "mapped";
  if (from.valid) return "a-only";
  if (to.valid) return "b-only";
  return "unmapped";
}

function morphReferences(project, transition, slot, part) {
  const existing = part?.topologyId && part?.fromKeyformId && part?.toKeyformId
    ? {
        topologyId: part.topologyId,
        fromKeyformId: part.fromKeyformId,
        toKeyformId: part.toKeyformId,
      }
    : null;
  const candidates = existing ? [existing] : (project.meshTopologies || []).map((topology) => {
    const from = (project.meshKeyforms || []).find((keyform) =>
      keyform.topologyId === topology.id &&
      keyform.keyArtId === transition.fromKeyArtId &&
      keyform.semanticSlotId === slot.id);
    const to = (project.meshKeyforms || []).find((keyform) =>
      keyform.topologyId === topology.id &&
      keyform.keyArtId === transition.toKeyArtId &&
      keyform.semanticSlotId === slot.id);
    return from && to
      ? { topologyId: topology.id, fromKeyformId: from.id, toKeyformId: to.id }
      : null;
  }).filter(Boolean);
  const refs = candidates[0] || null;
  if (!refs) return null;
  const topology = (project.meshTopologies || []).find((entry) => entry.id === refs.topologyId);
  const from = (project.meshKeyforms || []).find((entry) => entry.id === refs.fromKeyformId);
  const to = (project.meshKeyforms || []).find((entry) => entry.id === refs.toKeyformId);
  return topology && from && to ? refs : null;
}

function modeAvailability(status, morphRefs) {
  return {
    morph: status === "mapped" && Boolean(morphRefs),
    hold: ["mapped", "a-only", "b-only"].includes(status),
    replace: status === "mapped",
    appear: status === "b-only",
    disappear: status === "a-only",
    occlusion: status === "mapped",
  };
}

function modeConfiguration(mode, configuration, previous = {}) {
  if (mode === "hold") {
    return { holdEndpoint: configuration.holdEndpoint || previous.holdEndpoint || "from" };
  }
  if (mode === "replace") {
    const compositeGroupId = configuration.compositeGroupId ?? previous.compositeGroupId;
    return compositeGroupId ? { compositeGroupId } : {};
  }
  return {};
}

export class TransitionAuthoringController {
  constructor(session, { onChange = null, idFactory = defaultIdFactory() } = {}) {
    this.session = session;
    this.onChange = onChange;
    this.idFactory = idFactory;
    this.activeTransitionId = null;
    this.selectedKeyArtId = null;
    this.selectedSemanticSlotId = null;
  }

  notify(reason) {
    this.onChange?.(reason, this);
  }

  selectTransition(transitionId) {
    if (transitionId !== null) {
      const exists = this.session.query("transition.list")
        .some((transition) => transition.id === transitionId);
      if (!exists) throw new Error(`Unknown Transition ${transitionId}.`);
    }
    this.activeTransitionId = transitionId;
    this.selectedSemanticSlotId = null;
    this.notify("transition-selection");
  }

  selectKeyArt(keyArtId) {
    if (keyArtId !== null) this.session.query("keyart.get", { keyArtId });
    this.selectedKeyArtId = keyArtId;
    this.notify("keyart-selection");
  }

  selectSemanticSlot(semanticSlotId) {
    if (semanticSlotId !== null) {
      this.session.query("semantic_slot.get", { semanticSlotId });
    }
    this.selectedSemanticSlotId = semanticSlotId;
    this.notify("semantic-slot-selection");
  }

  createTransitionWithProgram({
    transitionId = this.idFactory("transition"),
    programId = this.idFactory("program"),
    displayName,
    fromKeyArtId,
    toKeyArtId,
    durationTicks,
  }) {
    const commands = [
      {
        type: "animation.temporal.create_program",
        payload: { programId, durationTicks },
      },
      {
        type: "transition.create",
        payload: {
          transition: {
            id: transitionId,
            displayName,
            fromKeyArtId,
            toKeyArtId,
            temporalProgramId: programId,
            partTransitions: [],
            diagnosticOverrides: [],
          },
        },
      },
    ];
    const result = this.session.executeTransaction(commands, {
      label: "Create Transition",
    });
    this.activeTransitionId = transitionId;
    this.selectedSemanticSlotId = null;
    return { ...result, transitionId, programId };
  }

  setEndpoint(endpoint, keyArtId) {
    if (!["from", "to"].includes(endpoint)) throw new Error(`Unknown endpoint ${endpoint}.`);
    this.session.query("keyart.get", { keyArtId });
    const transition = this.activeTransition();
    if (!transition) throw new Error("No active Transition.");
    const key = endpoint === "from" ? "fromKeyArtId" : "toKeyArtId";
    const { durationTicks: _derivedDuration, ...persistentTransition } = transition;
    return this.session.execute({
      type: "transition.update",
      payload: {
        transitionId: transition.id,
        transition: { ...persistentTransition, [key]: keyArtId },
      },
    }, { label: `Set ${endpoint === "from" ? "Start" : "End"} Key Art` });
  }

  mapNode(keyArtId, nodeId) {
    const slot = this.selectedSemanticSlot();
    if (!slot) throw new Error("No SemanticSlot selected.");
    const current = mappingFor(slot, keyArtId);
    if (current?.nodeId === nodeId) return null;
    const commands = [];
    if (current) {
      commands.push({
        type: "semantic_slot.unmap_node",
        payload: { semanticSlotId: slot.id, keyArtId },
      });
    }
    commands.push({
      type: "semantic_slot.map_node",
      payload: { semanticSlotId: slot.id, keyArtId, nodeId },
    });
    return this.session.executeTransaction(commands, { label: "Map SemanticSlot" });
  }

  unmapNode(keyArtId) {
    const slot = this.selectedSemanticSlot();
    if (!slot) throw new Error("No SemanticSlot selected.");
    if (!mappingFor(slot, keyArtId)) return null;
    return this.session.execute({
      type: "semantic_slot.unmap_node",
      payload: { semanticSlotId: slot.id, keyArtId },
    }, { label: "Unmap SemanticSlot" });
  }

  setPartMode(mode, configuration = {}) {
    if (!PART_TRANSITION_MODES.includes(mode)) throw new Error(`Unknown PartTransition mode ${mode}.`);
    const state = this.getState();
    const transition = state.activeTransition;
    const slot = state.selectedSemanticSlot;
    if (!transition || !slot) throw new Error("Select a Transition and SemanticSlot first.");
    if (!slot.availableModes[mode]) {
      throw new Error(`${mode} is not valid for the selected A/B mapping.`);
    }
    const previous = slot.partTransition;
    const partTransitionId = previous?.id || this.idFactory("part_transition");
    const requestedConfiguration = { ...configuration };
    if (mode === "hold") {
      if (slot.status === "a-only") requestedConfiguration.holdEndpoint = "from";
      if (slot.status === "b-only") requestedConfiguration.holdEndpoint = "to";
    }
    const commands = [{
      type: "transition.set_part_mode",
      payload: {
        transitionId: transition.id,
        partTransitionId,
        semanticSlotId: slot.id,
        mode,
        configuration: modeConfiguration(
          mode,
          requestedConfiguration,
          previous?.configuration || {},
        ),
      },
    }];
    if (mode === "morph") {
      commands.push({
        type: "transition.set_part_topology",
        payload: {
          transitionId: transition.id,
          semanticSlotId: slot.id,
          ...slot.morphReferences,
        },
      });
    }
    return this.session.executeTransaction(commands, {
      label: "Set PartTransition mode",
    });
  }

  activeTransition() {
    if (!this.activeTransitionId) return null;
    return this.session.query("transition.list")
      .find((transition) => transition.id === this.activeTransitionId) || null;
  }

  selectedSemanticSlot() {
    if (!this.selectedSemanticSlotId) return null;
    return this.session.query("semantic_slot.list")
      .find((slot) => slot.id === this.selectedSemanticSlotId) || null;
  }

  getState() {
    const project = this.session.project;
    const transitions = this.session.query("transition.list");
    const keyArts = this.session.query("keyart.list");
    const semanticSlots = this.session.query("semantic_slot.list");
    const activeTransition = transitions.find((entry) =>
      entry.id === this.activeTransitionId) || null;
    const selectedKeyArt = keyArts.find((entry) =>
      entry.id === this.selectedKeyArtId) || null;
    const fromKeyArt = activeTransition
      ? keyArts.find((entry) => entry.id === activeTransition.fromKeyArtId) || null
      : null;
    const toKeyArt = activeTransition
      ? keyArts.find((entry) => entry.id === activeTransition.toKeyArtId) || null
      : null;
    const slots = activeTransition ? semanticSlots.map((slot) => {
      const from = mappingProjection(project, fromKeyArt, mappingFor(slot, activeTransition.fromKeyArtId));
      const to = mappingProjection(project, toKeyArt, mappingFor(slot, activeTransition.toKeyArtId));
      const status = slotStatus(from, to);
      const partTransition = activeTransition.partTransitions.find((part) =>
        part.semanticSlotId === slot.id) || null;
      const refs = morphReferences(project, activeTransition, slot, partTransition);
      return {
        ...cloneProject(slot),
        from,
        to,
        status,
        partTransition: cloneProject(partTransition),
        morphReferences: cloneProject(refs),
        availableModes: modeAvailability(status, refs),
      };
    }) : [];
    const selectedSemanticSlot = slots.find((slot) =>
      slot.id === this.selectedSemanticSlotId) || null;
    return {
      activeTransitionId: this.activeTransitionId,
      activeTransitionMissing: Boolean(this.activeTransitionId && !activeTransition),
      selectedKeyArtId: this.selectedKeyArtId,
      selectedSemanticSlotId: this.selectedSemanticSlotId,
      transitions: cloneProject(transitions),
      keyArts: cloneProject(keyArts),
      semanticSlots: slots,
      activeTransition: cloneProject(activeTransition),
      selectedKeyArt: cloneProject(selectedKeyArt),
      selectedSemanticSlot: cloneProject(selectedSemanticSlot),
      endpoints: activeTransition ? {
        from: {
          id: activeTransition.fromKeyArtId,
          keyArt: cloneProject(fromKeyArt),
          missing: !fromKeyArt,
        },
        to: {
          id: activeTransition.toKeyArtId,
          keyArt: cloneProject(toKeyArt),
          missing: !toKeyArt,
        },
      } : null,
    };
  }
}
