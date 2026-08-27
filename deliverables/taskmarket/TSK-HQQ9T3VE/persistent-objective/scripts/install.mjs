#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWrite, canonical, fail, sha256 } from "./lib.mjs";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = "1.0.0";
const MARKER = `persistent-objective@${VERSION}`;

function parse(argv) {
  const [command = "install", ...rest] = argv;
  const flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    if (!rest[index].startsWith("--")) fail("INVALID_ARGUMENT", `Unexpected argument: ${rest[index]}`);
    const key = rest[index].slice(2);
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) flags[key] = true;
    else { flags[key] = value; index += 1; }
  }
  return { command, flags };
}

function locations(flags) {
  const raw = flags["codex-home"] ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
  const codexHome = path.resolve(String(raw));
  if (codexHome === path.parse(codexHome).root) fail("UNSAFE_TARGET", "CODEX_HOME cannot be a filesystem root.");
  return {
    codexHome,
    runtime: path.join(codexHome, "persistent-objective-runtime"),
    skill: path.join(codexHome, "skills", "persistent-objective"),
    hooks: path.join(codexHome, "hooks.json"),
    state: path.join(codexHome, "persistent-objective-state"),
  };
}

function assertSafeHome(loc) {
  fs.mkdirSync(loc.codexHome, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(loc.codexHome);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("UNSAFE_TARGET", "CODEX_HOME must be a real directory.");
}

function readHooks(file) {
  if (!fs.existsSync(file)) return { existed: false, text: null, payload: { hooks: {} } };
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("UNSAFE_HOOKS", "hooks.json must be a regular file.");
  try {
    const text = fs.readFileSync(file, "utf8");
    const payload = JSON.parse(text);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("root is not an object");
    if (payload.hooks !== undefined && (!payload.hooks || typeof payload.hooks !== "object" || Array.isArray(payload.hooks))) {
      throw new Error("hooks is not an object");
    }
    payload.hooks ??= {};
    return { existed: true, text, payload };
  } catch (error) {
    fail("INVALID_HOOKS", `Existing hooks.json cannot be merged safely: ${error.message}`);
  }
}

function jsonTree(text) {
  let cursor = 0;
  const whitespace = () => { while (/\s/.test(text[cursor] ?? "")) cursor += 1; };
  const stringNode = () => {
    const start = cursor;
    cursor += 1;
    while (cursor < text.length) {
      if (text[cursor] === "\\") cursor += 2;
      else if (text[cursor] === '"') { cursor += 1; return { type: "string", start, end: cursor }; }
      else cursor += 1;
    }
    fail("INVALID_HOOKS", "Unterminated JSON string.");
  };
  const value = () => {
    whitespace();
    const start = cursor;
    if (text[cursor] === '"') return stringNode();
    if (text[cursor] === "{") {
      cursor += 1;
      const properties = [];
      whitespace();
      if (text[cursor] === "}") { cursor += 1; return { type: "object", start, end: cursor, properties }; }
      while (cursor < text.length) {
        whitespace();
        const keyNode = stringNode();
        const key = JSON.parse(text.slice(keyNode.start, keyNode.end));
        if (properties.some((candidate) => candidate.key === key)) fail("INVALID_HOOKS", `Duplicate JSON key is unsafe: ${key}`);
        whitespace();
        if (text[cursor] !== ":") fail("INVALID_HOOKS", "Expected JSON colon.");
        cursor += 1;
        const child = value();
        properties.push({ key, keyNode, value: child });
        whitespace();
        if (text[cursor] === "}") { cursor += 1; return { type: "object", start, end: cursor, properties }; }
        if (text[cursor] !== ",") fail("INVALID_HOOKS", "Expected JSON object comma.");
        cursor += 1;
      }
      fail("INVALID_HOOKS", "Unterminated JSON object.");
    }
    if (text[cursor] === "[") {
      cursor += 1;
      const items = [];
      whitespace();
      if (text[cursor] === "]") { cursor += 1; return { type: "array", start, end: cursor, items }; }
      while (cursor < text.length) {
        items.push(value());
        whitespace();
        if (text[cursor] === "]") { cursor += 1; return { type: "array", start, end: cursor, items }; }
        if (text[cursor] !== ",") fail("INVALID_HOOKS", "Expected JSON array comma.");
        cursor += 1;
      }
      fail("INVALID_HOOKS", "Unterminated JSON array.");
    }
    while (cursor < text.length && !/[\s,\]}]/.test(text[cursor])) cursor += 1;
    if (cursor === start) fail("INVALID_HOOKS", "Expected JSON value.");
    return { type: "primitive", start, end: cursor };
  };
  const root = value();
  whitespace();
  if (cursor !== text.length || root.type !== "object") fail("INVALID_HOOKS", "hooks.json root must be one JSON object.");
  return root;
}

function property(node, key) {
  return node.properties.find((candidate) => candidate.key === key) ?? null;
}

