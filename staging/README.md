# Staging

This directory is for manual/visual acceptance scenarios that intentionally resemble real FLAMORIS 2D production work but are not Product runtime dependencies.

Examples:

- small non-sensitive PSD fixtures
- browser/WebGL smoke instructions
- expected screenshots/render hashes
- Key Art A→B acceptance projects
- export acceptance settings

Rules:

- Staging may depend on `product/`; Product must never depend on Staging.
- Real/private production artwork should not be committed for convenience.
- `staging/fixtures/*.psd` is the only PSD path intentionally allowed by `.gitignore`; commit only synthetic/non-sensitive fixtures.
- Expensive visual/browser checks remain explicit until automation protects a stable risk.
