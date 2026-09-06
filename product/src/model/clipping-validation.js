export const CLIPPING_MODES = Object.freeze(["inside"]);

function problem(code, path, message, entityId = null, severity = "error", details = null) {
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

function nonEmpty(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalCycle(nodeIds) {
  if (!nodeIds.length) return [];
  let start = 0;
  for (let index = 1; index < nodeIds.length; index += 1) {
    if (compareText(nodeIds[index], nodeIds[start]) < 0) start = index;
  }
  return [...nodeIds.slice(start), ...nodeIds.slice(0, start)];
}

export function findClippingDependencyCycles(relations) {
  const sourceByTarget = new Map();
  for (const relation of [...relations].sort((left, right) =>
    compareText(left.targetNodeId, right.targetNodeId) ||
    compareText(left.sourceNodeId, right.sourceNodeId))) {
    if (!sourceByTarget.has(relation.targetNodeId)) {
      sourceByTarget.set(relation.targetNodeId, relation.sourceNodeId);
    }
  }

  const state = new Map();
  const stack = [];
  const stackIndex = new Map();
  const found = new Map();
  const visit = (nodeId) => {
    state.set(nodeId, "visiting");
    stackIndex.set(nodeId, stack.length);
    stack.push(nodeId);
    const sourceNodeId = sourceByTarget.get(nodeId);
    if (sourceNodeId && sourceByTarget.has(sourceNodeId)) {
      if (state.get(sourceNodeId) === "visiting") {
        const cycle = canonicalCycle(stack.slice(stackIndex.get(sourceNodeId)));
        found.set(cycle.join("\u0000"), cycle);
      } else if (state.get(sourceNodeId) !== "visited") visit(sourceNodeId);
    }
    stack.pop();
    stackIndex.delete(nodeId);
    state.set(nodeId, "visited");
  };
  for (const nodeId of [...sourceByTarget.keys()].sort(compareText)) {
    if (!state.has(nodeId)) visit(nodeId);
  }
  return [...found.values()].sort((left, right) =>
    compareText(left.join("\u0000"), right.join("\u0000")));
}

export function isRenderableClippingNode(node) {
  return node?.kind === "part";
}

export function clippingBindingForTarget(project, targetNodeId) {
  return [...(project.clippingBindings || [])]
    .filter((binding) => binding?.targetNodeId === targetNodeId)
    .sort((left, right) => compareText(left.id, right.id))[0] || null;
}

function cycleProblems(project, bindings) {
  const nodes = project.scene?.nodes || {};
  const bindingByTarget = new Map();
  for (const binding of [...bindings].sort((left, right) =>
    compareText(left.targetNodeId, right.targetNodeId) || compareText(left.id, right.id))) {
    if (!binding.enabled || binding.targetNodeId === binding.sourceNodeId ||
      !nodes[binding.targetNodeId] || !nodes[binding.sourceNodeId] ||
      !isRenderableClippingNode(nodes[binding.targetNodeId]) ||
      !isRenderableClippingNode(nodes[binding.sourceNodeId]) ||
      bindingByTarget.has(binding.targetNodeId)) continue;
    bindingByTarget.set(binding.targetNodeId, binding);
  }

  return findClippingDependencyCycles([...bindingByTarget.values()])
    .map((nodeIds) => {
      const bindingIds = nodeIds.map((nodeId) => bindingByTarget.get(nodeId).id).sort(compareText);
      return problem(
        "CLIPPING_CYCLE",
        "clippingBindings",
        "Clipping dependencies must not contain a cycle.",
        bindingIds[0],
        "error",
        { nodeIds, bindingIds },
      );
    });
}

export function validateClippingBindings(project, registerExternal = null) {
  if (!Array.isArray(project.clippingBindings)) {
    return [problem("collection.invalid", "clippingBindings", "clippingBindings must be an array.")];
  }
  const issues = [];
  const localIds = new Map();
  const register = registerExternal || ((id, path) => {
    if (localIds.has(id)) {
      issues.push(problem("identity.duplicate", path, "Duplicate stable ID " + id + ".", id));
    } else localIds.set(id, path);
  });
  const nodes = project.scene?.nodes || {};
  const targets = new Map();
  const structurallyUsable = [];
  for (const [index, binding] of project.clippingBindings.entries()) {
    const path = "clippingBindings." + index;
    if (!object(binding)) {
      issues.push(problem("CLIPPING_BINDING_INVALID", path, "ClippingBinding must be an object."));
      continue;
    }
    if (nonEmpty(binding.id)) register(binding.id, path + ".id");
    else issues.push(problem("identity.missing", path + ".id", "Stable clipping binding ID is required."));
    const keys = Object.keys(binding).sort();
    const expected = ["enabled", "id", "mode", "sourceNodeId", "targetNodeId"];
    if (keys.length !== expected.length || keys.some((key, keyIndex) => key !== expected[keyIndex])) {
      issues.push(problem(
        "CLIPPING_BINDING_INVALID",
        path,
        "ClippingBinding contains missing or unsupported persistent fields.",
        binding.id || null,
      ));
    }
    if (!nonEmpty(binding.targetNodeId) || !nodes[binding.targetNodeId]) {
      issues.push(problem(
        "CLIPPING_TARGET_MISSING",
        path + ".targetNodeId",
        "Clipping target node does not exist.",
        binding.id || null,
        "error",
        { targetNodeId: binding.targetNodeId ?? null },
      ));
    } else if (!isRenderableClippingNode(nodes[binding.targetNodeId])) {
      issues.push(problem(
        "CLIPPING_TARGET_NOT_RENDERABLE",
        path + ".targetNodeId",
        "Clipping target must be a renderable part node.",
        binding.id || null,
        "error",
        { targetNodeId: binding.targetNodeId },
      ));
    }
    if (!nonEmpty(binding.sourceNodeId) || !nodes[binding.sourceNodeId]) {
      issues.push(problem(
        "CLIPPING_SOURCE_MISSING",
        path + ".sourceNodeId",
        "Clipping source node does not exist.",
        binding.id || null,
        "error",
        { sourceNodeId: binding.sourceNodeId ?? null },
      ));
    } else if (!isRenderableClippingNode(nodes[binding.sourceNodeId])) {
      issues.push(problem(
        "CLIPPING_SOURCE_NOT_RENDERABLE",
        path + ".sourceNodeId",
        "Clipping source must be a renderable part node.",
        binding.id || null,
        "error",
        { sourceNodeId: binding.sourceNodeId },
      ));
    }
    if (nonEmpty(binding.targetNodeId) && binding.targetNodeId === binding.sourceNodeId) {
      issues.push(problem(
        "CLIPPING_SELF_REFERENCE",
        path,
        "A node cannot clip itself.",
        binding.id || null,
        "error",
        { nodeId: binding.targetNodeId },
      ));
    }
    if (!CLIPPING_MODES.includes(binding.mode)) {
      issues.push(problem(
        "CLIPPING_MODE_UNSUPPORTED",
        path + ".mode",
        "Clipping mode must be inside.",
        binding.id || null,
      ));
    }
    if (typeof binding.enabled !== "boolean") {
      issues.push(problem(
        "CLIPPING_BINDING_INVALID",
        path + ".enabled",
        "Clipping enabled must be boolean.",
        binding.id || null,
      ));
    }
    if (nonEmpty(binding.targetNodeId)) {
      const previous = targets.get(binding.targetNodeId);
      if (previous) {
        issues.push(problem(
          "CLIPPING_TARGET_ALREADY_BOUND",
          path + ".targetNodeId",
          "A clipping target may have at most one clipping binding.",
          binding.id || null,
          "error",
          {
            targetNodeId: binding.targetNodeId,
            bindingIds: [previous, binding.id].filter(nonEmpty).sort(compareText),
          },
        ));
      } else targets.set(binding.targetNodeId, binding.id);
    }
    if (nonEmpty(binding.id) && nonEmpty(binding.targetNodeId) && nonEmpty(binding.sourceNodeId) &&
      CLIPPING_MODES.includes(binding.mode) && typeof binding.enabled === "boolean") {
      structurallyUsable.push(binding);
    }
  }
  issues.push(...cycleProblems(project, structurallyUsable));
  return issues;
}

export function clippingValidationResult(project) {
  const issues = validateClippingBindings(project)
    .sort((left, right) =>
      compareText(left.code, right.code) ||
      compareText(left.entityId || "", right.entityId || "") ||
      compareText(left.path, right.path));
  return { valid: !issues.some((entry) => entry.severity === "error"), issues };
}
