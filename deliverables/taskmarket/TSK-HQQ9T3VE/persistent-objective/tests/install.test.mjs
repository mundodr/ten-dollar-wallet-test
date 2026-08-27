import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = path.join(ROOT, "scripts", "install.mjs");

function invoke(home, command) {
  const result = spawnSync(process.execPath, [INSTALLER, command, "--codex-home", home], {
    encoding: "utf8",
    env: { ...process.env, CODEX_HOME: home },
  });
  const stream = result.status === 0 ? result.stdout : result.stderr;
  return { ...result, json: JSON.parse(stream) };
}

function tempHome() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "persistent-install-test-"));
  const home = path.join(root, "codex-home");
  fs.mkdirSync(home, { recursive: true });
  return home;
}

test("install additively merges and uninstall restores unrelated hooks", () => {
  const home = tempHome();
  const hooksFile = path.join(home, "hooks.json");
  const baseline = {
    description: "must survive byte-for-byte semantically",
    custom: { retained: true },
    hooks: {
      PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "true", timeout: 1 }] }],
    },
  };
  const baselineText = `  ${JSON.stringify(baseline)}\n`;
  fs.writeFileSync(hooksFile, baselineText);

  const installed = invoke(home, "install");
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(installed.json.installed, true);
  const merged = JSON.parse(fs.readFileSync(hooksFile, "utf8"));
  assert.deepEqual(merged.custom, baseline.custom);
  assert.deepEqual(merged.hooks.PostToolUse, baseline.hooks.PostToolUse);
  assert.equal(merged.hooks.SessionStart.length, 1);
  assert.equal(merged.hooks.Stop.length, 1);
  assert.equal(fs.existsSync(path.join(home, "skills", "persistent-objective", "SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(home, "persistent-objective-runtime", "persistent.mjs")), true);

  const collision = invoke(home, "install");
  assert.equal(collision.status, 1);
  assert.equal(collision.json.error.code, "INSTALL_COLLISION");

  const removed = invoke(home, "uninstall");
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(fs.readFileSync(hooksFile, "utf8"), baselineText);
  assert.deepEqual(JSON.parse(fs.readFileSync(hooksFile, "utf8")), baseline);
  assert.equal(fs.existsSync(path.join(home, "skills", "persistent-objective")), false);
  assert.equal(fs.existsSync(path.join(home, "persistent-objective-runtime")), false);
});

test("uninstall removes a hooks file created solely by the plugin and preserves state", () => {
  const home = tempHome();
  assert.equal(invoke(home, "install").status, 0);
  const state = path.join(home, "persistent-objective-state");
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, "evidence.txt"), "preserve me\n");
  const removed = invoke(home, "uninstall");
  assert.equal(removed.status, 0);
  assert.equal(fs.existsSync(path.join(home, "hooks.json")), false);
  assert.equal(fs.readFileSync(path.join(state, "evidence.txt"), "utf8"), "preserve me\n");
});

test("tampered hook causes fail-closed uninstall with no partial removal", () => {
  const home = tempHome();
  assert.equal(invoke(home, "install").status, 0);
  const hooksFile = path.join(home, "hooks.json");
  const hooks = JSON.parse(fs.readFileSync(hooksFile, "utf8"));
  hooks.hooks.Stop[0].hooks[0].timeout = 999;
  fs.writeFileSync(hooksFile, `${JSON.stringify(hooks, null, 2)}\n`);
  const result = invoke(home, "uninstall");
  assert.equal(result.status, 1);
  assert.equal(result.json.error.code, "UNINSTALL_MISMATCH");
  const after = JSON.parse(fs.readFileSync(hooksFile, "utf8"));
  assert.equal(after.hooks.SessionStart.length, 1);
  assert.equal(after.hooks.Stop[0].hooks[0].timeout, 999);
  assert.equal(fs.existsSync(path.join(home, "persistent-objective-runtime")), true);
  assert.equal(fs.existsSync(path.join(home, "skills", "persistent-objective")), true);
});

test("dry-run makes no changes", () => {
  const home = tempHome();
  const result = spawnSync(process.execPath, [INSTALLER, "install", "--codex-home", home, "--dry-run"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).dryRun, true);
  assert.deepEqual(fs.readdirSync(home), []);
});
