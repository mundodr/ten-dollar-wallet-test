# Test evidence

Run date: 2026-08-27 UTC  
Environment: Linux x86_64, Node 22.22.2  
Target package: `@openai/codex@0.145.0`

## Automated suite

Command:

```sh
npm test
```

Result: 14 tests, 14 passed, 0 failed, 0 skipped.

Covered cases:

1. Full contract lifecycle, audit, terminal non-resurrection, archive, new-run restart.
2. Normal Stop continuation, one-turn re-entry guard, workspace boundary.
3. Sleep, wake, approval pause, denial, and no Hook resurrection.
4. Explicit terminal stop.
5. Third identical blocker pause and acknowledged/new-plan recovery.
6. State digest and plugin version failure.
7. Duplicate runner, no stale-lock auto-break, mismatched/live recovery refusal.
8. Completion rejects missing criterion/check/queue evidence.
9. Scope escape and non-three blocker limit rejection.
10. Additive install, collision refusal, exact uninstall, unrelated Hook preservation.
11. Plugin-created Hook file removal and state preservation.
12. Tampered Hook fail-closed uninstall with no partial removal.
13. Dry-run leaves the target unchanged.
14. Likely credentials are rejected before entering contract state or lifecycle evidence.

## Plugin validation

The official plugin-creator validator reported:

```text
Plugin validation passed: persistent-objective
```

## Exact Codex 0.145.0 installation

Commands were run with a fresh isolated `CODEX_HOME`:

```sh
npx --yes @openai/codex@0.145.0 --version
codex plugin marketplace add <submission-root>
codex plugin add persistent-objective@persistent-objective-local
codex plugin list
codex plugin remove persistent-objective@persistent-objective-local
codex plugin list
```

Observed evidence:

```text
codex-cli 0.145.0
Added marketplace `persistent-objective-local`
Added plugin `persistent-objective`
persistent-objective@persistent-objective-local  installed, enabled  1.0.0
Removed plugin `persistent-objective`
persistent-objective@persistent-objective-local  not installed
```

The temporary-directory alias warning from Codex was expected and unrelated to plugin loading; installation, enablement, listing, and removal all succeeded.
