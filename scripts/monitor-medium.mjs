const profileUrl = "https://medium.com/@ten-dollar-wallet-lab";
const feedUrl = "https://medium.com/feed/@ten-dollar-wallet-lab";
const expectedTitles = [
  "A Stable JSON Shape Is Part of an API Contract",
  "Fail-Soft Fetching Without Hiding the Failure",
  "A Platform Balance Is Not a Payment Receipt",
  "From One OpenAPI File to a Searchable Static Docs Site",
];

async function fetchFeed() {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(feedUrl, {
        headers: {
          Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.1",
          "User-Agent": "ten-dollar-wallet-monitor/1.0",
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Medium RSS returned HTTP ${response.status}`);
      return response.text();
    } catch (error) {
      lastError = error;
    }
    if (attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError ?? new Error("Medium RSS returned no response");
}

function cdata(value) {
  return value?.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim() ?? null;
}

const xml = await fetchFeed();
const profileTitle = cdata(xml.match(/<channel>[\s\S]*?<title>([\s\S]*?)<\/title>/)?.[1]);
const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => match[1]);
const stories = itemBlocks.map((item) => ({
  title: cdata(item.match(/<title>([\s\S]*?)<\/title>/)?.[1]),
  link: item.match(/<link>([^<]+)<\/link>/)?.[1]?.trim() ?? null,
  publishedAt: item.match(/<pubDate>([^<]+)<\/pubDate>/)?.[1]?.trim() ?? null,
}));

if (profileTitle !== "Stories by Ten Dollar Wallet Lab on Medium") {
  throw new Error(`Medium profile identity changed: ${profileTitle ?? "missing"}`);
}

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      profileUrl,
      feedUrl,
      profileTitle,
      publishedCount: stories.length,
      stories,
      expectedTitles: expectedTitles.map((title) => ({
        title,
        published: stories.some((story) => story.title === title),
      })),
      bounty127PublishingReady:
        expectedTitles.slice(0, 3).every((title) =>
          stories.some((story) => story.title === title),
        ) && !stories.some((story) => story.title === expectedTitles[3]),
      countingPolicy:
        "A public article and Frantic delivery are work evidence only. Only a verified mainnet payout to a disclosed target wallet counts as funds.",
    },
    null,
    2,
  ),
);
