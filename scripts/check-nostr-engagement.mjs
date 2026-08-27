import { readFile } from "node:fs/promises";
import { SimplePool } from "nostr-tools";

const accountDir = new URL("../.nostr/", import.meta.url);
const short = JSON.parse(await readFile(new URL("publish-result.json", accountDir), "utf8"));
const article = JSON.parse(await readFile(new URL("article-result.json", accountDir), "utf8"));
const introduction = JSON.parse(await readFile(new URL("introduction-result.json", accountDir), "utf8"));
let workOffer = null;
try {
  workOffer = JSON.parse(await readFile(new URL("work-offer-result.json", accountDir), "utf8"));
} catch {
  // This publication is optional.
}
let networkUpdate = null;
try {
  networkUpdate = JSON.parse(await readFile(new URL("network-update-result.json", accountDir), "utf8"));
} catch {
  // This publication is optional.
}
let csvOfferUpdate = null;
try {
  csvOfferUpdate = JSON.parse(await readFile(new URL("csv-offer-update-result.json", accountDir), "utf8"));
} catch {
  // This publication is optional.
}
let agentictradeService = null;
try {
  agentictradeService = JSON.parse(await readFile(new URL("agentictrade-service-result.json", accountDir), "utf8"));
} catch {
  // This publication is optional.
}
const relays = [...new Set([
  ...short.acceptedRelays,
  ...article.acceptedRelays,
  ...introduction.acceptedRelays,
  ...(workOffer?.acceptedRelays ?? []),
  ...(networkUpdate?.acceptedRelays ?? []),
  ...(csvOfferUpdate?.acceptedRelays ?? []),
  ...(agentictradeService?.acceptedRelays ?? []),
])];
const articleAddress = `30023:${short.pubkey}:ten-dollar-wallet-test`;
const pool = new SimplePool({ enableReconnect: false });

const [shortEvents, articleEvents, introductionEvents, workOfferEvents, networkUpdateEvents, csvOfferUpdateEvents, agentictradeServiceEvents, followers] = await Promise.all([
  pool.querySync(relays, { kinds: [1, 6, 7, 9735], "#e": [short.eventId] }, { maxWait: 10_000 }),
  pool.querySync(relays, { kinds: [1, 6, 7, 9735], "#a": [articleAddress] }, { maxWait: 10_000 }),
  pool.querySync(relays, { kinds: [1, 6, 7, 9735], "#e": [introduction.eventId] }, { maxWait: 10_000 }),
  workOffer
    ? pool.querySync(relays, { kinds: [1, 6, 7, 9735], "#e": [workOffer.eventId] }, { maxWait: 10_000 })
    : [],
  networkUpdate
    ? pool.querySync(relays, { kinds: [1, 6, 7, 9735], "#e": [networkUpdate.eventId] }, { maxWait: 10_000 })
    : [],
  csvOfferUpdate
    ? pool.querySync(relays, { kinds: [1, 6, 7, 9735], "#e": [csvOfferUpdate.eventId] }, { maxWait: 10_000 })
    : [],
  agentictradeService
    ? pool.querySync(relays, { kinds: [1, 6, 7, 9735], "#e": [agentictradeService.eventId] }, { maxWait: 10_000 })
    : [],
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
  introductionPost: summarize(introductionEvents),
  workOfferPost: summarize(workOfferEvents),
  networkUpdatePost: summarize(networkUpdateEvents),
  csvOfferUpdatePost: summarize(csvOfferUpdateEvents),
  agentictradeServicePost: summarize(agentictradeServiceEvents),
  followerEvents: followers.length,
}, null, 2));
