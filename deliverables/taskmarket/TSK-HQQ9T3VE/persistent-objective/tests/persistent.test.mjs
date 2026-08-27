import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "scripts", "persistent.mjs");
const HOOK = path.join(ROOT, "scripts", "hook.mjs");

function fixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "persistent-objective-test-"));
  const codexHome = path.join(root, "codex-home");
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  const contract = {
    objective: "Finish the isolated fixture with verified evidence.",
    workspace,
    completionCriteria: [{ id: "done", text: "The fixture is complete." }],
    scope: { allowedPaths: ["."], permittedSources: ["fixture"], forbiddenActions: ["network"] },
    approvals: { requiredFor: ["external side effects"] },
    verificationCommands: [{ id: "check", command: process.execPath, args: ["-e", "process.exit(0)"] }],
    queue: [{ id: "work", text: "Perform the fixture work." }],
    stoppingRules: { maxCycles: 5, maxRuntimeMinutes: 30, blockerRepeatLimit: 3 },
    ...overrides,
  };
  const contractFile = path.join(root, "contract.json");
  fs.writeFileSync(contractFile, `${JSON.stringify(contract, null, 2)}\n`);
  const env = { ...process.env, CODEX_HOME: codexHome, PERSISTENT_OBJECTIVE_HOME: "" };
  return { root, codexHome, workspace, contract, contractFile, env };
}

function invoke(f, args, options = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: options.cwd ?? f.workspace,
    env: f.env,
    encoding: "utf8",
  });
  const stream = result.status === 0 ? result.stdout : result.stderr;
  let json;
  try { json = JSON.parse(stream); } catch { json = { raw: stream }; }
  return { ...result, json };
}

function invokeHook(f, event, input, cwd = f.workspace) {
  const result = spawnSync(process.execPath, [HOOK, event], {
    cwd,
    env: f.env,
    input: `${JSON.stringify(input)}\n`,
    encoding: "utf8",
  });
  return { ...result, json: JSON.parse(result.stdout) };
}

function start(f) {
  const result = invoke(f, ["start", "--contract", f.contractFile]);
  assert.equal(result.status, 0, result.stderr);
  return result.json.state;
}

test("full lifecycle is contract-gated, auditable, terminal, and restartable as a new run", () => {
  const f = fixture();
  const first = start(f);
  assert.equal(first.status, "active");

  const duplicate = invoke(f, ["start", "--contract", f.contractFile]);
  assert.equal(duplicate.status, 1);
  assert.equal(duplicate.json.error.code, "OBJECTIVE_EXISTS");

  assert.equal(invoke(f, ["cycle-begin", "--item", "work", "--inspection", "Fixture inspected."]).status, 0);
  assert.equal(invoke(f, ["cycle-end", "--result", "pass", "--evidence", "Fixture action verified."]).status, 0);
  assert.equal(invoke(f, ["verify-criterion", "--id", "done", "--evidence", "Criterion evidence recorded."]).status, 0);
  const check = invoke(f, ["run-check", "--id", "check"]);
  assert.equal(check.status, 0);
  assert.equal(check.json.check.passed, true);

  const completed = invoke(f, ["complete", "--evidence", "All gates passed."]);
  assert.equal(completed.status, 0);
  assert.equal(completed.json.state.status, "completed");
  assert.equal(invoke(f, ["audit"]).status, 0);

  const terminalHook = invokeHook(f, "stop", { stop_hook_active: false });
  assert.equal(terminalHook.json.continue, true);
  assert.equal(terminalHook.json.decision, undefined);
  const resurrect = invoke(f, ["wake", "--reason", "try"]);
  assert.equal(resurrect.status, 1);
  assert.equal(resurrect.json.error.code, "INVALID_TRANSITION");

  const second = start(f);
  assert.notEqual(second.id, first.id);
  assert.equal(second.status, "active");
  assert.equal(invoke(f, ["audit"]).status, 0);
  assert.equal(fs.existsSync(path.join(f.codexHome, "persistent-objective-state", "archive", `${first.id}.json`)), true);
});

