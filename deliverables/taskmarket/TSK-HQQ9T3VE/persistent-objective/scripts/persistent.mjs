#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  PLUGIN_VERSION,
  PersistentError,
  TERMINAL,
  acquireLease,
  archiveTerminalState,
  canonical,
  continuability,
  fail,
  newState,
  pathsFor,
  publicState,
  readJsonFile,
  readState,
  recoverLock,
  safeText,
  sha256,
  validateContract,
  withLease,
  writeState,
} from "./lib.mjs";

function parse(argv) {
  const [command = "help", ...rest] = argv;
  const flags = {};
  const positional = [];
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = rest[index + 1];
    if (next === undefined || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      index += 1;
    }
  }
  return { command, flags, positional };
}

function required(flags, key) {
  const value = flags[key];
  if (value === undefined || value === true || String(value).trim() === "") fail("MISSING_ARGUMENT", `--${key} is required.`);
  const text = String(value);
  const stateTextFlags = new Set(["text", "inspection", "evidence", "reason", "note", "new-plan"]);
  return stateTextFlags.has(key) ? safeText(text, `--${key}`) : text;
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function mutate(type, fn, options = {}) {
  return withLease(process.env, () => {
    const state = readState();
    if (options.statuses && !options.statuses.includes(state.status)) {
      fail("INVALID_TRANSITION", `${type} is not allowed from ${state.status}.`);
    }
    const data = fn(state) ?? {};
    return writeState(state, process.env, { type, data });
  });
}

function nextItem(state) {
  return state.queue.find((item) => item.status === "pending") ?? null;
}

function help() {
  emit({
    name: "persistent-objective",
    version: PLUGIN_VERSION,
    usage: "node scripts/persistent.mjs <command> [--flag value]",
    commands: [
      "start --contract contract.json",
      "status",
      "queue-add --id ID --text TEXT",
      "cycle-begin --item ID --inspection TEXT",
      "cycle-end --result pass|fail --evidence TEXT",
      "verify-criterion --id ID --evidence TEXT",
      "run-check --id ID",
      "pause --reason TEXT",
      "resolve-approval --decision approved|denied --note TEXT",
      "block --fingerprint ID --evidence TEXT",
      "sleep --reason TEXT",
      "wake --reason TEXT [--new-plan TEXT --acknowledge-blocker]",
      "heartbeat [--hold-ms N]",
      "complete --evidence TEXT",
      "stop --reason TEXT",
      "audit",
      "recover-lock --expected-pid PID",
      "doctor",
    ],
  });
}

function start(flags) {
  const contract = validateContract(readJsonFile(required(flags, "contract")));
  const result = withLease(process.env, () => {
    const prior = readState(process.env, { optional: true });
    const priorHead = prior?.eventHead ?? "0".repeat(64);
    if (prior) archiveTerminalState(prior);
    const state = newState(contract);
    state.eventHead = priorHead;
    return writeState(state, process.env, {
      type: "objective.started",
      data: { objectiveDigest: sha256(contract.objective), contractDigest: sha256(canonical(contract)) },
    });
  });
  emit({ ok: true, state: publicState(result) });
}

function status() {
  const state = readState(process.env, { optional: true });
  emit({ ok: true, exists: Boolean(state), state: state ? publicState(state) : null });
}

function queueAdd(flags) {
  const id = required(flags, "id");
  const text = required(flags, "text");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(id)) fail("INVALID_ID", "Queue id is invalid.");
  const state = mutate("queue.added", (draft) => {
    if (draft.queue.some((item) => item.id === id)) fail("DUPLICATE_ID", `Queue item exists: ${id}`);
    draft.queue.push({ id, text, status: "pending" });
    return { id, textDigest: sha256(text) };
  }, { statuses: ["active", "sleeping"] });
  emit({ ok: true, state: publicState(state) });
}

