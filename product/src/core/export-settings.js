import {
  keyArtMemberFor,
  semanticMappingFor,
} from "../model/transition-validation.js";
import { normalizeFrameRate } from "./temporal.js";

function exactAspect(width, height, targetWidth, targetHeight) {
  if (![width, height, targetWidth, targetHeight].every((value) =>
    Number.isSafeInteger(value) && value > 0)) return false;
  return BigInt(width) * BigInt(targetHeight) ===
    BigInt(height) * BigInt(targetWidth);
}

export function exportResolutionPresets(project) {
  const width = project?.canvas?.width;
  const height = project?.canvas?.height;
  const presets = [];
  if (Number.isSafeInteger(width) && width > 0 &&
    Number.isSafeInteger(height) && height > 0) {
    presets.push(Object.freeze({
      id: "project",
      label: `Project ${width} × ${height}`,
      width,
      height,
    }));
    if (exactAspect(width, height, 1920, 1080) &&
      (width !== 1920 || height !== 1080)) {
      presets.push(Object.freeze({
        id: "hd-1080",
        label: "1920 × 1080",
        width: 1920,
        height: 1080,
      }));
    }
  }
  presets.push(Object.freeze({ id: "custom", label: "Custom", width: null, height: null }));
  return Object.freeze(presets);
}

export function exportFrameRatePresets(project) {
  const presets = [24, 30, 60].map((fps) => Object.freeze({
    id: String(fps),
    label: `${fps} fps`,
    frameRate: Object.freeze({ numerator: fps, denominator: 1 }),
  }));
  let projectRate = null;
  try {
    projectRate = normalizeFrameRate(project?.renderSettings?.frameRate);
  } catch {}
  if (projectRate && !presets.some((entry) =>
    entry.frameRate.numerator === projectRate.numerator &&
    entry.frameRate.denominator === projectRate.denominator)) {
    presets.unshift(Object.freeze({
      id: "project",
      label: `Project ${projectRate.numerator}/${projectRate.denominator} fps`,
      frameRate: Object.freeze(projectRate),
    }));
  }
  presets.push(Object.freeze({ id: "custom", label: "Custom rational", frameRate: null }));
  return Object.freeze(presets);
}

export function requiredTransitionRenderNodeIds(project, transitionId) {
  const transition = (project?.transitions || []).find((entry) => entry.id === transitionId);
  if (!transition) return Object.freeze([]);
  const fromKeyArt = (project.keyArts || []).find((entry) => entry.id === transition.fromKeyArtId);
  const toKeyArt = (project.keyArts || []).find((entry) => entry.id === transition.toKeyArtId);
  if (!fromKeyArt || !toKeyArt) return Object.freeze([]);

  const partSlotIds = new Set((transition.partTransitions || []).map((part) => part.semanticSlotId));
  const nodeIds = new Set();
  for (const slot of project.semanticSlots || []) {
    const fromMapping = semanticMappingFor(slot, fromKeyArt.id);
    const toMapping = semanticMappingFor(slot, toKeyArt.id);
    if (!fromMapping && !toMapping && !partSlotIds.has(slot.id)) continue;
    for (const [keyArt, mapping] of [[fromKeyArt, fromMapping], [toKeyArt, toMapping]]) {
      if (!mapping || !keyArtMemberFor(keyArt, mapping.nodeId)) continue;
      nodeIds.add(mapping.nodeId);
    }
  }
  return Object.freeze([...nodeIds].sort());
}

function renderAssetReady(asset) {
  if (!asset || asset.status === "missing" || asset.status === "decode-failed" ||
    asset.decodeFailed === true) return false;
  return Boolean(asset.canvas || asset.image ||
    (!asset.nodeId && (asset.bitmap || asset.source || asset.textureSource)));
}

export function transitionRenderAssetStatus(project, transitionId, renderAssets = []) {
  const requiredNodeIds = requiredTransitionRenderNodeIds(project, transitionId);
  const assets = renderAssets instanceof Map
    ? renderAssets
    : new Map((Array.isArray(renderAssets) ? renderAssets : [])
      .filter((entry) => entry && typeof entry.nodeId === "string")
      .map((entry) => [entry.nodeId, entry]));
  const missingNodeIds = requiredNodeIds.filter((nodeId) => !renderAssetReady(assets.get(nodeId)));
  return Object.freeze({
    ok: requiredNodeIds.length > 0 && missingNodeIds.length === 0,
    requiredNodeIds,
    missingNodeIds: Object.freeze(missingNodeIds),
    reason: requiredNodeIds.length === 0
      ? "No renderable Transition artwork is mapped."
      : missingNodeIds.length
        ? `Missing render assets: ${missingNodeIds.join(", ")}`
        : null,
  });
}
