import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const apiUrl = "https://api.x402.jobs";
const supabaseUrl = "https://mgvojndnifjbxvdxkdyd.supabase.co";
const publishableKey = "sb_publishable_T9Ruv1HSZ9Vx3uqbxY_ixg_aV_SPlBA";
const credentialsPath = path.resolve(".x402jobs/credentials.json");
const resourceStatePath = path.resolve(
  ".x402jobs/code-review-resource-state.json",
);
const jobStatePath = path.resolve(".x402jobs/code-review-job-state.json");
const targetBaseWallet =
  "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18";
const baseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const x402JobsBaseEscrow = "0xAEB58049d3C266D55595a596Fae249C10764a031";
const jobName = "Python Security Review to Structured Findings";
const resourcePriceUsdc = 5;
const resourceAmountBaseUnits = "5000000";
const platformFeeRate = 0.015;
const platformFeeMinimumUsdc = 0.01;
const expectedBuyerPriceUsdc =
  resourcePriceUsdc +
  Math.max(resourcePriceUsdc * platformFeeRate, platformFeeMinimumUsdc);
const expectedBuyerAmountBaseUnits = String(
  Math.round(expectedBuyerPriceUsdc * 1_000_000),
);

async function request(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.json().catch(() => null);
      if (response.status !== 429 && response.status < 500) {
        return { response, body };
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
  throw lastError ?? new Error(`No response from ${new URL(url).host}`);
}

function decodeChallenge(result) {
  const encoded =
    result.response.headers.get("payment-required") ??
    result.response.headers.get("x-payment-required");
  if (encoded) {
    try {
      return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    } catch {
      // Fall back to the response body.
    }
  }
  return result.body;
}

function exactDownstreamChallenge(result, resourceUrl) {
  const challenge = decodeChallenge(result);
  const payment = challenge?.accepts?.[0];
  return (
    result.response.status === 402 &&
    challenge?.x402Version === 2 &&
    challenge?.resource?.url === resourceUrl &&
    payment?.scheme === "exact" &&
    payment?.network === "eip155:8453" &&
    payment?.amount === resourceAmountBaseUnits &&
    String(payment?.payTo).toLowerCase() === targetBaseWallet &&
    String(payment?.asset).toLowerCase() === baseUsdc.toLowerCase()
  );
}

function workflowFor(resource) {
  const resourceNodeId = "resource-code-review";
  return {
    nodes: [
      {
        id: "trigger-1",
        type: "trigger",
        position: { x: 300, y: 100 },
        data: {
          label: "Code Input",
          triggerType: "webhook",
          triggerMethods: { manual: false, webhook: true, schedule: false },
          workflowInputs: [
            {
              name: "code",
              type: "string",
              required: true,
              description:
                "One bounded Python source file as plain text; it is statically reviewed and never executed.",
            },
          ],
        },
      },
      {
        id: resourceNodeId,
        type: "resource",
        position: { x: 300, y: 280 },
        data: {
          resource: {
            id: resource.resourceId,
            name: resource.resourceName,
            description:
              "Deterministic static Python security triage with line-specific findings.",
            resourceUrl: resource.resourceUrl,
            price: resourcePriceUsdc,
            network: "base",
            outputSchema: {
              language: "python",
              methodology: "bounded_deterministic_static_heuristics",
              finding_count: "number",
              findings: [
                {
                  rule: "string",
                  severity: "high|medium|low",
                  line: "number",
                  evidence: "string",
                  remediation: "string",
                },
              ],
            },
          },
          configuredInputs: {
            code: {
              type: "reference",
              sourceNodeId: "trigger-1",
              sourceField: "code",
            },
          },
        },
      },
      {
        id: "output-1",
        type: "output",
        position: { x: 300, y: 460 },
        data: { label: "Structured Findings", outputType: "lastResult" },
      },
    ],
    edges: [
      {
        id: `trigger-1-${resourceNodeId}`,
        source: "trigger-1",
        target: resourceNodeId,
      },
      {
        id: `${resourceNodeId}-output-1`,
        source: resourceNodeId,
        target: "output-1",
      },
    ],
  };
}

function hasExactWorkflow(job, resourceState) {
  const workflow = job.workflow_data ?? job.workflow_definition ?? {};
  const nodes = workflow.nodes ?? [];
  const resourceNodes = nodes.filter((node) => node.type === "resource");
  const trigger = nodes.find((node) => node.id === "trigger-1");
  const output = nodes.find((node) => node.id === "output-1");
  const resource = resourceNodes[0]?.data?.resource;
  const codeInput = resourceNodes[0]?.data?.configuredInputs?.code;
  return (
    job.name === jobName &&
    job.network === "base" &&
    job.published === true &&
    job.trigger_methods?.webhook === true &&
    Number(job.creator_markup) === 0 &&
    resourceNodes.length === 1 &&
    resource?.id === resourceState.resourceId &&
    resource?.resourceUrl === resourceState.resourceUrl &&
    Number(resource?.price) === resourcePriceUsdc &&
    codeInput?.type === "reference" &&
    codeInput?.sourceNodeId === "trigger-1" &&
    codeInput?.sourceField === "code" &&
    trigger?.data?.workflowInputs?.some(
      (input) => input.name === "code" && input.required === true,
    ) &&
    Boolean(output)
  );
}

const [credentials, resourceState] = await Promise.all([
  readFile(credentialsPath, "utf8").then(JSON.parse),
  readFile(resourceStatePath, "utf8").then(JSON.parse),
]);
if (
  resourceState.targetBaseWallet?.toLowerCase() !== targetBaseWallet ||
  resourceState.amountBaseUnits !== resourceAmountBaseUnits
) {
  throw new Error("Saved x402.jobs resource state drifted from the locked target");
}

const downstreamProbe = await request(resourceState.resourceUrl, {
  method: "POST",
  headers: { Accept: "application/json", "Content-Type": "application/json" },
  body: JSON.stringify({ code: "print('hello')" }),
});
if (!exactDownstreamChallenge(downstreamProbe, resourceState.resourceUrl)) {
  throw new Error("Downstream resource no longer has exact direct-target terms");
}

const session = await request(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: {
    apikey: publishableKey,
    Authorization: `Bearer ${publishableKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    email: credentials.email,
    password: credentials.password,
  }),
});
if (!session.response.ok || !session.body?.access_token) {
  throw new Error(`x402.jobs session refresh failed (${session.response.status})`);
}
const authHeaders = {
  Authorization: `Bearer ${session.body.access_token}`,
  "Content-Type": "application/json",
};

let listed = await request(`${apiUrl}/jobs`, { headers: authHeaders });
if (!listed.response.ok) {
  throw new Error(`x402.jobs job list failed (${listed.response.status})`);
}
let jobs = listed.body?.jobs ?? [];
let job = jobs.find((candidate) => candidate.name === jobName) ?? null;
let created = false;

if (job && !hasExactWorkflow(job, resourceState)) {
  throw new Error("A same-name x402.jobs job exists with mismatched configuration");
}

if (!job) {
  const workflow = workflowFor(resourceState);
  const creation = await request(`${apiUrl}/jobs`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      name: jobName,
      description:
        "Review one bounded Python source file without executing it and return deterministic, line-specific findings for shell execution, embedded credentials, unsafe deserialization, and missing network timeouts.",
      network: "base",
      workflow_data: workflow,
      triggerType: "webhook",
    }),
  });
  if (!creation.response.ok || !creation.body?.job?.id) {
    throw new Error(
      `x402.jobs job creation failed (${creation.response.status}): ${creation.body?.error ?? creation.body?.message ?? "unknown"}`,
    );
  }
  created = true;
  const jobId = creation.body.job.id;
  const update = await request(`${apiUrl}/jobs/${encodeURIComponent(jobId)}`, {
    method: "PUT",
    headers: authHeaders,
    body: JSON.stringify({
      description:
        "Review one bounded Python source file without executing it and return deterministic, line-specific findings for shell execution, embedded credentials, unsafe deserialization, and missing network timeouts.",
      workflow_data: workflow,
      triggerType: "webhook",
      triggerMethods: { manual: false, webhook: true, schedule: false },
      creatorMarkup: 0,
      published: true,
      showWorkflow: true,
      webhookResponse: { mode: "passthrough" },
    }),
  });
  if (!update.response.ok) {
    throw new Error(
      `x402.jobs job publish failed (${update.response.status}): ${update.body?.error ?? update.body?.message ?? "unknown"}`,
    );
  }
}

for (let attempt = 1; attempt <= 6; attempt += 1) {
  listed = await request(`${apiUrl}/jobs`, { headers: authHeaders });
  jobs = listed.body?.jobs ?? [];
  job = jobs.find((candidate) => candidate.name === jobName) ?? null;
  if (job && hasExactWorkflow(job, resourceState)) break;
  if (attempt < 6) {
    await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
  }
}
if (!job || !hasExactWorkflow(job, resourceState)) {
  throw new Error("Published x402.jobs job did not read back exactly");
}

const publicQuery = new URL("/jobs/public", apiUrl);
publicQuery.searchParams.set("search", jobName);
publicQuery.searchParams.set("limit", "100");
const publicResult = await request(publicQuery, {
  headers: { Accept: "application/json" },
});
const publicJob = (publicResult.body?.jobs ?? []).find(
  (candidate) => candidate.id === job.id,
);
if (!publicResult.response.ok || !publicJob?.webhook_url) {
  throw new Error("x402.jobs did not expose the published webhook job");
}

const unpaidProbe = await request(publicJob.webhook_url, {
  method: "POST",
  headers: { Accept: "application/json", "Content-Type": "application/json" },
  body: JSON.stringify({ code: "print('hello')" }),
});
const jobChallenge = decodeChallenge(unpaidProbe);
const jobPayment = jobChallenge?.accepts?.[0];
const buyerAmountBaseUnits =
  jobChallenge?.x402Version === 1
    ? jobPayment?.maxAmountRequired
    : jobPayment?.amount;
const buyerResource =
  jobChallenge?.x402Version === 1
    ? jobPayment?.resource
    : jobChallenge?.resource?.url;
const exactBuyerChallenge =
  unpaidProbe.response.status === 402 &&
  [1, 2].includes(jobChallenge?.x402Version) &&
  jobPayment?.scheme === "exact" &&
  ["base", "eip155:8453"].includes(jobPayment?.network) &&
  buyerAmountBaseUnits === expectedBuyerAmountBaseUnits &&
  buyerResource === publicJob.webhook_url &&
  String(jobPayment?.asset).toLowerCase() === baseUsdc.toLowerCase() &&
  String(jobPayment?.payTo).toLowerCase() === x402JobsBaseEscrow.toLowerCase();
if (!exactBuyerChallenge) {
  throw new Error("Published x402.jobs job has unexpected buyer payment terms");
}

await mkdir(path.dirname(jobStatePath), { recursive: true, mode: 0o700 });
await writeFile(
  jobStatePath,
  `${JSON.stringify({
    jobId: job.id,
    jobName,
    publicUrl: publicJob.webhook_url,
    publicPage:
      publicJob.owner_username && publicJob.slug
        ? `https://www.x402.jobs/@${publicJob.owner_username}/${publicJob.slug}`
        : `https://www.x402.jobs/jobs/${job.id}`,
    network: "base",
    resourceId: resourceState.resourceId,
    resourceUrl: resourceState.resourceUrl,
    resourceAmountBaseUnits,
    buyerAmountBaseUnits: expectedBuyerAmountBaseUnits,
    buyerEscrow: x402JobsBaseEscrow,
    buyerChallengeVersion: jobChallenge.x402Version,
    creatorMarkupUsdc: 0,
    targetBaseWallet,
    recordedAt: new Date().toISOString(),
  }, null, 2)}\n`,
  { mode: 0o600 },
);
await chmod(jobStatePath, 0o600);

console.log(
  JSON.stringify(
    {
      created,
      jobId: job.id,
      publicPage:
        publicJob.owner_username && publicJob.slug
          ? `https://www.x402.jobs/@${publicJob.owner_username}/${publicJob.slug}`
          : `https://www.x402.jobs/jobs/${job.id}`,
      publicWebhook: publicJob.webhook_url,
      published: true,
      exactBuyerChallenge,
      buyerPriceUsdc: Number(expectedBuyerAmountBaseUnits) / 1_000_000,
      creatorMarkupUsdc: 0,
      downstreamPriceUsdc: resourcePriceUsdc,
      downstreamDirectTarget: true,
      paymentAttempted: false,
      countingPolicy:
        "The job and its buyer challenge are discovery evidence only. Never self-buy; count only an independently verified Base-mainnet transfer to the target wallet.",
    },
    null,
    2,
  ),
);
