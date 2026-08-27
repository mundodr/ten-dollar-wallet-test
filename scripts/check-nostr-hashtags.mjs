import { SimplePool } from "nostr-tools";

const relays = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://nostr.mom",
];
const tags = ["introductions", "plebchain", "grownostr", "solana"];
const since = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
const pool = new SimplePool({ enableReconnect: false });

const results = {};
for (const tag of tags) {
  const events = await pool.querySync(
    relays,
    { kinds: [1], "#t": [tag], since, limit: 50 },
    { maxWait: 10_000 },
  );
  results[tag] = {
    recentCount: events.length,
    samples: events.slice(0, 3).map(event => event.content.replace(/\s+/g, " ").slice(0, 180)),
  };
}
pool.destroy();

console.log(JSON.stringify({ checkedAt: new Date().toISOString(), windowDays: 7, results }, null, 2));
