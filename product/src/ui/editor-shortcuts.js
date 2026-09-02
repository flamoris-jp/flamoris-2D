function hasEditableAncestor(target) {
  if (typeof target?.closest !== "function") return false;
  return Boolean(
    target.closest('[contenteditable]:not([contenteditable="false"])'),
  );
}

function hasDialogAncestor(target) {
  if (typeof target?.closest !== "function") return false;
  return Boolean(target.closest('dialog, [role="dialog"]'));
}

export function isNativeEditingTarget(target) {
  const tagName = String(target?.tagName || target?.nodeName || "")
    .toLocaleUpperCase();
  return tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    Boolean(target?.isContentEditable) ||
    hasEditableAncestor(target);
}

export function isNativeTabTarget(target) {
  const tagName = String(target?.tagName || target?.nodeName || "")
    .toLocaleUpperCase();
  return isNativeEditingTarget(target) ||
    ["BUTTON", "OPTION", "A", "DIALOG"].includes(tagName) ||
    hasDialogAncestor(target);
}

export function editorModeShortcutAction(event) {
  if (
    !event ||
    event.repeat ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey ||
    isNativeTabTarget(event.target) ||
    String(event.key || "") !== "Tab"
  ) return null;
  return "toggle-editor-mode";
}

export function projectHistoryShortcutAction(event) {
  if (
    !event ||
    isNativeEditingTarget(event.target) ||
    !(event.ctrlKey || event.metaKey) ||
    String(event.key || "").toLocaleLowerCase() !== "z"
  ) return null;
  return event.shiftKey ? "redo" : "undo";
}