function cycleBegin(flags) {
  const itemId = required(flags, "item");
  const inspection = required(flags, "inspection");
  const state = mutate("cycle.began", (draft) => {
    if (draft.currentCycle) fail("CYCLE_ACTIVE", `Cycle ${draft.currentCycle.id} is already active.`);
    const item = draft.queue.find((candidate) => candidate.id === itemId);
    if (!item || item.status !== "pending") fail("QUEUE_ITEM_UNAVAILABLE", `Pending queue item not found: ${itemId}`);
    item.status = "in-progress";
    draft.currentCycle = {
      id: `cycle_${crypto.randomUUID()}`,
      itemId,
      inspection,
      beganAt: new Date().toISOString(),
    };
    return { cycleId: draft.currentCycle.id, itemId, inspectionDigest: sha256(inspection) };
  }, { statuses: ["active"] });
  emit({ ok: true, state: publicState(state) });
}

function cycleEnd(flags) {
  const result = required(flags, "result");
  const evidence = required(flags, "evidence");
  if (!["pass", "fail"].includes(result)) fail("INVALID_RESULT", "--result must be pass or fail.");
  const state = mutate("cycle.ended", (draft) => {
    if (!draft.currentCycle) fail("NO_ACTIVE_CYCLE", "No inspect-act-verify cycle is active.");
    const cycle = draft.currentCycle;
    const item = draft.queue.find((candidate) => candidate.id === cycle.itemId);
    item.status = result === "pass" ? "done" : "pending";
    item.lastEvidence = evidence;
    draft.cycleCount += 1;
    draft.currentCycle = null;
    return { cycleId: cycle.id, itemId: cycle.itemId, result, evidenceDigest: sha256(evidence) };
  }, { statuses: ["active"] });
  emit({ ok: true, state: publicState(state) });
}

function verifyCriterion(flags) {
  const id = required(flags, "id");
  const evidence = required(flags, "evidence");
  const state = mutate("criterion.verified", (draft) => {
    if (!draft.completionCriteria.some((criterion) => criterion.id === id)) fail("UNKNOWN_CRITERION", `Unknown criterion: ${id}`);
    draft.verificationEvidence[id] = { evidence, recordedAt: new Date().toISOString() };
    return { id, evidenceDigest: sha256(evidence) };
  }, { statuses: ["active"] });
  emit({ ok: true, state: publicState(state) });
}

function runCheck(flags) {
  const id = required(flags, "id");
  const state = withLease(process.env, () => {
    const draft = readState();
    if (draft.status !== "active") fail("INVALID_TRANSITION", `run-check is not allowed from ${draft.status}.`);
    const check = draft.verificationCommands.find((candidate) => candidate.id === id);
    if (!check) fail("UNKNOWN_CHECK", `Unknown verification check: ${id}`);
    const result = spawnSync(check.command, check.args, {
      cwd: draft.workspace,
      env: process.env,
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 1024 * 1024,
      shell: false,
    });
    const record = {
      passed: result.status === 0 && !result.error,
      exitCode: result.status,
      signal: result.signal,
      errorCode: result.error?.code ?? null,
      stdoutDigest: sha256(result.stdout ?? ""),
      stderrDigest: sha256(result.stderr ?? ""),
      ranAt: new Date().toISOString(),
    };
    draft.checkResults[id] = record;
    return writeState(draft, process.env, { type: "check.ran", data: { id, ...record } });
  });
  emit({ ok: true, check: state.checkResults[id], state: publicState(state) });
}

function pause(flags) {
  const reason = required(flags, "reason");
  const state = mutate("approval.requested", (draft) => {
    draft.status = "awaiting-approval";
    draft.approvalPause = { reason, requestedAt: new Date().toISOString() };
    return { reasonDigest: sha256(reason) };
  }, { statuses: ["active"] });
  emit({ ok: true, state: publicState(state) });
}

function resolveApproval(flags) {
  const decision = required(flags, "decision");
  const note = required(flags, "note");
  if (!["approved", "denied"].includes(decision)) fail("INVALID_DECISION", "--decision must be approved or denied.");
  const state = mutate("approval.resolved", (draft) => {
    draft.approvalPause = { ...draft.approvalPause, decision, note, resolvedAt: new Date().toISOString() };
    if (decision === "approved") draft.status = "active";
    else {
      draft.status = "stopped";
      draft.stopReason = `Approval denied: ${note}`;
    }
    return { decision, noteDigest: sha256(note) };
  }, { statuses: ["awaiting-approval"] });
  emit({ ok: true, state: publicState(state) });
}

