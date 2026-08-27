# TSK-HQQ9T3VE — Persistent Objective 1.0.0

Clean-room, installable Codex Persistent mode recreation for Codex CLI 0.145.0.

Public source: https://github.com/mundodr/ten-dollar-wallet-test/tree/main/deliverables/taskmarket/TSK-HQQ9T3VE

Required immutable archive: `persistent-objective-1.0.0.tar.gz`  
SHA-256: `8540bb215c1f6d63c1e43524529b58155a231b58e7037041c8775f159b668751`  
Size: 30,289 bytes

## Reproduce

```sh
tar -xzf persistent-objective-1.0.0.tar.gz
cd persistent-objective
npm test
```

Result: 14/14 tests passed. The official plugin-creator validator passed. In a fresh isolated `CODEX_HOME`, exact `@openai/codex@0.145.0` added this archive's marketplace, installed and listed `persistent-objective@persistent-objective-local` as `installed, enabled 1.0.0`, then removed it successfully.

## Acceptance map

| Requirement | Evidence |
| --- | --- |
| Installable global capability | Valid plugin manifest + marketplace; additive global installer |
| `start/status/sleep/wake/stop` | Lifecycle CLI and discoverable skill |
| Durable frozen contract | Versioned integrity envelope, scoped real paths, criteria/checks/queue/limits |
| Stop continuation | Native `Stop` Hook with one-turn re-entry guard |
| Session continuity | Workspace-bound `SessionStart` Hook and minimal state summary |
| Proactive heartbeat | Scheduler-neutral `heartbeat`; documented supported scheduled-task use |
| One writer / dirty work | Atomic `O_EXCL` lease and contracted workspace boundary |
| Three blockers | Third identical fingerprint enters `blocked`; new-plan acknowledgement required |
| No resurrection | Sleep/approval/blocked/complete/stop/corruption/caps suppress Hooks |
| Safe install/uninstall | Surgical Hook byte insertion, exact hash preflight, byte-for-byte restoration test |
| No bypass/network/telemetry | Static runtime audit; no recursive Codex invocation or external dependency |
| No secret persistence | Check output is hashed; raw memories are never read; likely credential text rejected |
| Threat model/provenance/limits | Included in archive with official and five public prior-art references |

The implementation depends on the official host for Hook trust, Goals/task context, scheduled tasks/notifications, app availability, and “Prevent sleep while running.” It does not claim to keep hardware or a closed Codex host alive.
