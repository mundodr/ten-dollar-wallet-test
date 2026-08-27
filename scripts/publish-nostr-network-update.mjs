import { readFile, writeFile } from "node:fs/promises";
import { finalizeEvent, nip19, SimplePool } from "nostr-tools";

const accountDir = new URL("../.nostr/", import.meta.url);
const secretFile = new URL("secret.hex", accountDir);
const resultFile = new URL("network-update-result.json", accountDir);
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
const now = Math.floor(Date.now() / 1000);

const profile = finalizeEvent(
  {
    kind: 0,
    created_at: now,
    tags: [],
    content: JSON.stringify({
      name: "ten-dollar-wallet-test",
      display_name: "The $10 Wallet Test",
      about:
        "A transparent, verifiable experiment across Solana, BNB Smart Chain, Base, and TRON. Not a charity, token sale, or investment.",
      website: page,
      picture: `${page}og.png`,
    }),
  },
  secretKey,
);

const content = `Network update / 网络更新

The $10 Wallet Test now counts verified deposits across four declared networks: Solana, BNB Smart Chain, Base, and TRON. Base USDC earnings from the public AgentPact work offer now count.

Base (ETH / USDC):
0x4244f335c42ebd82dbd1378a9cb192f582d9ad18

TRON (TRX / USDT TRC-20):
TVa6sSVC4B8fKq3S8qDLKQSaYRvhkPgRBk

All four starting balances were checked as zero. Choose the named network carefully; transfers are generally irreversible.

Live page, QR codes, and explorer links:
${page}`;

const note = finalizeEvent(
  {
    kind: 1,
    created_at: now + 1,
    tags: [
      ["t", "solana"],
      ["t", "bnbchain"],
      ["t", "base"],
      ["t", "tron"],
      ["t", "opensource"],
      ["r", page],
    ],
    content,
  },
  secretKey,
);

const pool = new SimplePool({ enableReconnect: false });

async function publish(event) {
  const settled = await Promise.allSettled(
    pool.publish(relays, event, { maxWait: 15_000 }),
  );
  return settled
    .map((result, index) => ({ result, relay: relays[index] }))
    .filter(({ result }) => result.status === "fulfilled")
    .map(({ relay }) => relay);
}

await publish(profile);
const acceptedRelays = await publish(note);
if (acceptedRelays.length === 0) {
  pool.destroy();
  throw new Error("No relay accepted the Nostr network-update event");
}

const found = await pool.get(
  acceptedRelays,
  { ids: [note.id] },
  { maxWait: 10_000 },
);
pool.destroy();

const publicResult = {
  eventId: note.id,
  nevent: nip19.neventEncode({
    id: note.id,
    relays: acceptedRelays.slice(0, 3),
    author: note.pubkey,
  }),
  acceptedRelays,
  verifiedReadBack: found?.id === note.id,
  publishedAt: new Date(note.created_at * 1000).toISOString(),
};
await writeFile(resultFile, `${JSON.stringify(publicResult, null, 2)}\n`, {
  mode: 0o600,
});
console.log(JSON.stringify(publicResult, null, 2));
