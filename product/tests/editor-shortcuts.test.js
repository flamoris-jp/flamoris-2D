import test from "node:test";
import assert from "node:assert/strict";
import {
  editorModeShortcutAction,
  isNativeEditingTarget,
  projectHistoryShortcutAction,
} from "../src/ui/editor-shortcuts.js";

test("Project Undo and Redo are recognized outside editing controls", () => {
  assert.equal(projectHistoryShortcutAction({
    target: { tagName: "DIV" },
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    key: "z",
  }), "undo");
  assert.equal(projectHistoryShortcutAction({
    target: { tagName: "CANVAS" },
    ctrlKey: false,
    metaKey: true,
    shiftKey: true,
    key: "Z",
  }), "redo");
});

test("Inspector input, textarea, and select keep native Ctrl/Cmd+Z", () => {
  for (const tagName of ["INPUT", "textarea", "select"]) {
    assert.equal(projectHistoryShortcutAction({
      target: { tagName },
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      key: "z",
    }), null);
  }
});

test("contenteditable elements and descendants keep native Ctrl/Cmd+Z", () => {
  assert.equal(isNativeEditingTarget({
    tagName: "DIV",
    isContentEditable: true,
  }), true);
  assert.equal(projectHistoryShortcutAction({
    target: {
      tagName: "SPAN",
      closest: (selector) => selector.includes("contenteditable")
        ? { contentEditable: "true" }
        : null,
    },
    ctrlKey: false,
    metaKey: true,
    shiftKey: false,
    key: "z",
  }), null);
});

test("plain Z is not a Project history shortcut", () => {
  assert.equal(projectHistoryShortcutAction({
    target: { tagName: "DIV" },
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    key: "z",
  }), null);
});

test("Tab toggles mode only outside native UI editing contexts", () => {
  assert.equal(editorModeShortcutAction({
    target: { tagName: "CANVAS" },
    key: "Tab",
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
  }), "toggle-editor-mode");

  for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "DIALOG"]) {
    assert.equal(editorModeShortcutAction({
      target: { tagName },
      key: "Tab",
      repeat: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    }), null);
  }

  assert.equal(editorModeShortcutAction({
    target: {
      tagName: "SPAN",
      closest: (selector) => selector.includes("dialog") ? {} : null,
    },
    key: "Tab",
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
  }), null);
});
