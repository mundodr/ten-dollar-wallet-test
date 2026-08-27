import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SCHEMA_VERSION = 1;
export const PLUGIN_VERSION = "1.0.0";
export const TERMINAL = new Set(["completed", "stopped"]);
export const NON_CONTINUABLE = new Set([
  "sleeping",
  "awaiting-approval",
  "blocked",
  "completed",
  "stopped",
]);

export class PersistentError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "PersistentError";
    this.code = code;
    this.details = details;
  }
}

export function fail(code, message, details) {
  throw new PersistentError(code, message, details);
}

export function nowIso() {
  return new Date().toISOString();
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

const SENSITIVE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}={0,2}\b/i,
  /\b(?:sk|pk)-[A-Za-z0-9_-]{20,}\b/,
  /\b(?:api[_-]?key|password|passwd|secret|access[_-]?token|refresh[_-]?token|cookie)\s*[:=]\s*[^\s,;]{8,}/i,
];

export function safeText(value, label = "text") {
  const text = String(value).trim();
  if (text.length > 4000) fail("TEXT_TOO_LARGE", `${label} exceeds the 4000-character state limit.`);
  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(text))) {
    fail("SENSITIVE_TEXT_REJECTED", `${label} resembles a secret or credential; store only a redacted summary or evidence reference.`);
  }
  return text;
}

export function stateDigest(envelope) {
  return sha256(canonical(envelope.payload));
}

export function stateHome(env = process.env) {
  if (env.PERSISTENT_OBJECTIVE_HOME) return path.resolve(env.PERSISTENT_OBJECTIVE_HOME);
  const codexHome = env.CODEX_HOME ? path.resolve(env.CODEX_HOME) : path.join(os.homedir(), ".codex");
  return path.join(codexHome, "persistent-objective-state");
}

export function pathsFor(env = process.env) {
  const root = stateHome(env);
  return {
    root,
    state: path.join(root, "active.json"),
    events: path.join(root, "events.ndjson"),
    lock: path.join(root, "runner.lock"),
    archive: path.join(root, "archive"),
  };
}

export function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {}
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("UNSAFE_STATE_HOME", `State home must be a real directory: ${dir}`);
  }
}

export function atomicWrite(file, text, mode = 0o600) {
  ensurePrivateDir(path.dirname(file));
  const temp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`,
  );
  let fd;
  try {
    fd = fs.openSync(temp, "wx", mode);
    fs.writeFileSync(fd, text, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, file);
    try {
      const dirFd = fs.openSync(path.dirname(file), "r");
      fs.fsyncSync(dirFd);
      fs.closeSync(dirFd);
    } catch {}
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try {
      fs.unlinkSync(temp);
    } catch {}
  }
}

export function envelope(payload) {
  const base = { schemaVersion: SCHEMA_VERSION, pluginVersion: PLUGIN_VERSION, payload };
  return { ...base, integrity: { algorithm: "sha256", digest: stateDigest(base) } };
}

export function validateEnvelope(value) {
  if (!value || typeof value !== "object") fail("INVALID_STATE", "State must be a JSON object.");
  if (value.schemaVersion !== SCHEMA_VERSION) {
    fail("UNSUPPORTED_SCHEMA", `Expected schema ${SCHEMA_VERSION}; found ${value.schemaVersion}.`);
  }
  if (value.pluginVersion !== PLUGIN_VERSION) {
    fail("VERSION_MISMATCH", `Expected plugin ${PLUGIN_VERSION}; found ${value.pluginVersion}.`);
  }
  if (value.integrity?.algorithm !== "sha256" || value.integrity?.digest !== stateDigest(value)) {
    fail("TAMPER_DETECTED", "State integrity check failed; refusing to continue.");
  }
  return value.payload;
}

export function readState(env = process.env, { optional = false } = {}) {
  const { state } = pathsFor(env);
  if (!fs.existsSync(state)) {
    if (optional) return null;
    fail("NO_OBJECTIVE", "No persistent objective exists.");
  }
  const stat = fs.lstatSync(state);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("UNSAFE_STATE_FILE", "State file is not a regular file.");
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(state, "utf8"));
  } catch (error) {
    fail("INVALID_STATE_JSON", `State JSON cannot be read: ${error.message}`);
  }
  return validateEnvelope(parsed);
}

function appendEvent(env, event) {
  const p = pathsFor(env);
  ensurePrivateDir(p.root);
  const priorHead = event.priorHead ?? "0".repeat(64);
  const body = { ...event, priorHead };
  const eventHash = sha256(canonical(body));
  fs.appendFileSync(p.events, `${JSON.stringify({ ...body, eventHash })}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(p.events, 0o600);
  } catch {}
  return eventHash;
}

