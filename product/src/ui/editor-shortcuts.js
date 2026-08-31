function hasEditableAncestor(target) {
  if (typeof target?.closest !== "function") return false;
  return Boolean(
    target.closest('[contenteditable]:not([contenteditable="false"])'),
  );
}

export function isNativeEditingTarget(target) {
  const tagName = String(target?.tagName || target?.nodeName || "")
    .toLocaleUpperCase();
  return tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    Boolean(target?.isContentEditable) ||
    hasEditableAncestor(target);
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
