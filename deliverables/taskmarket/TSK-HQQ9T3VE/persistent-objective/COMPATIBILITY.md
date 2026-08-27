# Compatibility

## Target

- Codex CLI: `0.145.0` (exact target, tested)
- Node.js: 20 or newer; tested with Node `22.22.2`
- Plugin manifest version: `1.0.0`
- State schema: `1`
- Hooks: official `SessionStart` and `Stop` command Hook JSON

On 2026-08-27 UTC, the exact `@openai/codex@0.145.0` package was invoked in an isolated `CODEX_HOME`. The local marketplace was added, `persistent-objective@persistent-objective-local` installed and listed as `installed, enabled` at version `1.0.0`, then removed and listed as `not installed`.

The runtime is dependency-free ECMAScript modules. It uses Node 20 APIs including `structuredClone`, `crypto.randomUUID`, atomic exclusive file creation, and `fsync`.

## Version behavior

State includes both `schemaVersion` and `pluginVersion`. Any mismatch stops status, Hooks, and mutation before continuation. There is no automatic migration and no best-effort downgrade. Archive or export evidence, then use a reviewed migration tool in a future release.

Codex 0.145.0 is the supported Hook contract. The core CLI tests also ran under the host where Codex CLI 0.133.0 was present, but that does not claim Hook compatibility for 0.133.0. The deliverable does not silently fall back to undocumented Hook behavior.

## Host limitations

- Plugin Hooks require user trust through `/hooks` unless managed by an administrator.
- A scheduled heartbeat requires a supported Codex desktop/web scheduled task and a running host where local files are needed.
- The plugin cannot prevent hardware shutdown, quota exhaustion, lost filesystem access, or administrator policy changes.
- Windows Hook command quoting is represented with double-quoted absolute paths, but this acceptance run was performed on Linux. Core state tests are platform-neutral; a Windows release should add native CI before claiming full support.