export function writeState(payload, env = process.env, event = null) {
  const next = structuredClone(payload);
  next.updatedAt = nowIso();
  if (event) {
    const record = {
      at: next.updatedAt,
      runId: next.id,
      type: event.type,
      data: event.data ?? {},
      priorHead: next.eventHead ?? "0".repeat(64),
    };
    next.eventHead = appendEvent(env, record);
  }
  atomicWrite(pathsFor(env).state, `${JSON.stringify(envelope(next), null, 2)}\n`);
  return next;
}

export function archiveTerminalState(payload, env = process.env) {
  if (!TERMINAL.has(payload.status)) fail("OBJECTIVE_EXISTS", `Objective ${payload.id} is ${payload.status}.`);
  const p = pathsFor(env);
  ensurePrivateDir(p.archive);
  const destination = path.join(p.archive, `${payload.id}.json`);
  if (fs.existsSync(destination)) fail("ARCHIVE_EXISTS", `Archive already exists: ${destination}`);
  fs.renameSync(p.state, destination);
}

function uniqueIds(items, label) {
  const ids = new Set();
  for (const item of items) {
    if (!item || typeof item !== "object" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(item.id ?? "")) {
      fail("INVALID_CONTRACT", `${label} entries need stable ids.`);
    }
    if (ids.has(item.id)) fail("INVALID_CONTRACT", `Duplicate ${label} id: ${item.id}`);
    ids.add(item.id);
  }
}

function inside(parent, candidate) {
  const rel = path.relative(parent, candidate);
  return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== "..");
}

