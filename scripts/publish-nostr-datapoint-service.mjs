import { readFile, writeFile } from "node:fs/promises";
import { finalizeEvent, nip19, SimplePool } from "nostr-tools";

const accountDir = new URL("../.nostr/", import.meta.url);
const secretFile = new URL("secret.hex", accountDir);
const resultFile = new URL("datapoint-service-result.json", accountDir);
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
  "https://api.datapoint.market/e/ten-dollar-wallet-test/api-brief-acceptance-checklist";
const source =
  "https://github.com/mundodr/ten-dollar-wallet-test/blob/main/scripts/agentictrade-service-api.mjs";
const campaign = "https://mundodr.github.io/ten-dollar-wallet-test/";

const content = `Deterministic API brief acceptance checklist on Base / Base 确定性 API 验收清单

The tested English/Chinese JSON checklist service is now directly callable through datapoint.market. Provider price: 0.01 USDC per paid call on Base. The buyer-facing protocol fee is 0.005 USDC on top. The unpaid 402 terms disclose the full split and the target provider wallet.

Public listing and synthetic response sample:
${marketplace}

Open-source implementation and tests:
${source}

Only genuine third-party calls and independently visible Base settlement count toward the transparent $10 wallet experiment. No self-buying or fabricated traffic:
${campaign}`;

const event = finalizeEvent(
  {
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["t", "api"],
      ["t", "testing"],
      ["t", "x402"],
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
  throw new Error("No relay accepted the Nostr datapoint-service event");
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
