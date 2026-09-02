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

test("command handler modules keep their domain boundaries and public errors", () => {
  assert.equal(PublicCommandError, CommandError);
  assert.equal(PublicTransactionError, TransactionError);

  const temporalTypes = Object.keys(temporalCommandHandlers);
  const sceneTypes = Object.keys(sceneCommandHandlers);
  assert.ok(temporalTypes.length > 0);
  assert.ok(sceneTypes.length > 0);
  assert.ok(temporalTypes.every((type) => type.startsWith("animation.temporal.")));
  assert.ok(sceneTypes.every((type) =>
    type.startsWith("scene.") || type === "source.apply_psd_reimport"));
  assert.deepEqual(
    temporalTypes.filter((type) => sceneTypes.includes(type)),
    [],
  );
});
