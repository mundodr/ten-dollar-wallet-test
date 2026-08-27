import { mkdir, readFile, writeFile } from "node:fs/promises";
import { finalizeEvent, generateSecretKey, getPublicKey, nip19, SimplePool } from "nostr-tools";

const accountDir = new URL("../.nostr/", import.meta.url);
const secretFile = new URL("secret.hex", accountDir);
const resultFile = new URL("publish-result.json", accountDir);
const relays = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://relay.nostr.band",
  "wss://nostr.mom",
];

await mkdir(accountDir, { recursive: true, mode: 0o700 });

try {
  const existing = JSON.parse(await readFile(resultFile, "utf8"));
  console.log(JSON.stringify({ reused: true, ...existing }, null, 2));
  process.exit(0);
} catch {}

let secretKey;
try {
  secretKey = Uint8Array.from(Buffer.from((await readFile(secretFile, "utf8")).trim(), "hex"));
} catch {
  secretKey = generateSecretKey();
  await writeFile(secretFile, Buffer.from(secretKey).toString("hex"), { flag: "wx", mode: 0o600 });
}

const pubkey = getPublicKey(secretKey);
const npub = nip19.npubEncode(pubkey);
const now = Math.floor(Date.now() / 1000);
const page = "https://mundodr.github.io/ten-dollar-wallet-test/";
const profile = finalizeEvent({
  kind: 0,
  created_at: now,
  tags: [],
  content: JSON.stringify({
    name: "ten-dollar-wallet-test",
    display_name: "The $10 Wallet Test",
    about: "A transparent, verifiable experiment: can tiny internet gifts take two empty crypto wallets to a combined $10? Not a charity or investment.",
    website: page,
    picture: "https://mundodr.github.io/ten-dollar-wallet-test/og.png",
  }),
}, secretKey);

const content = `The $10 Wallet Test / 十美元钱包实验

Two empty wallets. One honest question: can tiny gifts from the internet reach $10 total?

Not a charity or hardship claim. No token sale, raffle, or returns.

Public page + QR codes + on-chain proof:
${page}

SOL (Solana):
o9mfxQnHja71MNvU81gdx4VtFaYRGxGFLKDjPJKiPYt

BNB / BEP-20:
0x4244f335c42ebd82dbd1378a9cb192f582d9ad18

Any amount—even less than $1—counts. Please verify the network and address before sending.`;

const note = finalizeEvent({
  kind: 1,
  created_at: now + 1,
  tags: [["t", "solana"], ["t", "bnbchain"], ["t", "cryptodonation"], ["t", "experiment"]],
  content,
}, secretKey);

const pool = new SimplePool({ enableReconnect: false });

async function publish(event) {
  const settled = await Promise.allSettled(pool.publish(relays, event, { maxWait: 15_000 }));
  return settled.map((result, index) => ({
    relay: relays[index],
    accepted: result.status === "fulfilled",
    message: result.status === "fulfilled" ? result.value : String(result.reason),
  }));
}

const profileResults = await publish(profile);
const noteResults = await publish(note);
const acceptedRelays = noteResults.filter(result => result.accepted).map(result => result.relay);
if (acceptedRelays.length === 0) {
  pool.destroy();
  console.error(JSON.stringify({ profileResults, noteResults }, null, 2));
  process.exit(2);
}

const found = await pool.get(acceptedRelays, { ids: [note.id] }, { maxWait: 10_000 });
pool.destroy();

const publicResult = {
  npub,
  pubkey,
  eventId: note.id,
  nevent: nip19.neventEncode({ id: note.id, relays: acceptedRelays.slice(0, 3), author: pubkey }),
  acceptedRelays,
  verifiedReadBack: found?.id === note.id,
  publishedAt: new Date((now + 1) * 1000).toISOString(),
};
await writeFile(resultFile, `${JSON.stringify(publicResult, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(publicResult, null, 2));
