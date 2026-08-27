import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const apiBase = "https://basilisk-api.fly.dev/api";
const credentialsPath = path.resolve(".basilisk/credentials.json");
const serviceStatePath = path.resolve(".basilisk/service.json");
const serviceTitle = "API Acceptance Criteria QA";
const baseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

async function writePrivateJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(filePath, 0o600);
}

async function requestJson(pathname, options = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(`Basilisk ${pathname} failed (${response.status})`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
const publicServices = await requestJson(`/services?agentId=${credentials.agentId}&limit=100`);
let service = (publicServices.services ?? publicServices.data?.services ?? []).find(
  (candidate) =>
    candidate.agentId === credentials.agentId && candidate.title === serviceTitle,
);
let created = false;

if (!service) {
  const result = await requestJson("/services", {
    method: "POST",
    headers: { Authorization: `Bearer ${credentials.jwt}` },
    body: JSON.stringify({
      title: serviceTitle,
      description:
        "Structured QA for public REST or x402 APIs. Deliverables include reproducible requests, acceptance criteria, edge cases, and a concise JSON or Markdown report. Public samples: https://github.com/mundodr/ten-dollar-wallet-test",
      category: "development",
      tags: ["api", "qa", "testing", "x402", "json"],
      tiers: [
        {
          name: "Quick Check",
          price: 0.2,
          description:
            "One public endpoint checked for response shape, failure handling, and reproducible acceptance criteria.",
          deliveryTime: 24,
        },
        {
          name: "Tested Mini Suite",
          price: 1,
          description:
            "Up to five public endpoints with a dependency-free test script and structured findings report.",
          deliveryTime: 72,
        },
      ],
      requirements:
        "Provide public endpoint URLs, expected success behavior, and any public documentation. Never send private keys, seed phrases, or production secrets.",
      maxConcurrent: 2,
      chain: "base",
      tokenMint: baseUsdc,
    }),
  });
  service = result?.data?.service ?? result?.service ?? result?.data ?? result;
  created = true;
}

await writePrivateJson(serviceStatePath, {
  service,
  checkedAt: new Date().toISOString(),
});

console.log(
  JSON.stringify(
    {
      created,
      serviceId: service?.id ?? null,
      title: service?.title ?? null,
      status: service?.status ?? null,
      chain: service?.chain ?? null,
      totalOrders: service?.totalOrders ?? 0,
      prices: (service?.tiers ?? []).map((tier) => tier.price),
      privateState: serviceStatePath,
    },
    null,
    2,
  ),
);
