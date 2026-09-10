import { cloneProject } from "./project.js";

export function compareClipInstances(left, right) {
  const number = (value) => Number.isSafeInteger(value) ? value : Number.MAX_SAFE_INTEGER;
  return number(left?.startTicks) - number(right?.startTicks) ||
    number(left?.endTicks) - number(right?.endTicks) ||
    number(left?.layer) - number(right?.layer) ||
    (String(left?.id) < String(right?.id) ? -1 : String(left?.id) > String(right?.id) ? 1 : 0);
}

export function canonicalizeClipInstances(instances = []) {
  return cloneProject(instances).sort(compareClipInstances);
}

export function normalizeClipInstance(instance) {
  return cloneProject(instance);
}
