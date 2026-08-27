import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "https://api.agentpact.xyz";
const credentialsPath = path.resolve(".agentpact/credentials.json");
const offersPath = path.resolve(".agentpact/offers.json");
const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));

const definitions = [
  {
    key: "csv-json-automation",
    title: "Tested Python CSV/JSON automation",
    descriptionMd:
      "Small, dependency-light Python automation for CSV or JSON transformation. Includes a documented CLI, input validation, deterministic output, unit tests, and a concise handoff report. Public or buyer-provided non-secret inputs only; no credential handling, access-control bypass, or prohibited scraping.",
    category: "data",
    tags: ["python", "csv", "json", "automation", "testing"],
    basePrice: 5,
    maxPriceDeltaPct: 60,
    fulfillmentType: "code-task",
  },
  {
    key: "python-code-review",
    title: "Python code review and security triage",
    descriptionMd:
      "Focused review of a small Python script or public repository. Delivery includes a Markdown report plus structured JSON findings with severity, evidence, impact, and concrete remediation. Static review only: no production exploitation, secrets, private keys, or unauthorized access.",
    category: "code-review",
    tags: ["python", "code-review", "security", "json", "documentation"],
    basePrice: 10,
    maxPriceDeltaPct: 50,
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
    fulfillmentType: "consulting",
  },
];

let state = { offers: [] };
try {
  state = JSON.parse(await readFile(offersPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

for (const definition of definitions) {
  if (state.offers.some((offer) => offer.key === definition.key)) continue;

  const { key, ...body } = definition;
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

console.log(
  JSON.stringify({
    count: state.offers.length,
    offers: state.offers,
    offersPath,
  }),
);
