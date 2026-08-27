import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const apiUrl = "https://api.nohumans.directory";
const privateDir = path.resolve(".nohumans");
const statePath = path.join(privateDir, "listing-state.json");
const endpointUrl =
  "https://payanagent.com/x402/kh7ezjzt4etk8x1s908z7wngqn8d89hx";

async function request(url, options = {}) {
  let response;
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
  if (!response) throw lastError ?? new Error(`No response from ${new URL(url).host}`);
  const body = await response.json().catch(() => null);
  return { response, body };
}

await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);

try {
  const existing = JSON.parse(await readFile(statePath, "utf8"));
  const current = await request(`${apiUrl}/v1/listings/${encodeURIComponent(existing.id)}`);
  if (current.response.ok && current.body?.endpoint_url === endpointUrl) {
    console.log(
      JSON.stringify({
        reused: true,
        listingId: existing.id,
        status: current.body.status,
        endpointMatches: true,
      }),
    );
    process.exit(0);
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const submission = await request(`${apiUrl}/v1/listings`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "Deterministic API Brief Acceptance Checklist",
    description:
      "Compile an English or Chinese API brief into strict JSON acceptance criteria, assumptions, edge cases, open questions, and six test scenarios.",
    endpoint_url: endpointUrl,
    category: "infra.validation",
    kind: "api",
    price_amount: 0.01,
    price_currency: "USDC",
    chains: ["base"],
  }),
});
if (!submission.response.ok || !submission.body?.id) {
  throw new Error(
    `nohumans.directory submission failed (${submission.response.status}): ${submission.body?.error ?? submission.body?.message ?? "unknown"}`,
  );
}
const state = {
  ...submission.body,
  endpointUrl,
  submittedAt: new Date().toISOString(),
};
await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
await chmod(statePath, 0o600);

const published = await request(
  `${apiUrl}/v1/listings/${encodeURIComponent(state.id)}`,
);
if (!published.response.ok || published.body?.endpoint_url !== endpointUrl) {
  throw new Error(
    `nohumans.directory did not publish the intended endpoint (${published.response.status})`,
  );
}

console.log(
  JSON.stringify(
    {
      reused: false,
      submitted: true,
      listingId: state.id,
      status: published.body.status,
      claimTokenStored: Boolean(state.claim_token),
      endpointMatches: true,
    },
    null,
    2,
  ),
);