test("Stop continues once only while active and inside scope", () => {
  const f = fixture();
  start(f);
  const active = invokeHook(f, "stop", { stop_hook_active: false });
  assert.equal(active.status, 0);
  assert.equal(active.json.decision, "block");
  assert.match(active.json.reason, /inspect-act-verify/);

  const reentrant = invokeHook(f, "stop", { stop_hook_active: true });
  assert.equal(reentrant.json.continue, true);
  assert.equal(reentrant.json.decision, undefined);

  const outside = invokeHook(f, "stop", { stop_hook_active: false }, f.root);
  assert.equal(outside.json.continue, true);
  assert.equal(outside.json.decision, undefined);
  assert.match(outside.json.systemMessage, /outside contracted workspace/);

  const outsideStart = invokeHook(f, "session-start", { source: "startup" }, f.root);
  assert.equal(outsideStart.json.continue, true);
  assert.equal(outsideStart.json.hookSpecificOutput, undefined);
  const insideStart = invokeHook(f, "session-start", { source: "startup" });
  assert.equal(insideStart.json.hookSpecificOutput.additionalContext.includes(invoke(f, ["status"]).json.state.id), true);
});

test("sleep, approval pause, explicit wake, and denial enforce lifecycle", () => {
  const f = fixture();
  start(f);
  assert.equal(invoke(f, ["sleep", "--reason", "operator pause"]).json.state.status, "sleeping");
  assert.equal(invokeHook(f, "stop", { stop_hook_active: false }).json.decision, undefined);
  assert.equal(invoke(f, ["wake", "--reason", "operator resume"]).json.state.status, "active");
  assert.equal(invoke(f, ["pause", "--reason", "needs external approval"]).json.state.status, "awaiting-approval");
  assert.equal(invokeHook(f, "stop", { stop_hook_active: false }).json.decision, undefined);
  assert.equal(invoke(f, ["sleep", "--reason", "sleep while waiting"]).json.state.status, "sleeping");
  assert.equal(invoke(f, ["wake", "--reason", "resume waiting"]).json.state.status, "awaiting-approval");
  const denied = invoke(f, ["resolve-approval", "--decision", "denied", "--note", "not authorized"]);
  assert.equal(denied.json.state.status, "stopped");
  assert.equal(invokeHook(f, "stop", { stop_hook_active: false }).json.decision, undefined);
});

test("explicit stop is terminal and cannot be resurrected by hooks or wake", () => {
  const f = fixture();
  start(f);
  const stopped = invoke(f, ["stop", "--reason", "operator requested stop"]);
  assert.equal(stopped.status, 0);
  assert.equal(stopped.json.state.status, "stopped");
  assert.equal(invokeHook(f, "stop", { stop_hook_active: false }).json.decision, undefined);
  assert.equal(invoke(f, ["wake", "--reason", "must fail"]).json.error.code, "INVALID_TRANSITION");
});

test("third identical blocker pauses and requires acknowledgement plus a new plan", () => {
  const f = fixture();
  start(f);
  for (let count = 1; count <= 3; count += 1) {
    const result = invoke(f, ["block", "--fingerprint", "same-root-cause", "--evidence", `attempt ${count}`]);
    assert.equal(result.status, 0);
    assert.equal(result.json.state.blocker.count, count);
  }
  assert.equal(invoke(f, ["status"]).json.state.status, "blocked");
  assert.equal(invoke(f, ["heartbeat"]).json.continuable, false);
  const weakWake = invoke(f, ["wake", "--reason", "again"]);
  assert.equal(weakWake.status, 1);
  assert.equal(weakWake.json.error.code, "ACK_REQUIRED");
  const wake = invoke(f, ["wake", "--reason", "new evidence", "--acknowledge-blocker", "--new-plan", "Use a different verified path."]);
  assert.equal(wake.status, 0);
  assert.equal(wake.json.state.status, "active");
  assert.equal(invoke(f, ["heartbeat"]).json.continuable, true);
});