function block(flags) {
  const fingerprint = required(flags, "fingerprint");
  const evidence = required(flags, "evidence");
  const state = mutate("blocker.recorded", (draft) => {
    const count = draft.blocker?.fingerprint === fingerprint ? draft.blocker.count + 1 : 1;
    draft.blocker = { fingerprint, count, evidence, lastSeenAt: new Date().toISOString() };
    if (count >= draft.stoppingRules.blockerRepeatLimit) draft.status = "blocked";
    return { fingerprint, count, evidenceDigest: sha256(evidence), autoPaused: draft.status === "blocked" };
  }, { statuses: ["active"] });
  emit({ ok: true, state: publicState(state) });
}

function sleep(flags) {
  const reason = required(flags, "reason");
  const state = mutate("objective.slept", (draft) => {
    draft.sleepPreviousStatus = draft.status;
    draft.status = "sleeping";
    draft.sleepReason = reason;
    return { reasonDigest: sha256(reason) };
  }, { statuses: ["active", "awaiting-approval", "blocked"] });
  emit({ ok: true, state: publicState(state) });
}

function wake(flags) {
  const reason = required(flags, "reason");
  const state = mutate("objective.woke", (draft) => {
    const blockedBeforeSleep = draft.blocker?.count >= draft.stoppingRules.blockerRepeatLimit;
    if (blockedBeforeSleep) {
      if (flags["acknowledge-blocker"] !== true) fail("ACK_REQUIRED", "Blocked objectives require --acknowledge-blocker.");
      const newPlan = required(flags, "new-plan");
      draft.blockerHistory ??= [];
      draft.blockerHistory.push({ ...draft.blocker, acknowledgedAt: new Date().toISOString(), newPlan });
      draft.blocker = null;
    }
    draft.status = draft.sleepPreviousStatus === "awaiting-approval" ? "awaiting-approval" : "active";
    draft.sleepPreviousStatus = null;
    draft.sleepReason = null;
    return { reasonDigest: sha256(reason), blockerAcknowledged: Boolean(flags["acknowledge-blocker"]), newPlanDigest: flags["new-plan"] ? sha256(String(flags["new-plan"])) : null };
  }, { statuses: ["sleeping", "blocked"] });
  emit({ ok: true, state: publicState(state) });
}

function heartbeat(flags) {
  const holdMs = Number(flags["hold-ms"] ?? 0);
  if (!Number.isInteger(holdMs) || holdMs < 0 || holdMs > 10000) fail("INVALID_HOLD", "--hold-ms must be 0-10000.");
  const lease = acquireLease(process.env, { owner: `heartbeat:${process.pid}`, ttlMs: Math.max(30000, holdMs + 5000) });
  try {
    const state = readState();
    const result = continuability(state);
    if (holdMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, holdMs);
    emit({
      ok: true,
      continuable: result.continue,
      reason: result.reason,
      next: result.continue ? nextItem(state) : null,
      state: publicState(state),
      prompt: result.continue
        ? "Inspect the contracted workspace, act only within the recorded scope and approvals, then verify evidence before ending the cycle."
        : null,
    });
  } finally {
    lease.release();
  }
}

function complete(flags) {
  const evidence = required(flags, "evidence");
  const state = mutate("objective.completed", (draft) => {
    if (draft.currentCycle) fail("CYCLE_ACTIVE", "End the active cycle before completion.");
    const missingCriteria = draft.completionCriteria.filter((item) => !draft.verificationEvidence[item.id]).map((item) => item.id);
    const failedChecks = draft.verificationCommands.filter((item) => !draft.checkResults[item.id]?.passed).map((item) => item.id);
    const pending = draft.queue.filter((item) => item.status !== "done").map((item) => item.id);
    if (missingCriteria.length || failedChecks.length || pending.length) {
      fail("NOT_VERIFIED", "Completion gates are not satisfied.", { missingCriteria, failedChecks, pending });
    }
    draft.status = "completed";
    draft.completionEvidence = { evidence, recordedAt: new Date().toISOString() };
    return { evidenceDigest: sha256(evidence) };
  }, { statuses: ["active"] });
  emit({ ok: true, state: publicState(state) });
}

