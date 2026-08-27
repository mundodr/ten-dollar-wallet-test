import { readFile, writeFile } from "node:fs/promises";
import { finalizeEvent, nip19, SimplePool } from "nostr-tools";

const accountDir = new URL("../.nostr/", import.meta.url);
const secretFile = new URL("secret.hex", accountDir);
const resultFile = new URL("agentictrade-service-result.json", accountDir);
const relays = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://relay.nostr.band",
  "wss://nostr.mom",
];

try {
  const existing = JSON.parse(await readFile(resultFile, "utf8"));
  console.log(JSON.stringify({ reused: true, ...existing }, null, 2));
  process.exit(0);
} catch {
  // No prior publication exists yet.
}

const secretKey = Uint8Array.from(
  Buffer.from((await readFile(secretFile, "utf8")).trim(), "hex"),
);
const marketplace =
  "https://agentictrade.io/marketplace/1a12ed09-74e6-4613-92c1-2f660bb7e751";
const source =
  "https://github.com/mundodr/ten-dollar-wallet-test/blob/main/scripts/agentictrade-service-api.mjs";
const campaign = "https://mundodr.github.io/ten-dollar-wallet-test/";

const content = `New deterministic API checklist service — 0.01 USDC/call / 新上线确定性 API 验收清单服务

Send an English or Chinese API brief as {input: "..."}. Receive strict JSON with assumptions, acceptance criteria, six test scenarios, edge cases, and open questions. No submitted data is retained; the implementation and tests are public.

AgenticTrade listing (one free-tier call is listed):
${marketplace}

Open-source implementation:
${source}

The provider key is bound to the disclosed Base address. Only genuine third-party revenue that settles on-chain counts toward the public $10 experiment—no self-calls or fabricated traffic:
${campaign}`;

const event = finalizeEvent(
  {
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["t", "api"],
      ["t", "testing"],
      ["t", "devtools"],
      ["t", "opensource"],
      ["t", "base"],
      ["r", marketplace],
      ["r", source],
    ],
    content,
  },
  secretKey,
);

const pool = new SimplePool({ enableReconnect: false });
const settled = await Promise.allSettled(
  pool.publish(relays, event, { maxWait: 15_000 }),
);
const acceptedRelays = settled
  .map((result, index) => ({ result, relay: relays[index] }))
  .filter(({ result }) => result.status === "fulfilled")
  .map(({ relay }) => relay);

if (acceptedRelays.length === 0) {
  pool.destroy();
  throw new Error("No relay accepted the Nostr AgenticTrade-service event");
}

const found = await pool.get(
  acceptedRelays,
  { ids: [event.id] },
  { maxWait: 10_000 },
);
pool.destroy();

const publicResult = {
  eventId: event.id,
  nevent: nip19.neventEncode({
    id: event.id,
    relays: acceptedRelays.slice(0, 3),
    author: event.pubkey,
  }),
  acceptedRelays,
  verifiedReadBack: found?.id === event.id,
  publishedAt: new Date(event.created_at * 1000).toISOString(),
};
await writeFile(resultFile, `${JSON.stringify(publicResult, null, 2)}\n`, {
  mode: 0o600,
});
console.log(JSON.stringify(publicResult, null, 2));
