#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_BASE_URL = "https://payanagent.com";
const DEFAULT_LIMIT = 100;
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_PROBE_DELAY_MS = 2_150;
const DEFAULT_CONCURRENCY = 6;

function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    limit: DEFAULT_LIMIT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    probeDelayMs: DEFAULT_PROBE_DELAY_MS,
    concurrency: DEFAULT_CONCURRENCY,
    outputDir: path.resolve("report"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--base-url") options.baseUrl = value;
    else if (flag === "--limit") options.limit = Number(value);
    else if (flag === "--timeout-ms") options.timeoutMs = Number(value);
    else if (flag === "--probe-delay-ms") options.probeDelayMs = Number(value);
    else if (flag === "--concurrency") options.concurrency = Number(value);
    else if (flag === "--output-dir") options.outputDir = path.resolve(value);
    else if (flag === "--help") {
      console.log(
        "Usage: node catalog-health-checker.mjs [--limit 100] [--output-dir report] " +
          "[--timeout-ms 8000] [--probe-delay-ms 2150] [--concurrency 6]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete argument: ${flag}`);
    }
    index += 1;
  }

  for (const [name, value] of [
    ["limit", options.limit],
    ["timeout-ms", options.timeoutMs],
    ["probe-delay-ms", options.probeDelayMs],
    ["concurrency", options.concurrency],
  ]) {
    if (!Number.isInteger(value) || value < (name === "probe-delay-ms" ? 0 : 1)) {
      throw new Error(`${name} must be a valid integer`);
    }
  }

  options.baseUrl = new URL(options.baseUrl).origin;
  return options;
}

function wait(milliseconds) {
  return milliseconds > 0
    ? new Promise((resolve) => setTimeout(resolve, milliseconds))
    : Promise.resolve();
}

async function fetchCatalog({ baseUrl, limit }) {
  const offers = [];
  let cursor;

  while (offers.length < limit) {
    const url = new URL("/api/v1/offers", baseUrl);
    url.searchParams.set("sort", "top");
    url.searchParams.set("limit", String(Math.min(100, limit - offers.length)));
    if (cursor) url.searchParams.set("cursor", cursor);

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`Catalog request failed with HTTP ${response.status}`);
    }

    const body = await response.json();
    const page = Array.isArray(body.offers) ? body.offers : [];
    offers.push(...page);
    if (!body.nextCursor || page.length === 0) break;
    cursor = body.nextCursor;

    // Catalog requests and probes share the documented public API allowance.
    if (offers.length < limit) await wait(2_150);
  }

  return offers.slice(0, limit);
}

function publicEndpoint(offer, baseUrl) {
  const endpoint = new URL(offer.buyUrl ?? `/x402/${offer._id}`, baseUrl);
  if (endpoint.origin !== new URL(baseUrl).origin || !endpoint.pathname.startsWith("/x402/")) {
    throw new Error(`Offer ${offer._id} has an unsafe public buy URL`);
  }
  return endpoint.toString();
}

function classify(httpCode) {
  // Authentication, payment, and method gates prove that the HTTP endpoint is live.
  if ((httpCode >= 200 && httpCode < 400) || [401, 402, 403, 405].includes(httpCode)) {
    return "alive";
  }
  if (httpCode >= 400 && httpCode < 500) return "4xx";
  if (httpCode >= 500 && httpCode < 600) return "5xx";
  return "dead";
}

async function probe(offer, options, acquireSlot) {
  const endpoint = publicEndpoint(offer, options.baseUrl);
  await acquireSlot();
  const started = performance.now();

  try {
    let response = await fetch(endpoint, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs),
      headers: { Accept: "application/json" },
    });

    if (response.status === 405) {
      await acquireSlot();
      response = await fetch(endpoint, {
        method: "OPTIONS",
        redirect: "manual",
        signal: AbortSignal.timeout(options.timeoutMs),
        headers: { Accept: "application/json" },
      });
    }

    return {
      offerId: String(offer._id),
      title: String(offer.title ?? ""),
      endpoint,
      status: classify(response.status),
      httpCode: response.status,
      latencyMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    return {
      offerId: String(offer._id),
      title: String(offer.title ?? ""),
      endpoint,
      status: timedOut ? "timeout" : "dead",
      httpCode: null,
      latencyMs: Math.round(performance.now() - started),
    };
  }
}

async function mapWithConcurrency(items, concurrency, task) {
  const output = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      output[index] = await task(items[index]);
      if ((index + 1) % 10 === 0 || index + 1 === items.length) {
        console.error(`Probed ${index + 1}/${items.length}`);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return output;
}

function markdownSummary(rows, generatedAt) {
  const counts = Object.fromEntries(
    ["alive", "dead", "timeout", "4xx", "5xx"].map((status) => [
      status,
      rows.filter((row) => row.status === status).length,
    ]),
  );
  const failures = rows.filter((row) => row.status !== "alive");
  const lines = [
    "# PayanAgent catalog endpoint-health report",
    "",
    `Generated: ${generatedAt}`,
    "",
    `Scanned ${rows.length} ranked offers: ${counts.alive} alive, ${counts.dead} dead, ` +
      `${counts.timeout} timeout, ${counts["4xx"]} other 4xx, and ${counts["5xx"]} 5xx.`,
    "",
    "The public catalog redacts raw seller endpoints, so this report measures each offer's " +
      "public PayanAgent `buyUrl`. An unpaid HTTP 401/402/403/405 response is classified as " +
      "alive because it proves the gateway is reachable; it does not prove downstream paid " +
      "fulfillment. No payment signature or paid request is sent.",
    "",
    "## Non-alive endpoints",
    "",
  ];

  if (failures.length === 0) {
    lines.push("None in this sample.", "");
  } else {
    lines.push("| Offer | Title | Status | HTTP | Latency |", "|---|---|---:|---:|---:|");
    for (const row of failures) {
      const title = row.title.replaceAll("|", "\\|").replaceAll("\n", " ");
      lines.push(
        `| ${row.offerId} | ${title} | ${row.status} | ${row.httpCode ?? "-"} | ${row.latencyMs} ms |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

const options = parseArgs(process.argv.slice(2));
const offers = await fetchCatalog(options);
if (offers.length === 0) throw new Error("Catalog returned no offers");

let nextProbeStart = Date.now();
async function acquireSlot() {
  const slot = nextProbeStart;
  nextProbeStart = Math.max(Date.now(), nextProbeStart) + options.probeDelayMs;
  await wait(slot - Date.now());
}

const rows = await mapWithConcurrency(offers, options.concurrency, (offer) =>
  probe(offer, options, acquireSlot),
);

// Serialize and parse once before writing to assert that the requested JSON is valid.
const jsonText = `${JSON.stringify(rows, null, 2)}\n`;
JSON.parse(jsonText);
const generatedAt = new Date().toISOString();
const summaryText = markdownSummary(rows, generatedAt);

await mkdir(options.outputDir, { recursive: true });
await Promise.all([
  writeFile(path.join(options.outputDir, "catalog-health-report.json"), jsonText),
  writeFile(path.join(options.outputDir, "catalog-health-summary.md"), summaryText),
]);

console.log(
  JSON.stringify(
    {
      generatedAt,
      offers: rows.length,
      outputDir: options.outputDir,
      counts: Object.fromEntries(
        ["alive", "dead", "timeout", "4xx", "5xx"].map((status) => [
          status,
          rows.filter((row) => row.status === status).length,
        ]),
      ),
    },
    null,
    2,
  ),
);