function quoteCommand(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function hookGroups(loc) {
  const command = quoteCommand(path.join(loc.runtime, "hook.mjs"));
  return {
    SessionStart: {
      matcher: "startup|resume|compact",
      hooks: [{
        type: "command",
        command: `node ${command} session-start`,
        timeout: 5,
        statusMessage: `[${MARKER}] Loading bounded objective state`,
        additionalContextLimit: 6000,
      }],
    },
    Stop: {
      hooks: [{
        type: "command",
        command: `node ${command} stop`,
        timeout: 5,
        statusMessage: `[${MARKER}] Checking objective bounds`,
      }],
    },
  };
}

function mergeHooks(loc) {
  const current = readHooks(loc.hooks);
  const groups = hookGroups(loc);
  for (const [event, group] of Object.entries(groups)) {
    current.payload.hooks[event] ??= [];
    if (!Array.isArray(current.payload.hooks[event])) fail("INVALID_HOOKS", `hooks.${event} must be an array.`);
    const collision = current.payload.hooks[event].some((candidate) =>
      JSON.stringify(candidate).includes("persistent-objective@") ||
      JSON.stringify(candidate).includes("persistent-objective-runtime"));
    if (collision) fail("INSTALL_COLLISION", `A Persistent Objective hook already exists in ${event}.`);
    current.payload.hooks[event].push(group);
  }
  if (!current.existed) {
    const mergedText = `${JSON.stringify({ hooks: Object.fromEntries(Object.entries(groups).map(([event, group]) => [event, [group]])) }, null, 2)}\n`;
    atomicWrite(loc.hooks, mergedText);
    return {
      hooksFileExisted: false,
      addedGroups: Object.fromEntries(Object.entries(groups).map(([event, group]) => [event, sha256(canonical(group))])),
      hookInsertions: [],
      createdHooksDigest: sha256(mergedText),
    };
  }

  const root = jsonTree(current.text);
  const hooksProperty = property(root, "hooks");
  const edits = [];
  if (!hooksProperty) {
    const body = JSON.stringify(Object.fromEntries(Object.entries(groups).map(([event, group]) => [event, [group]])));
    edits.push({ position: root.end - 1, text: `${root.properties.length ? "," : ""}\"hooks\":${body}` });
  } else {
    if (hooksProperty.value.type !== "object") fail("INVALID_HOOKS", "hooks must be a JSON object.");
    const missing = [];
    for (const [event, group] of Object.entries(groups)) {
      const eventProperty = property(hooksProperty.value, event);
      if (!eventProperty) missing.push([event, group]);
      else {
        if (eventProperty.value.type !== "array") fail("INVALID_HOOKS", `hooks.${event} must be an array.`);
        edits.push({
          position: eventProperty.value.end - 1,
          text: `${eventProperty.value.items.length ? "," : ""}${JSON.stringify(group)}`,
        });
      }
    }
    if (missing.length) {
      const text = missing.map(([event, group]) => `${JSON.stringify(event)}:[${JSON.stringify(group)}]`).join(",");
      edits.push({
        position: hooksProperty.value.end - 1,
        text: `${hooksProperty.value.properties.length ? "," : ""}${text}`,
      });
    }
  }
  let mergedText = current.text;
  for (const edit of [...edits].sort((left, right) => right.position - left.position)) {
    mergedText = `${mergedText.slice(0, edit.position)}${edit.text}${mergedText.slice(edit.position)}`;
  }
  JSON.parse(mergedText);
  atomicWrite(loc.hooks, mergedText);
  return {
    hooksFileExisted: true,
    addedGroups: Object.fromEntries(Object.entries(groups).map(([event, group]) => [event, sha256(canonical(group))])),
    hookInsertions: edits.map((edit) => edit.text),
    originalHooksDigest: sha256(current.text),
  };
}

function copyFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const data = fs.readFileSync(source);
  const fd = fs.openSync(destination, "wx", 0o600);
  try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function install(flags) {
  const loc = locations(flags);
  assertSafeHome(loc);
  if (fs.existsSync(loc.runtime) || fs.existsSync(loc.skill)) {
    fail("INSTALL_COLLISION", "Runtime or skill target already exists; no files were overwritten.");
  }
  const plan = {
    codexHome: loc.codexHome,
    runtime: loc.runtime,
    skill: loc.skill,
    hooks: loc.hooks,
    preservesStateAt: loc.state,
  };
  if (flags["dry-run"] === true) return { ok: true, dryRun: true, plan };
  let hooksChanged = false;
  let hookInstall = null;
  try {
    fs.mkdirSync(loc.runtime, { recursive: false, mode: 0o700 });
    for (const name of ["lib.mjs", "persistent.mjs", "hook.mjs", "install.mjs"]) {
      copyFile(path.join(PLUGIN_ROOT, "scripts", name), path.join(loc.runtime, name));
    }
    fs.mkdirSync(loc.skill, { recursive: true, mode: 0o700 });
    copyFile(path.join(PLUGIN_ROOT, "skills", "persistent-objective", "SKILL.md"), path.join(loc.skill, "SKILL.md"));
    hookInstall = mergeHooks(loc);
    hooksChanged = true;
    const fileHashes = Object.fromEntries(
      ["lib.mjs", "persistent.mjs", "hook.mjs", "install.mjs"].map((name) => [
        name,
        sha256(fs.readFileSync(path.join(loc.runtime, name))),
      ]),
    );
    const manifest = {
      schemaVersion: 1,
      pluginVersion: VERSION,
      marker: MARKER,
      installedAt: new Date().toISOString(),
      sourceDigest: sha256(canonical({
        manifest: fs.readFileSync(path.join(PLUGIN_ROOT, ".codex-plugin", "plugin.json"), "utf8"),
        skill: fs.readFileSync(path.join(PLUGIN_ROOT, "skills", "persistent-objective", "SKILL.md"), "utf8"),
      })),
      files: ["lib.mjs", "persistent.mjs", "hook.mjs", "install.mjs"],
      fileHashes,
      skillFile: loc.skill,
      skillHash: sha256(fs.readFileSync(path.join(loc.skill, "SKILL.md"))),
      hooksFile: loc.hooks,
      ...hookInstall,
    };
    atomicWrite(path.join(loc.runtime, "install-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    return {
      ok: true,
      installed: true,
      ...plan,
      lifecycleCommand: `node ${path.join(loc.runtime, "persistent.mjs")}`,
      trustRequired: "Review and trust the exact hooks with /hooks before use. No trust bypass flag is used.",
    };
  } catch (error) {
    if (hooksChanged && hookInstall) {
      try { removeExactHooks(loc, hookInstall); } catch {}
    }
    try { fs.rmSync(loc.runtime, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(loc.skill, { recursive: true, force: true }); } catch {}
    throw error;
  }
}

function removeExactHooks(loc, manifest) {
  const current = readHooks(loc.hooks);
  if (!current.existed) fail("UNINSTALL_MISMATCH", "hooks.json disappeared; refusing partial uninstall.");
  for (const [event, expectedHash] of Object.entries(manifest.addedGroups)) {
    const groups = current.payload.hooks[event];
    if (!Array.isArray(groups)) fail("UNINSTALL_MISMATCH", `hooks.${event} is missing.`);
    const indexes = groups.map((group, index) => ({ group, index })).filter(({ group }) => sha256(canonical(group)) === expectedHash);
    if (indexes.length !== 1) fail("UNINSTALL_MISMATCH", `Installed ${event} hook was modified or duplicated; no hook changes were made.`);
  }
  if (!manifest.hooksFileExisted) {
    if (sha256(current.text) !== manifest.createdHooksDigest) {
      fail("UNINSTALL_MISMATCH", "Plugin-created hooks.json was modified; no hook changes were made.");
    }
    fs.unlinkSync(loc.hooks);
    return;
  }
  let restored = current.text;
  for (const insertion of [...manifest.hookInsertions].reverse()) {
    const first = restored.indexOf(insertion);
    if (first < 0 || restored.indexOf(insertion, first + insertion.length) >= 0) {
      fail("UNINSTALL_MISMATCH", "Installed Hook bytes were modified or duplicated; no hook changes were made.");
    }
    restored = `${restored.slice(0, first)}${restored.slice(first + insertion.length)}`;
  }
  JSON.parse(restored);
  atomicWrite(loc.hooks, restored);
}

function uninstall(flags) {
  const loc = locations(flags);
  assertSafeHome(loc);
  const manifestPath = path.join(loc.runtime, "install-manifest.json");
  if (!fs.existsSync(manifestPath)) fail("NOT_INSTALLED", "Install manifest is missing; refusing to guess what to remove.");
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch (error) { fail("INVALID_MANIFEST", error.message); }
  if (manifest.schemaVersion !== 1 || manifest.pluginVersion !== VERSION || manifest.marker !== MARKER) {
    fail("INVALID_MANIFEST", "Install manifest version or marker does not match.");
  }
  const skillFile = path.join(loc.skill, "SKILL.md");
  if (!fs.existsSync(skillFile) || sha256(fs.readFileSync(skillFile)) !== manifest.skillHash) {
    fail("UNINSTALL_MISMATCH", "Installed skill was modified or missing; no uninstall changes were made.");
  }
  for (const name of manifest.files) {
    const candidate = path.join(loc.runtime, name);
    if (!fs.existsSync(candidate) || !fs.lstatSync(candidate).isFile() || sha256(fs.readFileSync(candidate)) !== manifest.fileHashes?.[name]) {
      fail("UNINSTALL_MISMATCH", `Installed runtime file is modified or missing: ${name}. No uninstall changes were made.`);
    }
  }
  removeExactHooks(loc, manifest);
  fs.rmSync(loc.skill, { recursive: true });
  fs.rmSync(loc.runtime, { recursive: true });
  return {
    ok: true,
    uninstalled: true,
    preservedState: fs.existsSync(loc.state) ? loc.state : null,
    note: "Only exact plugin hooks, runtime, and skill were removed. Persistent objective state was not deleted.",
  };
}

const { command, flags } = parse(process.argv.slice(2));
try {
  const result = command === "install" ? install(flags)
    : command === "uninstall" ? uninstall(flags)
      : fail("UNKNOWN_COMMAND", "Use install or uninstall.");
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: { code: error.code ?? "UNEXPECTED", message: error.message, details: error.details } }, null, 2)}\n`);
  process.exitCode = 1;
}
