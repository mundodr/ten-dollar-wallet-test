# Threat model

## Protected invariants

1. At most one non-terminal objective exists per state home.
2. Only one mutation/heartbeat/Stop evaluator owns the runner lease.
3. Continuation happens only for `active`, inside the real contracted workspace, below finite limits, without an unresolved approval or third repeated blocker.
4. `completed` and `stopped` are terminal and never wake.
5. Completion needs all queue items done, all criteria evidenced, all structured checks passed, and no open cycle.
6. Installation and removal preserve unrelated Codex configuration.

## Defended failures

- Path traversal and symlink substitution: real paths, workspace containment, regular-file checks, and symlink refusal.
- Partial state writes: private temp file, `fsync`, and atomic rename.
- Accidental/manual state edits: schema/version checks and envelope digest.
- Event deletion/reordering/editing: prior-head SHA-256 chain and state-head comparison.
- Concurrent runners: `O_EXCL` lease; no automatic stale-lock removal.
- Infinite Stop recursion: `stop_hook_active` releases after one continuation in a turn.
- Retry storms: finite cycles/runtime and exact three-repeat blocker pause.
- Premature success: explicit evidence/check/queue gates.
- Permission laundering: persistence never changes sandbox, approval policy, allowed paths, or recorded approval boundaries.
- Config clobbering: additive Hook merge, collision checks, exact hashes, full uninstall preflight.
- Secret exfiltration: no network code, telemetry, analytics, tokens, accounts, or external storage; check output is hashed rather than copied.
- Prompt injection and malicious workspace files: repository text, logs, web content, and tool output are untrusted evidence. They cannot mutate the integrity-checked contract, queue, scope, structured check allowlist, or approval boundaries; injected requests for new authority require a pause.
- Stale sessions: session startup restores only the state bound to the contracted real workspace, while deadlines, terminal state, and the one-writer lease suppress stale continuation.

## Fail-closed triggers

Malformed JSON, unsupported schema/plugin version, integrity mismatch, unsafe state path, scope escape, malformed contract, live/mismatched lock, Hook re-entry, terminal/non-continuable state, exceeded limit, modified install assets, or missing completion gates all suppress continuation or mutation.

## Deliberate non-goals

- Defending against an administrator or local attacker who can replace both runtime code and state.
- Cryptographic identity or non-repudiation; SHA-256 detects changes under the trusted-code assumption but is not keyed.
- Automatically approving external actions, credentials, payments, destructive commands, or identity claims.
- Automatically ingesting raw prompts or memories. Operators must write a short redacted contract; high-confidence credential patterns are rejected before persistence.
- Running an immortal daemon, defeating host sleep, or recursively launching Codex.
- Merging concurrent writers' changes. The design chooses one writer and stops on contention.

## Recovery

Inspect with `doctor`, `status`, and `audit`. Never hand-edit integrity fields. A stale lease may be removed only with `recover-lock --expected-pid` after the exact PID is confirmed absent. A blocked objective needs explicit acknowledgement and a new plan. Terminal work is archived; a restart creates a new run rather than changing terminal state.
