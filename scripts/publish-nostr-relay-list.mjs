import { readFile, writeFile } from "node:fs/promises";
import { finalizeEvent, getPublicKey, SimplePool } from "nostr-tools";

const accountDir = new URL("../.nostr/", import.meta.url);
const resultFile = new URL("relay-list-result.json", accountDir);
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
const event = finalizeEvent({
  kind: 10002,
  created_at: Math.floor(Date.now() / 1000),
  tags: relays.map(relay => ["r", relay]),
  content: "",
}, secretKey);

const pool = new SimplePool({ enableReconnect: false });
const settled = await Promise.allSettled(pool.publish(relays, event, { maxWait: 15_000 }));
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

const found = await pool.get(acceptedRelays, { kinds: [10002], authors: [pubkey] }, { maxWait: 10_000 });
pool.destroy();
const publicResult = {
  eventId: event.id,
  acceptedRelays,
  verifiedReadBack: found?.id === event.id,
  publishedAt: new Date(event.created_at * 1000).toISOString(),
};
await writeFile(resultFile, `${JSON.stringify(publicResult, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(publicResult, null, 2));
