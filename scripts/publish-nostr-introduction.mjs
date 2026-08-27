import { readFile, writeFile } from "node:fs/promises";
import { finalizeEvent, getPublicKey, nip19, SimplePool } from "nostr-tools";

const accountDir = new URL("../.nostr/", import.meta.url);
const resultFile = new URL("introduction-result.json", accountDir);
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

const secretKey = Uint8Array.from(Buffer.from((await readFile(new URL("secret.hex", accountDir), "utf8")).trim(), "hex"));
const pubkey = getPublicKey(secretKey);
const now = Math.floor(Date.now() / 1000);
const page = "https://mundodr.github.io/ten-dollar-wallet-test/";
const content = `Hello Nostr / 大家好 👋

This account documents The $10 Wallet Test: can tiny internet gifts take two publicly verifiable wallets from $0 to a combined $10?

No hardship story, charity claim, token sale, raffle, or promised return—just a small, honest experiment with public block-explorer proof.

${page}

If transparent internet experiments are your thing, a repost is as helpful as a tiny contribution.

这是一个从零余额开始、全部可在链上核验的十美元实验。欢迎转发；即使不捐赠，也能帮助更多人看到。`;

const introduction = finalizeEvent({
  kind: 1,
  created_at: now,
  tags: [
    ["t", "introductions"],
    ["t", "grownostr"],
    ["t", "solana"],
    ["t", "bnbchain"],
    ["t", "experiment"],
  ],
  content,
}, secretKey);

const pool = new SimplePool({ enableReconnect: false });
const settled = await Promise.allSettled(pool.publish(relays, introduction, { maxWait: 15_000 }));
const results = settled.map((result, index) => ({
  relay: relays[index],
  accepted: result.status === "fulfilled",
  message: result.status === "fulfilled" ? result.value : String(result.reason),
}));
const acceptedRelays = results.filter(result => result.accepted).map(result => result.relay);
if (acceptedRelays.length === 0) {
  pool.destroy();
  console.error(JSON.stringify(results, null, 2));
  process.exit(2);
}

const found = await pool.get(acceptedRelays, { ids: [introduction.id] }, { maxWait: 10_000 });
pool.destroy();

const publicResult = {
  eventId: introduction.id,
  nevent: nip19.neventEncode({ id: introduction.id, relays: acceptedRelays.slice(0, 3), author: pubkey }),
  acceptedRelays,
  verifiedReadBack: found?.id === introduction.id,
  publishedAt: new Date(now * 1000).toISOString(),
};
await writeFile(resultFile, `${JSON.stringify(publicResult, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(publicResult, null, 2));
