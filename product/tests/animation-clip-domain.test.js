import assert from "node:assert/strict";
import test from "node:test";

import { createAnimationClip } from "../src/model/animation-clip.js";
import { createIdFactory, createProject, PROJECT_SCHEMA_VERSION } from "../src/model/project.js";
import { validateProject } from "../src/model/validation.js";
import { temporalProgramOwners } from "../src/model/temporal-program-ownership.js";
import { migrateProjectSchema } from "../src/io/project-json.js";

function projectFixture() {
  return createProject({ name: "Clip Domain", width: 64, height: 64,
    idFactory: createIdFactory("clip_domain") });
}

function program(id, durationTicks = 100) {
  return { id, durationTicks, tracks: [], events: [], regions: [] };
}

test("AnimationClip preserves stable identity and derives duration from its owned program", () => {
  const project = projectFixture();
  const clip = createAnimationClip({
    id: "clip_idle",
    displayName: "Idle",
    temporalProgramId: "program_idle",
    defaultLoopMode: "loop",
  });
  project.temporalPrograms.push(program("program_idle"));
  project.animation.clips.push(clip);

  assert.equal(clip.id, "clip_idle");
  assert.equal(Object.hasOwn(clip, "durationTicks"), false);
  assert.deepEqual(clip.metadata, {});
  assert.deepEqual(validateProject(project), []);
  assert.deepEqual(
    temporalProgramOwners(project).get("program_idle").map(({ kind, id }) => [kind, id]),
    [["AnimationClip", "clip_idle"]],
  );
});

test("TemporalProgram ownership conflicts span Transition, Sequence, and AnimationClip", () => {
  const project = projectFixture();
  project.temporalPrograms.push(program("program_shared"));
  project.animation.clips.push(createAnimationClip({ id: "clip_a", displayName: "A",
    temporalProgramId: "program_shared" }));
  project.transitions.push({ id: "transition_a", displayName: "Transition",
    fromKeyArtId: "missing_a", toKeyArtId: "missing_b", temporalProgramId: "program_shared",
    partTransitions: [], diagnosticOverrides: [], metadata: {} });
  project.sequences.push({ id: "sequence_a", displayName: "Sequence",
    temporalProgramId: "program_shared", viewLaneItems: [], clipInstances: [], metadata: {} });

  const conflicts = validateProject(project)
    .filter((issue) => issue.code === "TEMPORAL_PROGRAM_OWNERSHIP_CONFLICT");
  assert.deepEqual(conflicts.map((issue) => issue.entityId), [
    "clip_a", "sequence_a", "transition_a",
  ]);
});

test("schema 13 migration starts typed clip state empty without promoting placeholders", () => {
  const legacy = projectFixture();
  legacy.schemaVersion = 13;
  legacy.animation.clips = [{ id: "legacy_clip", arbitrary: true }];
  legacy.animation.deformationSamples = [{ id: "legacy_sample" }];
  legacy.sequences = [{ id: "legacy_sequence", clipInstances: [{ id: "legacy_instance" }] }];
  legacy.temporalPrograms.push(program("unowned_program"));

  const migrated = migrateProjectSchema(legacy);
  assert.equal(PROJECT_SCHEMA_VERSION, 14);
  assert.equal(migrated.schemaVersion, 14);
  assert.deepEqual(migrated.animation, { clips: [], deformationSamples: [] });
  assert.deepEqual(migrated.sequences[0].clipInstances, []);
  assert.equal(migrated.temporalPrograms[0].id, "unowned_program");
});

test("AnimationClip rejects unknown fields and missing owned programs", () => {
  const project = projectFixture();
  project.animation.clips.push({
    ...createAnimationClip({ id: "clip_bad", displayName: "Bad",
      temporalProgramId: "missing_program" }),
    durationTicks: 20,
  });
  const issues = validateProject(project);
  assert.ok(issues.some((issue) => issue.code === "ANIMATION_CLIP_INVALID"));
  assert.ok(issues.some((issue) => issue.code === "ANIMATION_CLIP_PROGRAM_REFERENCE_INVALID"));
});