test("state tampering and version mismatch fail closed", () => {
  const f = fixture();
  start(f);
  const stateFile = path.join(f.codexHome, "persistent-objective-state", "active.json");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  state.payload.objective = "tampered objective";
  fs.writeFileSync(stateFile, `${JSON.stringify(state)}\n`);
  const status = invoke(f, ["status"]);
  assert.equal(status.status, 1);
  assert.equal(status.json.error.code, "TAMPER_DETECTED");
  const hook = invokeHook(f, "stop", { stop_hook_active: false });
  assert.equal(hook.json.decision, undefined);
  assert.match(hook.json.systemMessage, /failed closed/);

  const f2 = fixture();
  start(f2);
  const file2 = path.join(f2.codexHome, "persistent-objective-state", "active.json");
  const state2 = JSON.parse(fs.readFileSync(file2, "utf8"));
  state2.pluginVersion = "0.9.0";
  fs.writeFileSync(file2, `${JSON.stringify(state2)}\n`);
  assert.equal(invoke(f2, ["status"]).json.error.code, "VERSION_MISMATCH");
});

test("duplicate runner is rejected and stale locks are never broken automatically", async () => {
  const f = fixture();
  start(f);
  const child = spawn(process.execPath, [CLI, "heartbeat", "--hold-ms", "1200"], {
    cwd: f.workspace,
    env: f.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lock = path.join(f.codexHome, "persistent-objective-state", "runner.lock");
  for (let tries = 0; tries < 50 && !fs.existsSync(lock); tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(fs.existsSync(lock), true);
  const second = invoke(f, ["heartbeat"]);
  assert.equal(second.status, 1);
  assert.equal(second.json.error.code, "RUNNER_LOCKED");
  await once(child, "close");
  assert.equal(fs.existsSync(lock), false);

  fs.writeFileSync(lock, `${JSON.stringify({ pid: 99999999, token: "dead", owner: "test" })}\n`, { mode: 0o600 });
  const noAutoBreak = invoke(f, ["heartbeat"]);
  assert.equal(noAutoBreak.json.error.code, "RUNNER_LOCKED");
  const wrongRecovery = invoke(f, ["recover-lock", "--expected-pid", "123"]);
  assert.equal(wrongRecovery.json.error.code, "LOCK_MISMATCH");
  const recovery = invoke(f, ["recover-lock", "--expected-pid", "99999999"]);
  assert.equal(recovery.status, 0);
});

test("completion refuses missing evidence, checks, or queue work", () => {
  const f = fixture();
  start(f);
  const result = invoke(f, ["complete", "--evidence", "premature"]);
  assert.equal(result.status, 1);
  assert.equal(result.json.error.code, "NOT_VERIFIED");
  assert.deepEqual(result.json.error.details, {
    missingCriteria: ["done"],
    failedChecks: ["check"],
    pending: ["work"],
  });
});

test("contracts reject scope escape and any blocker limit other than three", () => {
  const f = fixture();
  f.contract.scope.allowedPaths = [".."];
  fs.writeFileSync(f.contractFile, JSON.stringify(f.contract));
  assert.equal(invoke(f, ["start", "--contract", f.contractFile]).json.error.code, "SCOPE_ESCAPE");

  const f2 = fixture();
  f2.contract.stoppingRules.blockerRepeatLimit = 4;
  fs.writeFileSync(f2.contractFile, JSON.stringify(f2.contract));
  assert.equal(invoke(f2, ["start", "--contract", f2.contractFile]).json.error.code, "INVALID_CONTRACT");
});

test("likely secrets are rejected before entering contract state or evidence", () => {
  const f = fixture();
  f.contract.objective = "Use api_key=abcdefghijklmnopqrstuvwxyz012345 for this private task.";
  fs.writeFileSync(f.contractFile, JSON.stringify(f.contract));
  assert.equal(invoke(f, ["start", "--contract", f.contractFile]).json.error.code, "SENSITIVE_TEXT_REJECTED");

  const f2 = fixture();
  start(f2);
  const evidence = invoke(f2, ["block", "--fingerprint", "credential", "--evidence", "Bearer abcdefghijklmnopqrstuvwxyz"]);
  assert.equal(evidence.status, 1);
  assert.equal(evidence.json.error.code, "SENSITIVE_TEXT_REJECTED");
});
