export const EASE_PRESETS = Object.freeze({
  "ease-in": Object.freeze({
    id: "ease-in",
    label: "Ease In",
    bezier: Object.freeze({ x1: 0.42, y1: 0, x2: 1, y2: 1 }),
  }),
  "ease-out": Object.freeze({
    id: "ease-out",
    label: "Ease Out",
    bezier: Object.freeze({ x1: 0, y1: 0, x2: 0.58, y2: 1 }),
  }),
  "ease-in-out": Object.freeze({
    id: "ease-in-out",
    label: "Ease In Out",
    bezier: Object.freeze({ x1: 0.42, y1: 0, x2: 0.58, y2: 1 }),
  }),
});

export function listEasePresets() {
  return Object.values(EASE_PRESETS).map(({ id, label, bezier }) => ({
    id,
    label,
    bezier: { ...bezier },
  }));
}

export function compileEasePreset(presetId) {
  const preset = EASE_PRESETS[presetId];
  if (!preset) throw new Error(`Unknown ease preset ${presetId}.`);
  return { kind: "bezier", ...preset.bezier };
}