export function validateContract(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("INVALID_CONTRACT", "Contract must be an object.");
  const objective = safeText(input.objective ?? "", "objective");
  if (objective.length < 8 || objective.length > 2000) fail("INVALID_CONTRACT", "objective must be 8-2000 characters.");
  const workspaceRaw = String(input.workspace ?? "").trim();
  if (!path.isAbsolute(workspaceRaw)) fail("INVALID_CONTRACT", "workspace must be an absolute path.");
  let workspace;
  try {
    workspace = fs.realpathSync(workspaceRaw);
  } catch {
    fail("INVALID_CONTRACT", `workspace does not exist: ${workspaceRaw}`);
  }
  const completionCriteria = Array.isArray(input.completionCriteria) ? input.completionCriteria : [];
  if (completionCriteria.length === 0) fail("INVALID_CONTRACT", "At least one completion criterion is required.");
  uniqueIds(completionCriteria, "completionCriteria");
  for (const criterion of completionCriteria) {
    if (!safeText(criterion.text ?? "", `criterion ${criterion.id}`)) fail("INVALID_CONTRACT", `Criterion ${criterion.id} has no text.`);
  }
  const allowedPaths = Array.isArray(input.scope?.allowedPaths) ? input.scope.allowedPaths : [workspace];
  const normalizedPaths = allowedPaths.map((value) => {
    const candidate = path.resolve(workspace, String(value));
    let real;
    try {
      real = fs.realpathSync(candidate);
    } catch {
      fail("INVALID_CONTRACT", `Allowed path must already exist: ${candidate}`);
    }
    if (!inside(workspace, real)) fail("SCOPE_ESCAPE", `Allowed path escapes workspace: ${real}`);
    return real;
  });
  const verificationCommands = Array.isArray(input.verificationCommands) ? input.verificationCommands : [];
  uniqueIds(verificationCommands, "verificationCommands");
  for (const check of verificationCommands) {
    if (!String(check.command ?? "").trim() || !Array.isArray(check.args ?? [])) {
      fail("INVALID_CONTRACT", `Verification ${check.id} needs command and args[].`);
    }
  }
  const queue = Array.isArray(input.queue) ? input.queue : [];
  uniqueIds(queue, "queue");
  const maxCycles = Number(input.stoppingRules?.maxCycles ?? 100);
  const maxRuntimeMinutes = Number(input.stoppingRules?.maxRuntimeMinutes ?? 1440);
  const blockerRepeatLimit = Number(input.stoppingRules?.blockerRepeatLimit ?? 3);
  if (!Number.isInteger(maxCycles) || maxCycles < 1 || maxCycles > 10000) fail("INVALID_CONTRACT", "maxCycles must be 1-10000.");
  if (!Number.isFinite(maxRuntimeMinutes) || maxRuntimeMinutes < 1 || maxRuntimeMinutes > 525600) fail("INVALID_CONTRACT", "maxRuntimeMinutes must be 1-525600.");
  if (blockerRepeatLimit !== 3) fail("INVALID_CONTRACT", "blockerRepeatLimit must be exactly 3.");
  return {
    objective,
    workspace,
    completionCriteria: completionCriteria.map((item) => ({ id: item.id, text: safeText(item.text, `criterion ${item.id}`) })),
    scope: {
      allowedPaths: [...new Set(normalizedPaths)],
      permittedSources: (input.scope?.permittedSources ?? []).map((item) => safeText(item, "permitted source")),
      forbiddenActions: (input.scope?.forbiddenActions ?? []).map((item) => safeText(item, "forbidden action")),
    },
    approvals: {
      requiredFor: (input.approvals?.requiredFor ?? ["external side effects", "credentials", "payments", "destructive operations"]).map((item) => safeText(item, "approval boundary")),
      neverBypass: true,
    },
    verificationCommands: verificationCommands.map((item) => ({
      id: item.id,
      command: String(item.command),
      args: item.args.map(String),
    })),
    queue: queue.map((item) => ({ id: item.id, text: safeText(item.text ?? "", `queue item ${item.id}`), status: "pending" })),
    stoppingRules: { maxCycles, maxRuntimeMinutes, blockerRepeatLimit },
  };
}

export function newState(contract) {
  const createdAt = nowIso();
  return {
    id: `po_${crypto.randomUUID()}`,
    status: "active",
    objective: contract.objective,
    workspace: contract.workspace,
    completionCriteria: contract.completionCriteria,
    scope: contract.scope,
    approvals: contract.approvals,
    verificationCommands: contract.verificationCommands,
    stoppingRules: contract.stoppingRules,
    queue: contract.queue,
    verificationEvidence: {},
    checkResults: {},
    currentCycle: null,
    cycleCount: 0,
    blocker: null,
    approvalPause: null,
    completionEvidence: null,
    stopReason: null,
    createdAt,
    updatedAt: createdAt,
    deadlineAt: new Date(Date.parse(createdAt) + contract.stoppingRules.maxRuntimeMinutes * 60000).toISOString(),
    eventHead: "0".repeat(64),
  };
}

export function continuability(state, cwd = process.cwd(), now = Date.now()) {
  if (NON_CONTINUABLE.has(state.status)) return { continue: false, reason: `status=${state.status}` };
  if (state.status !== "active") return { continue: false, reason: `unknown status=${state.status}` };
  let realCwd;
  try {
    realCwd = fs.realpathSync(cwd);
  } catch {
    return { continue: false, reason: "cwd unavailable" };
  }
  if (!inside(state.workspace, realCwd)) return { continue: false, reason: "outside contracted workspace" };
  if (state.cycleCount >= state.stoppingRules.maxCycles) return { continue: false, reason: "cycle limit reached" };
  if (now >= Date.parse(state.deadlineAt)) return { continue: false, reason: "runtime limit reached" };
  if (state.blocker?.count >= state.stoppingRules.blockerRepeatLimit) return { continue: false, reason: "blocker limit reached" };
  return { continue: true, reason: "active and within bounds" };
}

