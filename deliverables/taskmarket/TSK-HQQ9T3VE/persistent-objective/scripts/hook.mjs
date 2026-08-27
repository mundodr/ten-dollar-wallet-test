#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { acquireLease, continuability, publicState, readState } from "./lib.mjs";

if (!process.env.PERSISTENT_OBJECTIVE_HOME && process.env.PLUGIN_DATA) {
  process.env.PERSISTENT_OBJECTIVE_HOME = process.env.PLUGIN_DATA;
}

function readInput() {
  const raw = fs.readFileSync(0, "utf8").trim();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return { invalidInput: true }; }
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function safeState() {
  try { return { state: readState(process.env, { optional: true }) }; }
  catch (error) { return { error }; }
}

function sessionStart() {
  const { state, error } = safeState();
  if (error) {
    output({
      continue: true,
      systemMessage: `Persistent Objective is paused fail-closed: ${error.code ?? "STATE_ERROR"}. Run the status/doctor command and inspect state before recovery.`,
    });
    return;
  }
  if (!state) {
    output({ continue: true });
    return;
  }
  let cwd;
  try { cwd = fs.realpathSync(process.cwd()); } catch { output({ continue: true }); return; }
  const relative = path.relative(state.workspace, cwd);
  if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
    output({ continue: true });
    return;
  }
  const result = continuability(state);
  const view = publicState(state);
  output({
    continue: true,
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: [
        `Persistent Objective ${view.id} is ${view.status}.`,
        `Objective: ${view.objective}`,
        `Workspace boundary: ${view.workspace}`,
        `Continuation: ${result.continue ? "eligible" : "paused"} (${result.reason}).`,
        "Never expand scope, bypass approvals, break another runner's lock, or mark completion without recorded verification.",
        "Use the bundled lifecycle command for status, inspect-act-verify cycles, sleep, wake, stop, and completion.",
      ].join("\n"),
    },
  });
}

function stop() {
  const input = readInput();
  if (input.invalidInput) {
    output({ continue: false, stopReason: "Persistent Objective received malformed Stop hook input and failed closed." });
    return;
  }
  if (input.stop_hook_active === true) {
    output({ continue: true, systemMessage: "Persistent Objective allowed Stop because this turn was already continued once." });
    return;
  }
  let lease;
  try {
    lease = acquireLease(process.env, { owner: `stop-hook:${process.pid}`, ttlMs: 10000 });
    const state = readState(process.env, { optional: true });
    if (!state) {
      output({ continue: true });
      return;
    }
    const result = continuability(state);
    if (!result.continue) {
      output({ continue: true, systemMessage: `Persistent Objective did not resume: ${result.reason}.` });
      return;
    }
    const next = state.queue.find((item) => item.status === "pending") ?? null;
    output({
      decision: "block",
      reason: [
        `Continue bounded objective ${state.id}: ${state.objective}`,
        next ? `Next queued item: ${next.id} — ${next.text}` : "Inspect current evidence and choose the smallest in-scope next step.",
        "Follow one inspect-act-verify cycle. Respect the stored workspace, allowed paths, sources, approval boundaries, runtime/cycle limits, and exclusive runner lock.",
        "If a decision or external side effect needs approval, pause. If the same blocker recurs, record it; on the third repeat stop continuing. Complete only after every stored criterion and verification check passes.",
      ].join("\n"),
    });
  } catch (error) {
    output({
      continue: true,
      systemMessage: `Persistent Objective did not auto-resume and failed closed: ${error.code ?? "HOOK_ERROR"}.`,
    });
  } finally {
    if (lease) {
      try { lease.release(); } catch {}
    }
  }
}

const event = process.argv[2];
if (event === "session-start") sessionStart();
else if (event === "stop") stop();
else output({ continue: true, systemMessage: "Persistent Objective ignored an unknown hook event." });
