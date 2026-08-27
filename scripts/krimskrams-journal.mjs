#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const stateDir = path.resolve(".krimskrams");
const stateFile = path.join(stateDir, "journal.json");
const baseUrl = "https://krimskrams.xyz";

function newestTitle(xml) {
  const match = xml.match(/<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
  return match?.[1]?.trim() || null;
}

async function loadState() {
  try {
    return JSON.parse(await readFile(stateFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function saveState(state) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

async function fetchFeed(feedUrl) {
  const response = await fetch(feedUrl, {
    headers: { "User-Agent": "ten-dollar-wallet-agent/1.0" },
  });
  if (!response.ok) throw new Error(`Feed fetch failed: HTTP ${response.status}`);
  return response.text();
}

async function start() {
  const existing = await loadState();
  if (existing) {
    console.log(JSON.stringify({ status: "already-started", firstFetchAt: existing.fetches[0]?.at, fetchCount: existing.fetches.length }, null, 2));
    return;
  }

  const response = await fetch(`${baseUrl}/journal/subscribe`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "ten-dollar-wallet-agent/1.0",
    },
    body: JSON.stringify({ label: "ten-dollar-wallet-agent" }),
  });
  if (!response.ok) throw new Error(`Subscribe failed: HTTP ${response.status}`);
  const subscription = await response.json();
  const token = subscription.token;
  const feedUrl = subscription.feed_url || subscription.feedUrl || `${baseUrl}/journal/feed.xml?sub=${encodeURIComponent(token)}`;
  if (!token) throw new Error("Subscribe response did not include a token");

  const at = new Date().toISOString();
  const xml = await fetchFeed(feedUrl);
  const state = {
    token,
    feedUrl,
    label: "ten-dollar-wallet-agent",
    createdAt: at,
    fetches: [{ at, utcDate: at.slice(0, 10), newestTitle: newestTitle(xml) }],
  };
  await saveState(state);
  console.log(JSON.stringify({ status: "started", firstFetchAt: at, utcDate: at.slice(0, 10), newestTitle: state.fetches[0].newestTitle }, null, 2));
}

async function revisit() {
  const state = await loadState();
  if (!state) throw new Error("No subscription state; run start first");
  const today = new Date().toISOString().slice(0, 10);
  if (state.fetches.some((entry) => entry.utcDate === today)) {
    console.log(JSON.stringify({ status: "same-utc-day", today, fetchCount: state.fetches.length }, null, 2));
    return;
  }
  const xml = await fetchFeed(state.feedUrl);
  const at = new Date().toISOString();
  state.fetches.push({ at, utcDate: at.slice(0, 10), newestTitle: newestTitle(xml) });
  await saveState(state);
  console.log(JSON.stringify({ status: "revisited", at, utcDate: at.slice(0, 10), newestTitle: state.fetches.at(-1).newestTitle, qualifiedLocally: new Set(state.fetches.map((entry) => entry.utcDate)).size >= 2 }, null, 2));
}

async function status() {
  const state = await loadState();
  if (!state) {
    console.log(JSON.stringify({ status: "not-started" }, null, 2));
    return;
  }
  console.log(JSON.stringify({
    status: "started",
    label: state.label,
    fetches: state.fetches,
    distinctUtcDays: new Set(state.fetches.map((entry) => entry.utcDate)).size,
    tokenStoredLocally: true,
  }, null, 2));
}

const command = process.argv[2] || "status";
if (command === "start") await start();
else if (command === "revisit") await revisit();
else if (command === "status") await status();
else throw new Error(`Unknown command: ${command}`);
