const profileUrl = "https://medium.com/@ten-dollar-wallet-lab";
const feedUrl = "https://medium.com/feed/@ten-dollar-wallet-lab";
const publicProfileMirrorUrl =
  "https://r.jina.ai/http://medium.com/@ten-dollar-wallet-lab";
const knownNextPublishAttemptAfter = "2026-08-28T19:02:00.000Z";
const expectedTitles = [
  "A Stable JSON Shape Is Part of an API Contract",
  "Fail-Soft Fetching Without Hiding the Failure",
  "A Platform Balance Is Not a Payment Receipt",
  "From One OpenAPI File to a Searchable Static Docs Site",
];

async function fetchText(url, accept) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: accept,
          "User-Agent": "ten-dollar-wallet-monitor/1.0",
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        throw new Error(`${url} returned HTTP ${response.status}`);
      }
      return response.text();
    } catch (error) {
      lastError = error;
    }
    if (attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError ?? new Error(`${url} returned no response`);
}

function cdata(value) {
  return value?.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim() ?? null;
}

const xml = await fetchText(
  feedUrl,
  "application/rss+xml, application/xml;q=0.9, */*;q=0.1",
);
const profileTitle = cdata(xml.match(/<channel>[\s\S]*?<title>([\s\S]*?)<\/title>/)?.[1]);
const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => match[1]);
const rssStories = itemBlocks.map((item) => ({
  title: cdata(item.match(/<title>([\s\S]*?)<\/title>/)?.[1]),
  link: item.match(/<link>([^<]+)<\/link>/)?.[1]?.trim() ?? null,
  publishedAt: item.match(/<pubDate>([^<]+)<\/pubDate>/)?.[1]?.trim() ?? null,
  verifiedBy: "medium-rss",
}));

if (profileTitle !== "Stories by Ten Dollar Wallet Lab on Medium") {
  throw new Error(`Medium profile identity changed: ${profileTitle ?? "missing"}`);
}

let profileMirror = null;
let profileMirrorError = null;
try {
  profileMirror = await fetchText(publicProfileMirrorUrl, "text/markdown, text/plain");
} catch (error) {
  profileMirrorError = error instanceof Error ? error.message : String(error);
}

function normalizePublicUrl(url) {
  return url?.replace(/^http:/, "https:").split("?")[0] ?? null;
}

const profileLinks = profileMirror
  ? [...profileMirror.matchAll(/\[([^\]]+)\]\((https?:\/\/medium\.com\/@ten-dollar-wallet-lab\/[^)\s?]+)[^)]*\)/g)].map(
      (match) => ({
        label: match[1],
        link: normalizePublicUrl(match[2]),
      }),
    )
  : [];

const expectedTitleStates = expectedTitles.map((title) => {
  const rssStory = rssStories.find((story) => story.title === title);
  const profileStory = profileLinks.find((story) => story.label.includes(title));
  return {
    title,
    published: Boolean(rssStory || profileStory),
    link: normalizePublicUrl(rssStory?.link) ?? profileStory?.link ?? null,
    verifiedBy: rssStory ? "medium-rss" : profileStory ? "public-profile" : null,
  };
});

const priorPostsPublished = expectedTitleStates.slice(0, 3).filter((story) => story.published)
  .length;

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      profileUrl,
      feedUrl,
      publicProfileMirrorUrl,
      profileTitle,
      rssPublishedCount: rssStories.length,
      rssStories,
      profileMirrorAvailable: profileMirror !== null,
      profileMirrorError,
      priorPostsPublished,
      expectedTitles: expectedTitleStates,
      bounty127PublishingReady:
        priorPostsPublished === 3 && !expectedTitleStates[3].published,
      knownNextPublishAttemptAfter,
      rateLimitNote:
        "Medium reported a maximum of two published or scheduled stories in 24 hours. The third prior post remains a saved draft until the timestamp above.",
      countingPolicy:
        "A public article and Frantic delivery are work evidence only. Only a verified mainnet payout to a disclosed target wallet counts as funds.",
    },
    null,
    2,
  ),
);
