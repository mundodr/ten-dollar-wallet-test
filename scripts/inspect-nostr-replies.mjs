#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { SimplePool } from "nostr-tools";

const directory = new URL("../.nostr/", import.meta.url);
const publications = [
  ["work-offer", "work-offer-result.json"],
  ["network-update", "network-update-result.json"],
  ["agentictrade-service", "agentictrade-service-result.json"],
  ["datapoint-service", "datapoint-service-result.json"],
];

const records = [];
for (const [label, file] of publications) {
  try {
    records.push({ label, ...JSON.parse(await readFile(new URL(file, directory), "utf8")) });
  } catch {}
}

const relays = [...new Set(records.flatMap((record) => record.acceptedRelays ?? []))];
const pool = new SimplePool({ enableReconnect: false });
const output = [];
for (const record of records) {
  const events = await pool.querySync(
    relays,
    { kinds: [1], "#e": [record.eventId] },
    { maxWait: 10_000 },
  );
  for (const event of events) {
    output.push({
      publication: record.label,
      eventId: event.id,
      pubkey: event.pubkey,
      ownReply: event.pubkey === record.pubkey,
      createdAt: new Date(event.created_at * 1000).toISOString(),
      content: event.content,
      references: event.tags
        .filter(([name]) => name === "e" || name === "p")
        .map(([name, value, relay, marker]) => ({ name, value, relay: relay || null, marker: marker || null })),
    });
  }
}
pool.destroy();

console.log(JSON.stringify({ checkedAt: new Date().toISOString(), count: output.length, replies: output }, null, 2));
