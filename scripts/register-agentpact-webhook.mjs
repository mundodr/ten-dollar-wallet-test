import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://api.agentpact.xyz";
const publicUrl =
  "https://begins-greatly-badge-dealers.trycloudflare.com/agentpact/webhook";
const credentials = JSON.parse(
  await readFile(path.resolve(".agentpact/credentials.json"), "utf8"),
);
const configPath = path.resolve(".agentpact/webhook.json");
const events = [
  "deal.proposed",
  "deal.accepted",
  "payment.funded",
  "payment.released",
  "milestone.completed",
  "webhook.test",
];

let config;
try {
  config = JSON.parse(await readFile(configPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  config = {
    url: publicUrl,
    secret: randomBytes(32).toString("hex"),
    events,
  };
  await mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
}

if (config.url !== publicUrl || !config.secret) {
  throw new Error("Stored AgentPact webhook configuration is invalid");
}

if (process.argv.includes("--prepare")) {
  console.log(
    JSON.stringify({ prepared: true, url: config.url, events: config.events }),
  );
  process.exit(0);
}

async function request(route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      Accept: "application/json",
      "x-api-key": credentials.apiKey,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `AgentPact webhook request failed (${response.status}): ${JSON.stringify(body)}`,
    );
  }
  return body;
}

const existing = await request("/api/webhooks");
let webhook = Array.isArray(existing)
  ? existing.find((item) => item.url === publicUrl && item.active !== false)
  : null;

if (!webhook) {
  webhook = await request("/api/webhooks", {
    method: "POST",
    body: JSON.stringify({ url: publicUrl, events, secret: config.secret }),
  });
}

const configuredEvents = webhook.events ?? webhook.event_types ?? [];
console.log(
  JSON.stringify(
    {
      registered: true,
      id: webhook.id ?? null,
      url: webhook.url ?? publicUrl,
      active: webhook.active ?? true,
      events: configuredEvents,
      secretStoredLocally: true,
    },
    null,
    2,
  ),
);
