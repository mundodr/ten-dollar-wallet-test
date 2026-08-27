# Persistent Objective for Codex 0.145.0

Persistent Objective is an installable Codex plugin/skill/hook bundle for one durable, bounded objective. It records a frozen contract, drives inspect-act-verify cycles, resumes after a normal `Stop` event, and fails closed on terminal state, sleep, approval pauses, repeated blockers, scope mismatch, limits, tamper, version mismatch, or another writer's lease.

It does not invoke Codex recursively, grant permissions, bypass Hook trust, hold credentials, call a network service, collect telemetry, commit/push/deploy, or spend money.

## Install through the Codex 0.145.0 plugin CLI

From this submission directory (the directory containing `.agents/` and `persistent-objective/`):

```sh
codex plugin marketplace add .
codex plugin add persistent-objective@persistent-objective-local
```

Start a new Codex task, open `/hooks`, and review and trust the exact bundled hooks. Installation never uses `--dangerously-bypass-hook-trust` or any approval/sandbox bypass.

Remove the plugin with:

```sh
codex plugin remove persistent-objective@persistent-objective-local
```

## Install as a global skill + Hook bundle

The additive installer supports an isolated or existing `CODEX_HOME`:

```sh
node persistent-objective/scripts/install.mjs install --codex-home /absolute/path/to/codex-home
```

It prints the absolute lifecycle command. It creates a private runtime folder and skill folder, then merges two uniquely marked groups into `hooks.json`. It refuses symlink targets, malformed Hook JSON, an existing install, or a marker collision. Existing Hook fields and unrelated events are retained.

Preview without writing:

```sh
node persistent-objective/scripts/install.mjs install --codex-home /absolute/path/to/codex-home --dry-run
```

Uninstall performs a full preflight, matches the exact installed Hook hashes and runtime hashes, removes only those entries/files, and preserves objective state:

```sh
node persistent-objective/scripts/install.mjs uninstall --codex-home /absolute/path/to/codex-home
```

If an installed file or Hook was changed, uninstall fails closed for manual review rather than guessing.

## Start one explicit contract

Copy `examples/contract.json`, replace the workspace with an existing absolute directory, and keep every allowed path inside it. Then run the lifecycle command:

```sh
node persistent-objective/scripts/persistent.mjs start --contract /absolute/path/to/contract.json
```

The contract contains:

- one objective and one existing workspace;
- measurable completion criteria;
- existing allowed paths, permitted sources, and forbidden actions;
- explicit approval boundaries with forced `neverBypass: true`;
- structured verification commands (`command` plus `args`, never a shell string);
- a durable queue;
- finite cycle/runtime limits and an exact blocker repeat limit of three.

Only one non-terminal objective can exist in one state home. Starting again while active, sleeping, awaiting approval, or blocked is rejected. Starting after verified completion or explicit stop archives the terminal state and creates a new run id; it never resurrects the old run.

## Lifecycle commands

```text
status
queue-add --id ID --text TEXT
cycle-begin --item ID --inspection TEXT
cycle-end --result pass|fail --evidence TEXT
verify-criterion --id ID --evidence TEXT
run-check --id ID
pause --reason TEXT
resolve-approval --decision approved|denied --note TEXT
block --fingerprint ID --evidence TEXT
sleep --reason TEXT
wake --reason TEXT
wake --reason TEXT --acknowledge-blocker --new-plan TEXT
heartbeat [--hold-ms N]
complete --evidence TEXT
stop --reason TEXT
audit
recover-lock --expected-pid PID
doctor
```

Each queue item follows one inspect-act-verify cycle. `complete` rejects an open cycle, pending queue work, missing criterion evidence, or any unrun/failed verification command. Verification output is represented by exit status and SHA-256 digests so logs do not copy possible secrets into state. High-confidence private-key, bearer-token, API-key, password, cookie, and token patterns are rejected before contract or lifecycle text is persisted; callers must still use redacted summaries and evidence references rather than raw prompts or memories.

`sleep`, `completed`, and `stopped` never auto-resume. `awaiting-approval` waits for an explicit decision. The same blocker fingerprint on three consecutive records moves the objective to `blocked`; resuming requires both acknowledgement and a materially new plan.

## Hook and heartbeat behavior

`SessionStart` injects only a bounded state summary. `Stop` obtains the exclusive lease, validates state, checks the session working directory, limits, blocker state, and `stop_hook_active`, then emits one official `decision: "block"` continuation. Codex creates the continuation prompt. The Hook does not spawn another process or exceed the current sandbox.

`heartbeat` is scheduler-neutral: it returns structured status, the next pending queue item, and a bounded prompt. For proactive work, create a thread-scoped scheduled task in the Codex desktop app that runs one heartbeat/cycle at a time. Scheduled work keeps the host's sandbox and approval policy. Hardware sleep, a closed Codex host, or an absent scheduler cannot be bypassed by this plugin.

## Durable state and single writer

By default state is under `$CODEX_HOME/persistent-objective-state`; plugin-bundled Hooks use the host-provided private `PLUGIN_DATA`. Files are private (`0700` directories, `0600` files). State is atomically replaced after `fsync`, and every state envelope has schema, plugin version, and SHA-256 integrity. The append-only NDJSON event log is hash chained and checked by `audit`.

Mutations and Stop/heartbeat evaluation use an atomic `runner.lock`. A second writer is rejected. A stale lock is never broken automatically: recovery requires the exact recorded dead PID, and a live or mismatched PID is refused. This is the one-writer rule for dirty work; the contract also prevents allowed paths from escaping the real workspace. Instructions embedded in repository files, logs, fetched pages, or tool output are treated as untrusted evidence and cannot edit the frozen contract or approval gates.

SHA-256 here is tamper-evident, not an authentication secret. A local attacker who can rewrite both code and state can recompute it. Operating-system permissions, Codex sandboxing, Hook review, version control, and host security remain the trust boundary.

## Verification

```sh
cd persistent-objective
npm test
python3 /path/to/plugin-creator/scripts/validate_plugin.py .
```

The suite is dependency-free and uses isolated temporary homes. It covers all lifecycle states, Stop continuation and re-entry, one active objective, restart-as-new-run, completion gates, scope escape, three-repeat blocking, duplicate/stale locks, state/version tamper, audit chains, additive install, collision refusal, exact uninstall, state preservation, and dry-run behavior.

See `TEST-EVIDENCE.md`, `COMPATIBILITY.md`, `THREAT-MODEL.md`, and `PROVENANCE.md` for exact evidence and design boundaries.

## File map

```text
.codex-plugin/plugin.json              plugin metadata
hooks/hooks.json                       default SessionStart + Stop hooks
skills/persistent-objective/SKILL.md   Codex workflow and safety rules
scripts/lib.mjs                        state, integrity, scope, event chain, lock
scripts/persistent.mjs                 lifecycle CLI
scripts/hook.mjs                       official Hook wire protocol
scripts/install.mjs                    additive global install/uninstall
examples/contract.json                 explicit contract template
tests/*.test.mjs                       isolated acceptance suite
```

## License

MIT. This implementation was written independently; no source code was copied from the reviewed prior-art repositories.
