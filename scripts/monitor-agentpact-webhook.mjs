import { readFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://api.agentpact.xyz";
const publicUrl =
  "https://simply-technician-crowd-newton.trycloudflare.com/agentpact/webhook";
const requiredEvents = [
  "deal.proposed",
  "deal.accepted",
  "payment.funded",
  "payment.released",
  "milestone.completed",
  "webhook.test",
];
const credentials = JSON.parse(
  await readFile(path.resolve(".agentpact/credentials.json"), "utf8"),
);

const response = await fetch(`${baseUrl}/api/webhooks`, {
  headers: { Accept: "application/json", "x-api-key": credentials.apiKey },
  signal: AbortSignal.timeout(30_000),
});
const webhooks = await response.json().catch(() => null);
if (!response.ok || !Array.isArray(webhooks)) {
  throw new Error(`AgentPact webhook list failed (${response.status})`);
}
const webhook = webhooks.find(
  (item) => item.url === publicUrl && item.active !== false,
);
const configuredEvents = webhook?.events ?? webhook?.event_types ?? [];
const eventsComplete = requiredEvents.every((event) =>
  configuredEvents.includes(event),
);

let entries = [];
try {
  entries = (await readFile(path.resolve(".agentpact/webhook-events.ndjson"), "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      registered: Boolean(webhook),
      webhookId: webhook?.id ?? null,
      active: webhook?.active ?? null,
      events: configuredEvents,
      eventsComplete,
      receivedEventCount: entries.length,
      lastReceivedAt: entries.at(-1)?.receivedAt ?? null,
      lastEventType:
        entries.at(-1)?.event?.type ?? entries.at(-1)?.event?.event ?? null,
      countingPolicy:
        "Webhook notifications are workflow signals only. Count only an independently verified matching mainnet target-wallet transfer.",
    },
    null,
    2,
  ),
);

if (!webhook || !eventsComplete) {
  throw new Error("AgentPact webhook is missing or has incomplete events");
}
