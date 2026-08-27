# Architecture

## Components

| Component | Responsibility | Side effects |
| --- | --- | --- |
| Skill | Turns explicit user intent into a redacted contract and lifecycle commands | None by itself |
| Lifecycle CLI | Validates transitions, queue/cycles, evidence, checks, sleep/wake/stop/completion | Private local state only; runs only predeclared verification commands |
| `SessionStart` Hook | Restores a bounded summary only in the contracted workspace | Adds developer context |
| `Stop` Hook | Checks state, workspace, limits, approval, blocker, re-entry, and lock | Emits one supported continuation decision; never spawns Codex |
| Heartbeat | Returns structured next work and a bounded prompt | No scheduler, network, or external action |
| Installer | Adds exact global skill/runtime and two Hook groups | Surgical byte insertion into `hooks.json`; exact-hash uninstall |

## Lifecycle

```text
                         explicit start of a new run
             ┌──────────────────────────────────────────┐
             ▼                                          │
        ┌─────────┐   sleep   ┌──────────┐   wake       │
        │ active  │──────────▶│ sleeping │──────────────┘
        └────┬────┘           └──────────┘
             │
             ├─ needs authority ─▶ awaiting-approval ── approved ─▶ active
             │                                      └── denied ───▶ stopped
             ├─ same blocker ×3 ─▶ blocked ── acknowledged new plan ─▶ active
             ├─ all gates pass ──▶ completed (terminal)
             └─ explicit stop ───▶ stopped (terminal)
```

Hooks never transition state. They only read integrity-checked state and decide whether one continuation is eligible. Lifecycle commands own every mutation and event.

## Durable contract and state

`start` resolves real paths and freezes objective summary, criteria, scope, sources, approval boundaries, structured checks, queue, and finite stopping rules. One `active.json` envelope is stored under `PLUGIN_DATA` or `$CODEX_HOME/persistent-objective-state`. The envelope is versioned and hashed. Each mutation adds a hash-chained NDJSON event and atomically replaces state.

The public status view reports awake/state, objective, queue, evidence, blocker, current/next action, limits, checks, and timestamps. It does not retain check stdout/stderr, raw memories, session transcripts, cookies, credentials, or private keys.

## Inspect-act-verify

`cycle-begin` binds work to one pending queue item and records inspection. Only contracted paths and current Codex authority apply. `run-check` uses an exact command/argument array from the frozen contract with `shell: false`. `cycle-end` records pass/fail evidence and advances the finite cycle count. Completion is a separate gate over all queue, criteria, checks, and open-cycle state.

## Continuation and proactive wakeup

At a normal Stop, the Hook obtains the same exclusive lease as CLI mutations, rejects `stop_hook_active`, and checks status/workspace/cycle/runtime/blocker bounds. An eligible run emits official `decision: "block"`; Codex creates one continuation prompt. A non-eligible run exits quietly with no resurrection.

For later proactive work, a supported Codex scheduled task can call `heartbeat` and run at most one cycle. The plugin intentionally does not create a daemon, secretly schedule itself, recurse into Codex, or bypass a closed/sleeping host. Quiet runs return `continuable: false` and no prompt.

## Ownership and dirty work

An `O_EXCL` lease makes all mutators, heartbeats, and Stop evaluators single-writer. No second loop can take the same state home. The state binds one real workspace and prevents allowed-path escape. The skill instructs the agent to preserve unrelated dirty work; persistence does not authorize commits, pushes, merges, deletion, or cross-project roaming.

## Safety gates

Continuation fails closed for non-active status, outside workspace, unresolved approval, three repeated blockers, cycle/runtime cap, corrupt/malformed/version-mismatched state, unsafe paths, duplicate runner, Hook re-entry, or terminal state. High-confidence secret-shaped text is rejected before persistence. Untrusted workspace content cannot modify the contract or authority.
