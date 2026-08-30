# FLAMORIS 2D MCP-First Design

Status: draft

## 1. Principle

FLAMORIS 2D should be designed from the beginning so an AI agent can inspect and edit the same project model as the human UI.

This does **not** mean exposing the DOM, canvas events, or private editor state through MCP.

The architecture should be:

```text
Human UI ───────┐
                │
AI / MCP ───────┼──> Domain Commands ──> Project Model ──> Renderer
                │
Scripts/Tests ──┘
```

The UI and MCP are clients of one deterministic editor core.

## 2. Headless editor core

Core model/commands must not depend on DOM widgets.

Suggested layers:

```text
@flamoris2d/model
  versioned project schema and validation

@flamoris2d/core
  scene evaluation, mesh, rig, animation, transitions

@flamoris2d/commands
  mutations, undo/redo, transactions

@flamoris2d/io
  PSD/project import/export

@flamoris2d/renderer
  WebGL rendering

UI
  browser editor shell

MCP
  typed adapter around queries and commands
```

The repository does not need to become a monorepo immediately, but module boundaries should follow this direction.

## 3. Stable identities

MCP must operate on stable IDs, never screen positions or display names alone.

Examples:

```text
projectId
keyArtId
transitionId
nodeId
semanticSlotId
meshId
vertexId
boneId
clipId
trackId
keyframeId
```

Display names remain human-friendly and can be Japanese.

## 4. Coordinate spaces

Every command using coordinates must state its coordinate space explicitly.

Minimum spaces:

```text
document
node-local
mesh-local
normalized-part
viewport/screen (UI only where possible)
```

MCP should generally use document/node/mesh coordinates rather than viewport pixels.

This prevents commands from changing meaning when the user zooms or pans.

`scene.set_transform` is a complete replacement command. Its payload must
declare `coordinateSpace: "node-local"` and provide every transform field:
`position`, `rotation`, `scale`, and `pivot`. Partial transform payloads
are rejected before mutation. If partial editing is needed later, it will use a
separate command such as `scene.patch_transform` rather than changing the
meaning of `scene.set_transform`.

## 5. Query vs mutation separation

Read tools should be clearly separate from editing tools.

Example queries:

```text
project.get_summary
scene.get_tree
scene.get_node
keyart.list
transition.get
mesh.get_summary
animation.get_timeline
project.validate
render.get_preview_info
```

Example mutations:

```text
scene.rename_node
scene.reparent_node
scene.set_transform
mesh.generate
mesh.move_vertices
mesh.set_keyform
keyart.add
keyart.map_semantic_slot
transition.create
transition.set_part_mode
transition.set_correspondence
rig.add_bone
rig.set_weights
animation.add_keyframe
animation.create_clip
```

## 6. Transaction model

AI edits are often multi-step. A half-applied edit should not leave the project broken.

Support transactions conceptually:

```text
begin_transaction
  command 1
  command 2
  command 3
  validate
commit
```

or rollback on error.

A transaction should return:

- commands applied
- affected IDs
- validation warnings/errors
- before/after summary
- undo token/history entry where appropriate

The exact MCP surface may use a single `apply_commands` request rather than literal begin/commit tools, but atomicity is required.

## 7. Preview before commit

For high-impact semantic operations, support dry-run/preview.

Example:

```text
AI: "Map these 16 layers between Key Art A and B"
  -> propose mappings
  -> return confidence + ambiguities
  -> user/agent reviews
  -> commit mappings
```

Likewise for:

- PSD re-import reconciliation
- auto-grouping
- automatic target-mesh correspondence
- auto-rig/bone suggestions
- bulk renaming/reparenting

## 8. Low-level and semantic operations

### 8.1 Low-level deterministic commands

These are the source of truth:

```text
MoveVertices
SetNodeTransform
SetMeshKeyform
SetClippingSource
SetBoneWeights
AddKeyframe
SetPartTransitionMode
```

