import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the hundred-dollar wallet goal", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>The \$100 Wallet Goal/);
  assert.match(html, /合计达到 <em>\$100<\/em>/);
  assert.match(html, /\/ \$100\.00/);
  assert.match(html, /<span>100<\/span> \/ HUNDRED/);
  assert.match(html, /o9mfxQnHja71MNvU81gdx4VtFaYRGxGFLKDjPJKiPYt/);
  assert.match(html, /0x4244f335c42ebd82dbd1378a9cb192f582d9ad18/);
  assert.doesNotMatch(html, /ETHEREUM/);
  assert.match(html, /TVa6sSVC4B8fKq3S8qDLKQSaYRvhkPgRBk/);
  assert.doesNotMatch(
    html,
    /合计达到 <em>\$10<\/em>|\/ \$10\.00|<span>10<\/span> \/ TEN/,
  );
});

test("keeps the hundred-dollar target and four chains consistent", async () => {
  const [page, layout, progressRoute, updater, publicMetadata, docsMetadata] =
    await Promise.all([
      readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../app/api/progress/route.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../scripts/update-static-progress.mjs", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../public/ai-donation.json", import.meta.url), "utf8"),
      readFile(new URL("../docs/ai-donation.json", import.meta.url), "utf8"),
    ]);

  assert.match(page, /const GOAL_USD = 100;/);
  assert.match(layout, /The \$100 Wallet Goal/);
  assert.match(progressRoute, /const GOAL_USD = 100;/);
  assert.match(updater, /const GOAL_USD = 100;/);
  assert.equal(JSON.parse(publicMetadata).goal_usd, 100);
  assert.equal(JSON.parse(docsMetadata).goal_usd, 100);
  for (const metadata of [
    JSON.parse(publicMetadata),
    JSON.parse(docsMetadata),
  ]) {
    assert.equal(metadata.routes.length, 4);
    assert.equal(
      metadata.routes.some((route) => route.network === "ethereum-mainnet"),
      false,
    );
  }
  assert.doesNotMatch(progressRoute, /ethereumEthBalance|ETHEREUM_RPC_URLS/);
  assert.doesNotMatch(updater, /ethereumEth|ETHEREUM_RPC_URLS/);

  for (const source of [
    page,
    layout,
    progressRoute,
    updater,
    publicMetadata,
    docsMetadata,
  ]) {
    assert.doesNotMatch(
      source,
      /GOAL_USD\s*=\s*10;|"goal_usd"\s*:\s*10(?:\D|$)/,
    );
  }
});
