# Honest limitations

- This is a clean-room recreation of public behavior, not OpenAI's internal Persistent mode and not a claim about private implementation details.
- The plugin uses supported Goals/Hook/scheduled-task concepts but cannot keep a Mac awake by itself. The user must enable Codex's “Prevent sleep while running” setting when desired.
- Normal Stop continuation needs Codex 0.145.0 to load and trust the Hook. Later proactive continuation needs an official scheduled task/heartbeat and an available Codex host. The CLI alone has no scheduled-task management UI.
- `heartbeat` produces a bounded next-action prompt; it does not launch a hidden Codex process or send notifications itself.
- Local Codex Memories are optional and are never used as the authoritative contract. This bundle neither reads nor copies raw memory files.
- SHA-256 state integrity is tamper-evident under a trusted runtime, not keyed authentication against a local administrator who can replace code and recompute state.
- Likely credential patterns are rejected, but no detector can identify every sensitive sentence. Operators must use minimal redacted objective/evidence summaries.
- Verification proves only the commands and criteria explicitly frozen in the contract. A bad contract can be incomplete; changing it requires stopping and explicitly starting a new run.
- The compatibility run used Codex CLI 0.145.0 on Linux. The code and quoted Hook paths are suitable for the target macOS/Node environment, but native macOS CI was not available to this worker.
- The one-state-home design intentionally allows one non-terminal objective. Independent objectives need separate isolated `CODEX_HOME`/`PERSISTENT_OBJECTIVE_HOME` values or separate Codex tasks/worktrees.
