# LIME resident CLI acceptance — 2026-11-07 (JST)

## Accepted scope

The operator deployed CLI 0.1.1 as an Updater-managed Docker application and
reported successful Hub verification: connected=true, toolCount=184,
permission=edit and hasDocument=true. An independent Hub upstream observation
also reported flamoris2d-lime connected, with no catalog mismatch, alongside
the existing Kachinco LIME connector.

This is headless connectivity and migration acceptance. It does not certify
a finished animated shot, real-artwork editing/render quality, sustained CPU
performance, production restart/reboot recovery or Windows physical acceptance.

## Source changes and regressions

| PR | Result |
| --- | --- |
| [#167](https://github.com/flamoris-jp/flamoris-2D/pull/167) | Native Linux CLI and MCP host over the existing editing authority |
| [#169](https://github.com/flamoris-jp/flamoris-2D/pull/169) | Preserve readonly Hub mounts; inject connector configuration by retained container replacement |
| [#170](https://github.com/flamoris-jp/flamoris-2D/pull/170) | Preserve numeric schemas through installed YAML serialization/validation |
| [#171](https://github.com/flamoris-jp/flamoris-2D/pull/171) | MCP SDK pagination compatibility and redacted verification diagnostics |
| [#172](https://github.com/flamoris-jp/flamoris-2D/pull/172) | Docker/Updater resident host, normal blank-project creation and reconnect policy |
| [#173](https://github.com/flamoris-jp/flamoris-2D/pull/173) | Recover an initial install rejected before placement; retain and verify native state |
| [#174](https://github.com/flamoris-jp/flamoris-2D/pull/174) | Provision the missing exact public WebSocket proxy route |

The accepted immutable image was published as cli-v0.1.1 without rebuilding
after merge. Tests included native save/source/MCP/render regressions, actual
Updater/Docker installation and retained-state restart, SDK 1.29/2.2/2.3 helper
compatibility, and an actual Nginx missing-route 404 followed by a forwarded
101 upgrade preserving Host, Authorization and Upgrade headers. CI's systemd
control was stubbed in the disposable migration fixture; the operator then
performed the real host migration and external connection.

## Failure analysis

An HTTP health response with status=ready proved the resident child was alive,
not that the Hub could reach its document. A valid static Hub catalog likewise
did not prove the external WSS path. The configured exact Nginx locations
included the Windows 2D endpoint and Kachinco LIME endpoint, but omitted
/desktop/flamoris2d-lime. After that route was installed and the Hub registered,
the live mcp.context verification succeeded.

Earlier independent deployment defects included readonly /app/.env writes,
YAML interpreting a tiny numeric bound as a string, changed SDK pagination,
and fresh-install refusal of an occupied native directory. These fixes have
distinct evidence; containerization alone did not repair proxy routing.
The generic hub_unavailable code does not identify which layer failed.

## Migration and cleanup result

The operator's recovery reported phase=succeeded after retaining the entire
old native tree, restoring state into the new empty mount and verifying hashes.
After live connection acceptance, native cleanup reported cleaned=true and
retained current state plus a private rollback backup. Hub cleanup removed two
stopped 2D swap containers after a successful read-only context check.
No blanket Docker prune or NAS cleanup was used.

Host-specific paths, retained backup identifiers, runtime IDs and operator
receipts belong in the private operational record. Reusable behavior is in
[the CLI guide](../headless-linux.md), [ADR 0014](../decisions/0014-updater-resident-linux.md)
and [the migration runbook](../../deploy/linux/README.md).