### 8.2 Semantic operations

Useful AI-facing operations compile down to low-level commands:

```text
blink
look_left
tilt_head
raise_arm
sway_hair
connect_key_arts
match_corresponding_parts
```

The semantic layer must never create project state that cannot be represented/edited by the normal UI.

## 9. AI-assisted Key Art transition

The multi-Key-Art workflow is a primary MCP use case.

Possible high-level flow:

```text
inspect Key Art A and B
  -> propose semantic part mappings
  -> propose transition mode per part
  -> propose anchor/vertex correspondences
  -> preview
  -> commit ordinary Transition + MeshKeyform data
```

Suggested eventual MCP operations:

```text
keyart.compare
keyart.suggest_part_mapping
transition.suggest_modes
mesh.suggest_target_keyform
transition.preview
transition.commit_suggestions
```

AI suggestions should include confidence and rationale fields suitable for logs, but the persistent project stores deterministic mappings and geometry, not hidden model reasoning.

## 10. Versioned MCP schemas

MCP contracts must be versioned alongside project schema.

Every structured payload should have explicit required fields and validation.

Avoid permissive "arbitrary JSON command" endpoints as the primary API.

Goals:

- AI can discover exact capabilities.
- malformed commands fail before mutation.
- schema changes can be migrated/tested.
- UI and MCP tests can share fixtures.

## 11. Validation as a first-class capability

AI should be able to ask whether a project/edit is valid.

Validation examples:

- hierarchy cycles
- missing source refs
- invalid mesh indices
- mismatched mesh keyform vertex counts
- unknown semantic-slot mappings
- transition between incompatible mesh topologies
- clipping cycles/invalid sources
- bone weight sums
- timeline references to deleted nodes

Validation should return machine-readable codes plus human-readable messages.

## 12. Observability and change summaries

Every command should produce structured change information.

Example:

```json
{
  "command": "SetMeshKeyform",
  "affected": ["mesh_01", "keyart_B"],
  "changedVertexCount": 24,
  "warnings": []
}
```

This improves:

- AI reliability
- user trust
- action history
- test assertions
- debugging

## 13. Undo/Redo relationship

UI and MCP edits go to the same Action/Command history unless explicitly marked non-user-visible.

An AI edit should therefore be undoable with the normal Undo command.

Large semantic operations should preferably appear as one grouped history item:

```text
"Match Key Art B to A (AI suggestion)"
```

rather than 400 individual vertex entries.

## 14. No hidden cloud dependency

The deterministic editor core must work without AI.

MCP can call local or remote AI helpers later, but project load/edit/render must not require a model service.

This allows:

- offline manual production
- repeatable tests
- local-model integration
- replacement of AI providers

## 15. Security/safety boundary

MCP should receive access to editor/project capabilities, not arbitrary filesystem or shell access through FLAMORIS 2D.

File operations should be explicit:

```text
import_source
save_project
export_render
```

and follow user-authorized locations/capabilities provided by the host environment.

## 16. Development timing

MCP architecture begins in Phase 1, even if the user-facing MCP server ships later.

Phase 1 requirements:

- headless Project Model
- Command Layer
- stable IDs
- typed command/query contracts
- transaction-capable mutation API
- validation API

Later MCP implementation becomes an adapter over these existing capabilities rather than a retrofit.

## 17. Acceptance criteria for MCP-ready core

Before an MCP server is considered ready, tests should prove that code without browser UI can:

1. load/create a project,
2. inspect scene/key-art state,
3. execute the same commands used by UI,
4. undo/redo them,
5. group commands transactionally,
6. validate the result,
7. serialize/reload deterministically,
8. render/preview from project state,
9. perform a complete two-Key-Art transition edit without directly driving DOM events.

Success condition:

> An AI adapter can edit FLAMORIS 2D by manipulating domain objects and commands, while every resulting change remains visible, editable, undoable, and reproducible in the human editor.
