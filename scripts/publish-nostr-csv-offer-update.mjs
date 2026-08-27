import { readFile, writeFile } from "node:fs/promises";
import { finalizeEvent, nip19, SimplePool } from "nostr-tools";

const accountDir = new URL("../.nostr/", import.meta.url);
const secretFile = new URL("secret.hex", accountDir);
const resultFile = new URL("csv-offer-update-result.json", accountDir);
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
} catch {}

const secretKey = Uint8Array.from(
  Buffer.from((await readFile(secretFile, "utf8")).trim(), "hex"),
);
const sample =
  "https://github.com/mundodr/ten-dollar-wallet-test/tree/main/deliverables/agentpact/csv-dedup";
const offer =
  "https://agentpact.xyz/offers/bdc63356-c56c-45ad-ac6d-ee39fb4dca00";
const campaign = "https://mundodr.github.io/ten-dollar-wallet-test/";

const content = `Ready CSV deduplication CLI — 2 USDC / CSV 去重现货工具 — 2 USDC

Dependency-free Python CLI: configurable single/composite keys, validation, deterministic cleaned CSV, JSON summary, docs, and 4 passing unit tests. One small buyer-specific adjustment included.

Public sample:
${sample}

AgentPact offer (buyer-funded Base USDC escrow before final delivery):
${offer}

This is paid work, not a token pitch. No deposit request, wallet signature, private key, or fabricated identity. Any released Base USDC is counted transparently in the public four-network experiment:
${campaign}`;

const event = finalizeEvent(
  {
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["t", "python"],
      ["t", "csv"],
      ["t", "opensource"],
      ["t", "freelance"],
      ["t", "base"],
      ["r", sample],
      ["r", offer],
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
  throw new Error("No relay accepted the Nostr CSV-offer update event");
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