function stop(flags) {
  const reason = required(flags, "reason");
  const state = mutate("objective.stopped", (draft) => {
    draft.status = "stopped";
    draft.stopReason = reason;
    if (draft.currentCycle) {
      const item = draft.queue.find((candidate) => candidate.id === draft.currentCycle.itemId);
      if (item) item.status = "pending";
      draft.currentCycle = null;
    }
    return { reasonDigest: sha256(reason) };
  }, { statuses: ["active", "sleeping", "awaiting-approval", "blocked"] });
  emit({ ok: true, state: publicState(state) });
}

function audit() {
  const state = readState();
  const p = pathsFor();
  const lines = fs.existsSync(p.events) ? fs.readFileSync(p.events, "utf8").trim().split("\n").filter(Boolean) : [];
  let head = "0".repeat(64);
  let seenRun = false;
  for (const line of lines) {
    let event;
    try { event = JSON.parse(line); } catch { fail("AUDIT_INVALID_JSON", "Event log contains invalid JSON."); }
    const { eventHash, ...body } = event;
    const expected = sha256(canonical(body));
    if (eventHash !== expected || body.priorHead !== head) fail("AUDIT_CHAIN_BROKEN", "Event hash chain is invalid.");
    head = eventHash;
    if (event.runId === state.id) seenRun = true;
  }
  if (!seenRun || head !== state.eventHead) fail("AUDIT_HEAD_MISMATCH", "State does not match event log head.");
  emit({ ok: true, events: lines.length, head, runId: state.id });
}

function doctor() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) fail("UNSUPPORTED_NODE", "Node.js 20 or newer is required.");
  const state = readState(process.env, { optional: true });
  emit({
    ok: true,
    pluginVersion: PLUGIN_VERSION,
    nodeVersion: process.versions.node,
    stateHome: pathsFor().root,
    state: state ? publicState(state) : null,
    guarantees: {
      oneActiveObjective: true,
      failClosedIntegrity: true,
      exclusiveRunnerLease: true,
      blockerRepeatLimit: 3,
      bypassesApprovals: false,
      collectsTelemetry: false,
    },
  });
}

const { command, flags } = parse(process.argv.slice(2));

try {
  switch (command) {
    case "help": help(); break;
    case "start": start(flags); break;
    case "status": status(); break;
    case "queue-add": queueAdd(flags); break;
    case "cycle-begin": cycleBegin(flags); break;
    case "cycle-end": cycleEnd(flags); break;
    case "verify-criterion": verifyCriterion(flags); break;
    case "run-check": runCheck(flags); break;
    case "pause": pause(flags); break;
    case "resolve-approval": resolveApproval(flags); break;
    case "block": block(flags); break;
    case "sleep": sleep(flags); break;
    case "wake": wake(flags); break;
    case "heartbeat": heartbeat(flags); break;
    case "complete": complete(flags); break;
    case "stop": stop(flags); break;
    case "audit": audit(); break;
    case "recover-lock": emit({ ok: true, recovered: recoverLock(process.env, required(flags, "expected-pid")) }); break;
    case "doctor": doctor(); break;
    default: fail("UNKNOWN_COMMAND", `Unknown command: ${command}`);
  }
} catch (error) {
  const structured = error instanceof PersistentError
    ? { ok: false, error: { code: error.code, message: error.message, details: error.details } }
    : { ok: false, error: { code: "UNEXPECTED", message: error.message } };
  process.stderr.write(`${JSON.stringify(structured, null, 2)}\n`);
  process.exitCode = 1;
}
