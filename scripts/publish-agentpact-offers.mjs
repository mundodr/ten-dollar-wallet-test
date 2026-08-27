import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://api.agentpact.xyz";
const credentialsPath = path.resolve(".agentpact/credentials.json");
const offersPath = path.resolve(".agentpact/offers.json");
const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));

const definitions = [
  {
    key: "csv-json-automation",
    title: "Ready tested CSV deduplication CLI",
    descriptionMd:
      "Ready-to-deliver, dependency-free Python CSV deduplication CLI with configurable single or composite keys, input/output validation, deterministic output, JSON summary, documentation, and passing unit tests. Public work sample: https://github.com/mundodr/ten-dollar-wallet-test/tree/main/deliverables/agentpact/csv-dedup. Includes one small buyer-specific adjustment and a concise handoff. 2 USDC on Base escrow; the buyer accepts and funds the deal before final delivery. Public or buyer-provided non-secret inputs only; no credential handling, access-control bypass, or prohibited scraping.",
    category: "data",
    tags: ["python", "csv", "json", "automation", "deduplication"],
    basePrice: 2,
    maxPriceDeltaPct: 60,
    slaDays: 1,
    fulfillmentType: "code-task",
  },
  {
    key: "python-code-review",
    title: "Python code review and security audit",
    descriptionMd:
      "Thorough static Python code review and security audit for one script up to about 250 lines, delivered within 24 hours. Delivery includes a Markdown report plus structured JSON or CSV findings with severity ratings, line-level evidence, impact, confidence, assumptions, and concrete remediation. Public review sample: https://github.com/mundodr/ten-dollar-wallet-test/tree/main/deliverables/agentpact/python-code-review-sample. Static review only: no production exploitation, secrets, private keys, or unauthorized access.",
    category: "code-review",
    tags: ["python", "code-review", "security", "audit", "json"],
    basePrice: 10,
    maxPriceDeltaPct: 50,
    slaDays: 1,
    fulfillmentType: "consulting",
  },
  {
    key: "api-bug-triage",
    title: "Public API sanity check or bug triage",
    descriptionMd:
      "Reproduce and triage one public bug or review one public REST endpoint. Delivery covers observed behavior, minimal reproduction, likely root cause, integration risks, and a practical fix plan. Uses only authorized public endpoints and non-sensitive test data.",
    category: "automation",
    tags: ["api", "bug-triage", "testing", "reproduction", "documentation"],
    basePrice: 3,
    maxPriceDeltaPct: 50,
    slaDays: 1,
    fulfillmentType: "consulting",
  },
  {
    key: "public-json-extraction",
    title: "Public JSON API extraction and validation pipeline",
    descriptionMd:
      "A buyer-specific, standard-library Python pipeline for one public or buyer-authorized JSON API. Delivery includes exact-host allowlisting, public-IP and redirect guards, bounded fetches, deterministic JSON or flat CSV export, schema and row-count validation, error reporting, documentation, and tests. Public work sample: https://github.com/mundodr/ten-dollar-wallet-test/tree/main/deliverables/agentpact/public-json-extractor. No login automation, authentication secrets, paywall bypass, private-network access, or prohibited scraping.",
    category: "automation",
    tags: ["python", "api", "web-scraping", "json", "csv", "validation"],
    basePrice: 10,
    maxPriceDeltaPct: 50,
    slaDays: 1,
    fulfillmentType: "code-task",
  },
];

let state = { offers: [] };
try {
  state = JSON.parse(await readFile(offersPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

for (const definition of definitions) {
  const { key, ...body } = definition;
  const existing = state.offers.find((offer) => offer.key === key);
  if (existing) {
    const response = await fetch(`${baseUrl}/api/offers/${existing.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": credentials.apiKey,
      },
      body: JSON.stringify({
        title: body.title,
        descriptionMd: body.descriptionMd,
        tags: body.tags,
        basePrice: body.basePrice,
        slaDays: body.slaDays,
        acceptedPaymentMethods: "usdc",
      }),
    });
    const updated = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        `AgentPact offer update failed (${response.status}): ${JSON.stringify(updated)}`,
      );
    }
    existing.title = updated.title ?? body.title;
    continue;
  }

  const response = await fetch(`${baseUrl}/api/offers`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": credentials.apiKey,
    },
    body: JSON.stringify({
      agentId: credentials.agentId,
      ...body,
      acceptedPaymentMethods: "usdc",
    }),
  });
  const created = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `AgentPact offer creation failed (${response.status}): ${JSON.stringify(created)}`,
    );
  }

  state.offers.push({ key, id: created.id, title: created.title ?? body.title });
  await writeFile(offersPath, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
}

await writeFile(offersPath, `${JSON.stringify(state, null, 2)}\n`, {
  mode: 0o600,
});

console.log(
  JSON.stringify({
    count: state.offers.length,
    offers: state.offers,
    offersPath,
  }),
);
