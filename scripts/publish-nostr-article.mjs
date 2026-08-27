import { readFile, writeFile } from "node:fs/promises";
import { finalizeEvent, getPublicKey, nip19, SimplePool } from "nostr-tools";

const accountDir = new URL("../.nostr/", import.meta.url);
const resultFile = new URL("article-result.json", accountDir);
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
const identifier = "ten-dollar-wallet-test";
const page = "https://mundodr.github.io/ten-dollar-wallet-test/";
const image = "https://mundodr.github.io/ten-dollar-wallet-test/og.png";

const content = `# The $10 Wallet Test / 十美元钱包实验

Can small acts of internet generosity take two publicly verifiable, empty crypto wallets to a combined **$10**?

陌生人的微小善意，能否让两个公开可核验、余额为零的钱包合计达到 **10 美元**？

## What this is / 这是什么

This is a deliberately small and honest public experiment created by a person and an AI. There is no hardship story, charity status, token sale, raffle, product, or promised return. A contribution is simply a voluntary personal gift.

这是一个由一个人与 AI 共同发起的小型公开实验。我们不编造困难，不冒充慈善机构，不销售代币，不抽奖，也不承诺任何回报。任何转账都只是自愿的个人赠与。

## Public starting point / 公开起点

At the verified starting snapshot on 2026-08-27:

- Solana native balance: **0 SOL**
- Solana USDC balance: **0 USDC**
- BNB Smart Chain native balance: **0 BNB**

Both addresses link to public block explorers. The campaign page shows QR codes and an automatically refreshed balance snapshot:

${page}

## How to participate / 如何参与

**Solana — SOL or USDC (SPL), Solana network only**

\`\`\`
o9mfxQnHja71MNvU81gdx4VtFaYRGxGFLKDjPJKiPYt
\`\`\`

**BNB Smart Chain — BNB, USDT, or USDC, BEP-20 network only**

\`\`\`
0x4244f335c42ebd82dbd1378a9cb192f582d9ad18
\`\`\`

Any amount counts, even less than one dollar. Please check the network and address twice before sending because on-chain transfers are generally irreversible.

任何金额都有帮助，即使不足一美元。链上转账通常无法撤回，请在发送前再次核对网络和地址。

## Transparency / 透明原则

- No private key or seed phrase is ever requested.
- No claim that a contribution is tax-deductible.
- No reward, service, or financial return is offered.
- Block explorers remain the authoritative record.

If the experiment makes you smile, you can help move the public counter by a tiny amount—or simply share the page.`;

const article = finalizeEvent({
  kind: 30023,
  created_at: now,
  tags: [
    ["d", identifier],
    ["title", "The $10 Wallet Test / 十美元钱包实验"],
    ["summary", "Can tiny internet gifts take two empty, publicly verifiable crypto wallets to a combined $10?"],
    ["image", image, "1672x941"],
    ["published_at", String(now)],
    ["t", "solana"],
    ["t", "bnbchain"],
    ["t", "cryptodonation"],
    ["t", "transparency"],
    ["t", "experiment"],
  ],
  content,
}, secretKey);

const pool = new SimplePool({ enableReconnect: false });
const settled = await Promise.allSettled(pool.publish(relays, article, { maxWait: 15_000 }));
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

const found = await pool.get(
  acceptedRelays,
  { kinds: [30023], authors: [pubkey], "#d": [identifier] },
  { maxWait: 10_000 },
);
pool.destroy();

const naddr = nip19.naddrEncode({ identifier, pubkey, kind: 30023, relays: acceptedRelays.slice(0, 3) });
const publicResult = {
  naddr,
  eventId: article.id,
  acceptedRelays,
  verifiedReadBack: found?.id === article.id,
  publishedAt: new Date(now * 1000).toISOString(),
};
await writeFile(resultFile, `${JSON.stringify(publicResult, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(publicResult, null, 2));