export function acquireLease(env = process.env, options = {}) {
  const p = pathsFor(env);
  ensurePrivateDir(p.root);
  const owner = options.owner ?? `pid:${process.pid}`;
  const ttlMs = Number(options.ttlMs ?? 30000);
  if (!Number.isFinite(ttlMs) || ttlMs < 1000 || ttlMs > 300000) fail("INVALID_LEASE", "Lease TTL must be 1-300 seconds.");
  const token = crypto.randomUUID();
  const record = { schemaVersion: 1, owner, pid: process.pid, token, createdAt: nowIso(), expiresAt: new Date(Date.now() + ttlMs).toISOString() };
  let fd;
  try {
    fd = fs.openSync(p.lock, "wx", 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
  } catch (error) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
    if (error.code === "EEXIST") {
      let holder = "unreadable";
      try { holder = JSON.parse(fs.readFileSync(p.lock, "utf8")); } catch {}
      fail("RUNNER_LOCKED", "Another runner owns the objective; no automatic stale-lock break is allowed.", holder);
    }
    throw error;
  }
  let released = false;
  return {
    record,
    release() {
      if (released) return;
      let current;
      try { current = JSON.parse(fs.readFileSync(p.lock, "utf8")); } catch { fail("LOCK_TAMPERED", "Runner lock disappeared or became unreadable."); }
      if (current.token !== token) fail("LOCK_OWNERSHIP_LOST", "Runner lock token changed; refusing to remove it.");
      fs.unlinkSync(p.lock);
      released = true;
    },
  };
}

export function withLease(env, fn, options = {}) {
  const lease = acquireLease(env, options);
  try {
    return fn(lease.record);
  } finally {
    lease.release();
  }
}

export function recoverLock(env = process.env, expectedPid) {
  const p = pathsFor(env);
  if (!fs.existsSync(p.lock)) fail("NO_LOCK", "No runner lock exists.");
  let record;
  try { record = JSON.parse(fs.readFileSync(p.lock, "utf8")); } catch { fail("LOCK_TAMPERED", "Runner lock is unreadable; manual file recovery is required."); }
  if (String(record.pid) !== String(expectedPid)) fail("LOCK_MISMATCH", "Expected pid does not match lock owner.", record);
  let alive = true;
  try { process.kill(Number(record.pid), 0); } catch (error) { if (error.code === "ESRCH") alive = false; else throw error; }
  if (alive) fail("LOCK_OWNER_ALIVE", `PID ${record.pid} is still alive.`);
  fs.unlinkSync(p.lock);
  return record;
}

export function readJsonFile(file) {
  const resolved = path.resolve(file);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("UNSAFE_INPUT", `Expected regular JSON file: ${resolved}`);
  try { return JSON.parse(fs.readFileSync(resolved, "utf8")); } catch (error) { fail("INVALID_JSON", error.message); }
}

export function publicState(state) {
  const nextPending = state.queue.find((item) => item.status === "pending") ?? null;
  return {
    id: state.id,
    status: state.status,
    awake: state.status === "active",
    objective: state.objective,
    workspace: state.workspace,
    cycleCount: state.cycleCount,
    maxCycles: state.stoppingRules.maxCycles,
    deadlineAt: state.deadlineAt,
    queue: state.queue,
    blocker: state.blocker,
    approvalPause: state.approvalPause,
    criteria: state.completionCriteria.map((item) => ({
      ...item,
      verified: Boolean(state.verificationEvidence[item.id]),
      evidence: state.verificationEvidence[item.id] ?? null,
    })),
    checks: state.verificationCommands.map((item) => ({ ...item, result: state.checkResults[item.id] ?? null })),
    currentCycle: state.currentCycle,
    nextAction: state.currentCycle ? { type: "finish-cycle", cycle: state.currentCycle } : nextPending,
    completionEvidence: state.completionEvidence,
    stopReason: state.stopReason,
    lastResolvedBlocker: state.blockerHistory?.at(-1) ?? null,
    updatedAt: state.updatedAt,
  };
}
