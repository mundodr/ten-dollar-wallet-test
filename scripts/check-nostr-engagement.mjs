import { readFile } from "node:fs/promises";
import { SimplePool } from "nostr-tools";

const accountDir = new URL("../.nostr/", import.meta.url);
const short = JSON.parse(await readFile(new URL("publish-result.json", accountDir), "utf8"));
const article = JSON.parse(await readFile(new URL("article-result.json", accountDir), "utf8"));
const relays = [...new Set([...short.acceptedRelays, ...article.acceptedRelays])];
const articleAddress = `30023:${short.pubkey}:ten-dollar-wallet-test`;
const pool = new SimplePool({ enableReconnect: false });

const [shortEvents, articleEvents, followers] = await Promise.all([
  pool.querySync(relays, { kinds: [1, 6, 7, 9735], "#e": [short.eventId] }, { maxWait: 10_000 }),
  pool.querySync(relays, { kinds: [1, 6, 7, 9735], "#a": [articleAddress] }, { maxWait: 10_000 }),
  pool.querySync(relays, { kinds: [3], "#p": [short.pubkey] }, { maxWait: 10_000 }),
]);
pool.destroy();

function summarize(events) {
  return {
    replies: events.filter(event => event.kind === 1).length,
    reposts: events.filter(event => event.kind === 6).length,
    reactions: events.filter(event => event.kind === 7).length,
    zapReceipts: events.filter(event => event.kind === 9735).length,
  };
}

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  shortPost: summarize(shortEvents),
  longFormArticle: summarize(articleEvents),
  followerEvents: followers.length,
}, null, 2));
