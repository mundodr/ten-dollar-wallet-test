# Provenance and design sources

This implementation is original MIT-licensed code. The sources below were reviewed for public interfaces, safety patterns, and known failure modes; no source code or documentation text was copied into the runtime.

## Official sources

- [Long-running work](https://learn.chatgpt.com/docs/long-running-work): outcome, constraints, verification, same-task steering, and unchanged sandbox/approval boundaries.
- [Scheduled tasks](https://learn.chatgpt.com/docs/automations): thread-scoped continuation, one-cycle heartbeat prompts, local-host availability, worktree isolation, and unattended sandbox behavior.
- [Hooks](https://learn.chatgpt.com/docs/hooks): Hook discovery, trust review, plugin environment, `SessionStart`, `Stop`, `stop_hook_active`, and `decision: "block"` continuation wire format.
- [Memories](https://learn.chatgpt.com/docs/customization/memories): durable required rules belong in checked-in instructions/state rather than relying on memory as the sole source.
- [Build plugins](https://learn.chatgpt.com/docs/build-plugins): `.codex-plugin/plugin.json`, bundled skills/Hooks, local marketplace, and installation flow.

## Prior art reviewed

- [treygoff24/autonomous-loop](https://github.com/treygoff24/autonomous-loop): frozen contracts, deterministic gates, Stop fail-closed behavior, machine state, and archive-first lifecycle. Persistent Objective independently implements a smaller JSON contract, event chain, strict one-run state, and exact additive installer.
- [jaredfolkins/codex-heartbeat](https://github.com/jaredfolkins/codex-heartbeat): stable session heartbeat and workspace lock. Its documented default approval/sandbox bypass was deliberately rejected; this bundle has no recursive Codex command and no bypass mode.
- [ozbillwang/codex-heartbeat-plugin](https://github.com/ozbillwang/codex-heartbeat-plugin): official marketplace packaging, bounded heartbeat contracts, idle behavior, and explicit external-action safety notes.
- [b9bt5dp9hg-ship-it/codex-ralph-loop](https://github.com/b9bt5dp9hg-ship-it/codex-ralph-loop): native Stop Hook schema, atomic state, re-entry guard, bounded iterations, cancellation, and no hidden second agent.
- [mikeysWrld/codex-ralph-loop](https://github.com/mikeysWrld/codex-ralph-loop): immutable objective, inspect-act-verify method, evidence-gated completion, finite limits, preserving unrelated work, and stopping after three consecutive external blockers.

## Independent choices

Persistent Objective adds an explicit `start/status/sleep/wake/stop/complete` state machine, structured command allowlist without a shell, criterion evidence registry, queue, approval pause, exact three-repeat fingerprint rule, runtime/cycle deadlines, `CODEX_HOME`/`PLUGIN_DATA` state, SHA-256 envelope and event chain, exclusive lease with explicit dead-PID recovery, exact-hash uninstall, and tests for each acceptance invariant.
