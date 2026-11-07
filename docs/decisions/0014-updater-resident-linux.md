# ADR 0014: Kachinco-compatible LIME resident deployment

Status: accepted direction requested by Akino, 2026-11-07.

Use the same Docker/Updater boundary as Kachinco CLI. The Updater installs a
digested immutable Linux image, retains a UID 10001 state mount and provides a
loopback health endpoint. The application still owns its NativeWorkspace and
MCP Core 1.4.0 outbound WSS connection. Hub catalog, permission, identity and
all 184 tool schemas remain unchanged.

Replace the premature first-error exit with Kachinco's resident refresh policy:
keep the workspace and grant alive, let the provider use its retry budget, and
refresh after 60 seconds if an error remains. Never replay an editing request.
Connection transitions are reported without credentials. HTTP process health
and actual Hub connection are separate; cleanup requires actual connection.

The container's first-run blank document is created by the ordinary CLI `new`
command through NativeWorkspace.NewAsync and native serialization. No runtime
dependency on deployment scripts or test fixtures is introduced.

Migration stops the old systemd host, retains a private full state/config backup,
keeps the existing state path and connector credential, and adjusts its ownership
for the managed container. Updater receives no secret through chat: the operator
prepares a private connection.json on LIME. Cleanup follows verified cutover and
only removes the exact validated legacy unit/release/archive. Keep the rollback
backup and source configuration. Hub cleanup only removes stopped swap containers
matching the active image and mounts after a successful read-only 2D context call.

Changing the container does not prove external proxy routing/authentication.
Live WSS and context acceptance remain separate production checks.
