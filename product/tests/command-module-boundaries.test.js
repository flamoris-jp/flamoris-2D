import test from "node:test";
import assert from "node:assert/strict";

import {
  CommandError as PublicCommandError,
  TransactionError as PublicTransactionError,
} from "../src/commands/editor.js";
import {
  CommandError,
  TransactionError,
} from "../src/commands/errors.js";
import { sceneCommandHandlers } from "../src/commands/scene-command-handlers.js";
import { temporalCommandHandlers } from "../src/commands/temporal-command-handlers.js";
import { transitionCommandHandlers } from "../src/commands/transition-command-handlers.js";
import { boneCommandHandlers } from "../src/commands/bone-command-handlers.js";

test("command handler modules keep their domain boundaries and public errors", () => {
  assert.equal(PublicCommandError, CommandError);
  assert.equal(PublicTransactionError, TransactionError);

  const temporalTypes = Object.keys(temporalCommandHandlers);
  const sceneTypes = Object.keys(sceneCommandHandlers);
  const transitionTypes = Object.keys(transitionCommandHandlers);
  const boneTypes = Object.keys(boneCommandHandlers);
  assert.ok(temporalTypes.length > 0);
  assert.ok(sceneTypes.length > 0);
  assert.ok(transitionTypes.length > 0);
  assert.ok(boneTypes.length > 0);
  assert.ok(temporalTypes.every((type) => type.startsWith("animation.temporal.")));
  assert.ok(sceneTypes.every((type) =>
    type.startsWith("scene.") || type === "source.apply_psd_reimport"));
  assert.deepEqual(
    temporalTypes.filter((type) => sceneTypes.includes(type)),
    [],
  );
  assert.ok(transitionTypes.every((type) =>
    type.startsWith("keyart.") || type.startsWith("keyArts.") ||
    type.startsWith("semantic_slot.") || type.startsWith("semanticSlots.") ||
    type.startsWith("mesh_topology.") || type.startsWith("meshTopologies.") ||
    type.startsWith("mesh_keyform.") || type.startsWith("meshKeyforms.") ||
    type.startsWith("transition.") || type.startsWith("transitions.")));
  assert.deepEqual(
    transitionTypes.filter((type) => temporalTypes.includes(type) || sceneTypes.includes(type)),
    [],
  );
  assert.ok(boneTypes.every((type) => type.startsWith("bone.")));
  assert.deepEqual(
    boneTypes.filter((type) =>
      temporalTypes.includes(type) || sceneTypes.includes(type) ||
      transitionTypes.includes(type)),
    [],
  );
});
