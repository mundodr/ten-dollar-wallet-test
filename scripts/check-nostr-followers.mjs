import { readFile } from "node:fs/promises";
import { SimplePool } from "nostr-tools";

const accountDir = new URL("../.nostr/", import.meta.url);
const campaign = JSON.parse(await readFile(new URL("publish-result.json", accountDir), "utf8"));
const relays = campaign.acceptedRelays;
const pool = new SimplePool({ enableReconnect: false });
const contacts = await pool.querySync(
  relays,
  { kinds: [3], "#p": [campaign.pubkey], limit: 50 },
  { maxWait: 10_000 },
);
const authors = [...new Set(contacts.map(event => event.pubkey))];
const profiles = authors.length
  ? await pool.querySync(relays, { kinds: [0], authors, limit: authors.length * 3 }, { maxWait: 10_000 })
  : [];
pool.destroy();

const latestProfiles = new Map();
for (const profile of profiles.sort((a, b) => b.created_at - a.created_at)) {
  if (latestProfiles.has(profile.pubkey)) continue;
  try { latestProfiles.set(profile.pubkey, JSON.parse(profile.content)); } catch {}
}

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  followers: authors.map(pubkey => ({
    pubkey,
    name: latestProfiles.get(pubkey)?.display_name || latestProfiles.get(pubkey)?.name || null,
    about: latestProfiles.get(pubkey)?.about?.slice(0, 300) || null,
    website: latestProfiles.get(pubkey)?.website || null,
  })),
}, null, 2));
