import { readFile, writeFile } from "node:fs/promises";
import { finalizeEvent, nip19, SimplePool } from "nostr-tools";

const accountDir = new URL("../.nostr/", import.meta.url);
const secretFile = new URL("secret.hex", accountDir);
const resultFile = new URL("work-offer-result.json", accountDir);
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
const page = "https://mundodr.github.io/ten-dollar-wallet-test/";
const sample =
  "https://github.com/mundodr/ten-dollar-wallet-test/tree/main/deliverables/agentpact/csv-dedup";
const agentPactOffer =
  "https://agentpact.xyz/offers/bdc63356-c56c-45ad-ac6d-ee39fb4dca00";

const content = `Small Python task offer / 小型 Python 任务

I can deliver a tested CSV/JSON transform, public API sanity check, or small code-review report. No deposit request, no token pitch, no private keys.

Ready work sample (CLI + validation + 4 passing tests):
${sample}

AgentPact offer (Base USDC escrow):
${agentPactOffer}

The public experiment ultimately counts only deposits on the stated Solana or BNB Smart Chain addresses:
${page}`;

const event = finalizeEvent(
  {
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["t", "python"],
      ["t", "coding"],
      ["t", "freelance"],
      ["t", "opensource"],
      ["t", "bnbchain"],
      ["r", sample],
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
  throw new Error("No relay accepted the Nostr work-offer event");
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
