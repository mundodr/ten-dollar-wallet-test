#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const STATE_DIR = path.join(ROOT, ".taskforce");
const STATE_PATH = path.join(STATE_DIR, "state.json");
const API = "https://task-force.app";

async function request(route, { method = "GET", body, apiKey } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (apiKey) headers["X-API-Key"] = apiKey;
  const response = await fetch(`${API}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text.slice(0, 2000) };
  }
  if (!response.ok) {
    throw new Error(`${method} ${route} -> ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function readState() {
  return JSON.parse(await readFile(STATE_PATH, "utf8"));
}

async function register() {
  await mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
  let existing;
  try {
    existing = await readState();
  } catch {}
  if (existing?.apiKey) {
    console.log(JSON.stringify({ status: "already-registered", agent: existing.agent }, null, 2));
    return;
  }

  const payload = await request("/api/agent/register", {
    method: "POST",
    body: {
      name: `TenDollarQA-${Date.now().toString(36).slice(-6)}`,
      capabilities: [
        "coding",
        "research",
        "data-analysis",
        "testing",
        "technical-writing",
        "browser",
      ],
    },
  });
  const state = {
    registeredAt: new Date().toISOString(),
    apiKey: payload.apiKey,
    agent: payload.agent,
    withdrawalTargets: {
      solana: "o9mfxQnHja71MNvU81gdx4VtFaYRGxGFLKDjPJKiPYt",
      base: "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18",
    },
  };
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ status: "registered", agent: state.agent }, null, 2));
}

async function list() {
  const state = await readState();
  const payload = await request("/api/agent/tasks?status=ACTIVE&limit=100", { apiKey: state.apiKey });
  console.log(JSON.stringify(payload, null, 2));
}

async function status() {
  const state = await readState();
  const [tasks, earnings, notifications] = await Promise.allSettled([
    request("/api/agent/tasks?status=ACTIVE&limit=100", { apiKey: state.apiKey }),
    request("/api/agent/earnings", { apiKey: state.apiKey }),
    request("/api/agent/notifications?unreadOnly=true&limit=100", { apiKey: state.apiKey }),
  ]);
  const value = (result) => result.status === "fulfilled" ? result.value : { error: result.reason.message };
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    agent: state.agent,
    exactWithdrawalTargets: state.withdrawalTargets,
    tasks: value(tasks),
    earnings: value(earnings),
    notifications: value(notifications),
  }, null, 2));
}

const command = process.argv[2];
if (command === "register") await register();
else if (command === "list") await list();
else if (command === "status") await status();
else throw new Error("Usage: node scripts/taskforce.mjs <register|list|status>");
