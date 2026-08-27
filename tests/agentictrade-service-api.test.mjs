import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  compileJsonShape,
  compileExtractiveSummary,
  compileAcceptanceCriteria,
  compileGoalStatus,
  compileStaticCodeReview,
  createPaymentConsumer,
  createHandler,
  runBoundedRegex,
  verifySolanaUsdcPayment,
  x402BazaarExtension,
  x402ApisProvider,
  x402ServiceManifest,
} from "../scripts/agentictrade-service-api.mjs";

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("publishes exact Base x402 discovery terms", () => {
  assert.equal(x402ServiceManifest.payment.chain, "base");
  assert.equal(
    x402ServiceManifest.payment.address,
    "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18",
  );
  assert.equal(x402ServiceManifest.pricing.base, "0.01");
  assert.equal(
    x402ServiceManifest.endpoint,
    "https://api.datapoint.market/r/ten-dollar-wallet-test/api-brief-acceptance-checklist",
  );
});

test("compiles an English API brief into stable structured criteria", () => {
  const result = compileAcceptanceCriteria(
    "POST /v1/orders requires bearer auth, returns 201, and retries must be idempotent.",
  );
  assert.match(result.summary, /POST \/v1\/orders/);
  assert.ok(result.acceptance_criteria.some((item) => /Unauthenticated/.test(item.requirement)));
  assert.ok(result.acceptance_criteria.some((item) => /idempotent/.test(item.requirement)));
  assert.equal(result.test_cases.length, 6);
});

test("returns Chinese checklist text for a Chinese brief", () => {
  const result = compileAcceptanceCriteria("为分页接口增加游标参数，必须处理并发请求。");
  assert.match(result.summary, /生成可验证/);
  assert.ok(result.acceptance_criteria.some((item) => /分页/.test(item.requirement)));
  assert.ok(result.acceptance_criteria.some((item) => /并发/.test(item.requirement)));
});

test("rejects an empty brief", () => {
  assert.throws(() => compileAcceptanceCriteria("   "), /non-empty/);
});

test("describes JSON shapes deterministically", () => {
  const result = compileJsonShape({ z: 1, a: [{ ok: true }] });
  assert.deepEqual(Object.keys(result.shape.properties), ["a", "z"]);
  assert.equal(result.shape.properties.a.type, "array");
  assert.equal(
    result.shape.properties.a.first_item_shape.properties.ok.type,
    "boolean",
  );
});

test("summarizes text with a bounded deterministic extract", () => {
  const input = `${"First sentence carries the key fact. ".repeat(6)}Last.`;
  const result = compileExtractiveSummary(input, 100);
  assert.equal(result.method, "deterministic_extractive");
  assert.equal(result.truncated, true);
  assert.ok(result.summary_chars <= 100);
  assert.ok(result.original_chars > result.summary_chars);
});

test("runs regular expressions in a bounded worker", async () => {
  const result = await runBoundedRegex({
    pattern: "order-[0-9]+",
    text: "order-12 and order-34",
    flags: "i",
  });
  assert.equal(result.matched, true);
  assert.equal(result.match_count, 2);
  assert.deepEqual(
    result.matches.map((match) => match.match),
    ["order-12", "order-34"],
  );
  await assert.rejects(
    runBoundedRegex({
      pattern: "^(a+)+$",
      text: `${"a".repeat(19_999)}!`,
    }),
    /regex_execution_timeout/,
  );
});

test("computes a goal status without redefining completion", () => {
  assert.deepEqual(
    compileGoalStatus({ current: 2.5, target: 10, unit: "USDC" }),
    {
      label: null,
      current: 2.5,
      target: 10,
      unit: "USDC",
      remaining: 7.5,
      percent: 25,
      status: "in_progress",
    },
  );
  assert.equal(compileGoalStatus({ current: 12, target: 10 }).status, "complete");
});

test("returns evidence-backed bounded static code findings", () => {
  const result = compileStaticCodeReview({
    code: [
      "const token = 'abcdefghijk';",
      "fetch(userUrl);",
      "try { work(); } catch {}",
    ].join("\n"),
  });
  assert.equal(result.methodology, "bounded_deterministic_static_heuristics");
  assert.ok(result.findings.some((finding) => finding.rule === "embedded-secret"));
  assert.ok(
    result.findings.some((finding) => finding.rule === "unbounded-network-call"),
  );
  assert.ok(result.findings.every((finding) => Number.isInteger(finding.line)));
});

test("publishes direct Solana USDC provider terms", () => {
  assert.equal(
    x402ApisProvider.wallet,
    "o9mfxQnHja71MNvU81gdx4VtFaYRGxGFLKDjPJKiPYt",
  );
  assert.deepEqual(x402ApisProvider.chains, ["solana"]);
  assert.equal(x402ApisProvider.prices["codex.regex_check"], 0.0015);
  assert.equal(x402ApisProvider.prices["codex.goal_status"], 0.0005);
  assert.equal(x402ApisProvider.prices["codex.json_shape"], 0.005);
  assert.equal(x402ApisProvider.prices["codex.summarize"], 0.005);
  assert.equal(x402ApisProvider.prices["codex.code_review"], 0.04);
  assert.equal(x402ApisProvider.prices["codex.api_acceptance"], 0.01);
});

test("verifies only sufficient official Solana USDC sent to the target", async () => {
  const signature = "1".repeat(64);
  const destination = "TargetAssociatedTokenAccount1111111111111111111";
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    if (request.method === "getTransaction") {
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          meta: { err: null, innerInstructions: [] },
          transaction: {
            message: {
              instructions: [
                {
                  program: "spl-token",
                  parsed: {
                    type: "transferChecked",
                    info: {
                      authority: "Buyer1111111111111111111111111111111111111",
                      destination,
                      mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                      tokenAmount: { amount: "10000", decimals: 6 },
                    },
                  },
                },
              ],
            },
          },
        },
      });
    }
    assert.equal(request.method, "getAccountInfo");
    return Response.json({
      jsonrpc: "2.0",
      id: 1,
      result: {
        value: {
          data: {
            parsed: {
              info: {
                owner: "o9mfxQnHja71MNvU81gdx4VtFaYRGxGFLKDjPJKiPYt",
                mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
              },
            },
          },
        },
      },
    });
  };

  const accepted = await verifySolanaUsdcPayment(signature, 0.01, {
    fetchImpl,
    rpcUrl: "https://rpc.example",
  });
  assert.equal(accepted.valid, true);
  assert.equal(accepted.amountBaseUnits, "10000");
  assert.equal(accepted.targetWallet, x402ApisProvider.wallet);

  const insufficient = await verifySolanaUsdcPayment(signature, 0.010001, {
    fetchImpl,
    rpcUrl: "https://rpc.example",
  });
  assert.deepEqual(insufficient, {
    valid: false,
    error: "matching_usdc_transfer_not_found",
  });
});

test("x402apis route requires payment and rejects replay", async () => {
  const consumed = new Set();
  const verifyX402ApisPayment = async (signature, minimumUsdc) => ({
    valid: signature === "paid-signature" && minimumUsdc === 0.005,
    signature,
    amountUsdc: minimumUsdc,
  });
  const consumeX402ApisPayment = async (payment) => {
    if (consumed.has(payment.signature)) return false;
    consumed.add(payment.signature);
    return true;
  };
  await withServer(
    createHandler({ verifyX402ApisPayment, consumeX402ApisPayment }),
    async (baseUrl) => {
      const health = await fetch(`${baseUrl}/x402apis/health`);
      assert.equal(health.status, 200);
      assert.equal((await health.json()).wallet, x402ApisProvider.wallet);

      const body = JSON.stringify({
        api: "codex.json_shape",
        params: { input: { id: 1 } },
      });
      const unpaid = await fetch(`${baseUrl}/x402apis/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      assert.equal(unpaid.status, 402);
      assert.equal((await unpaid.json()).wallet, x402ApisProvider.wallet);

      const headers = {
        "Content-Type": "application/json",
        "X-Payment": "paid-signature",
        "X-Payment-Chain": "solana",
      };
      const paid = await fetch(`${baseUrl}/x402apis/call`, {
        method: "POST",
        headers,
        body,
      });
      assert.equal(paid.status, 200);
      assert.equal((await paid.json()).data.shape.properties.id.type, "number");

      const replay = await fetch(`${baseUrl}/x402apis/call`, {
        method: "POST",
        headers,
        body,
      });
      assert.equal(replay.status, 409);
    },
  );
});

test("payment replay protection survives a process restart", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "tdw-x402apis-"));
  const file = path.join(directory, "consumed.ndjson");
  const payment = { signature: "persisted-payment", amountUsdc: 0.01 };
  try {
    const firstProcess = await createPaymentConsumer(file);
    assert.equal(await firstProcess(payment), true);
    assert.equal(await firstProcess(payment), false);
    const restartedProcess = await createPaymentConsumer(file);
    assert.equal(await restartedProcess(payment), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("accepts an OpenAI-style messages envelope", () => {
  const result = compileAcceptanceCriteria({
    messages: [
      { role: "system", content: "Return a deterministic checklist." },
      {
        role: "user",
        content: "POST /v1/items must reject a missing id with HTTP 400.",
      },
    ],
  });

  assert.match(result.summary, /POST \/v1\/items/);
  assert.doesNotMatch(result.summary, /"messages"/);
});

test("x402 proxy exposes the upstream v2 challenge in headers and JSON", async () => {
  const challenge = {
    x402Version: 2,
    resource: {
      url: "https://payan.example/x402/offer",
      description: "Payment for deterministic checklist",
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:8453",
        amount: "10000",
        payTo: "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18",
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      },
    ],
  };
  const paymentRequired = Buffer.from(JSON.stringify(challenge)).toString(
    "base64",
  );
  const fetchImpl = async () =>
    new Response(JSON.stringify({ error: "Payment required" }), {
      status: 402,
      headers: { "Payment-Required": paymentRequired },
    });

  await withServer(createHandler({
    fetchImpl,
    publicX402Url: "https://proxy.example/x402",
  }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/x402`);
    assert.equal(response.status, 402);
    const forwardedHeader = response.headers.get("payment-required");
    assert.equal(response.headers.get("x-payment-required"), forwardedHeader);
    const forwardedChallenge = JSON.parse(
      Buffer.from(forwardedHeader, "base64").toString("utf8"),
    );
    assert.deepEqual(await response.json(), forwardedChallenge);
    assert.equal(
      forwardedChallenge.resource.url,
      "https://proxy.example/x402",
    );
    assert.equal(
      forwardedChallenge.resource.serviceName,
      "Acceptance Checklist API",
    );
    assert.deepEqual(
      forwardedChallenge.extensions.bazaar,
      x402BazaarExtension,
    );
    assert.deepEqual(forwardedChallenge.accepts, challenge.accepts);
  });
});

test("Bazaar metadata describes a valid POST body and structured output", () => {
  const { info, schema } = x402BazaarExtension;
  assert.equal(info.input.type, "http");
  assert.equal(info.input.method, "POST");
  assert.equal(info.input.bodyType, "json");
  assert.equal(typeof info.input.body.input, "string");
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.deepEqual(schema.properties.input.required, [
    "type",
    "method",
    "bodyType",
    "body",
  ]);
  assert.equal(info.output.type, "json");
  assert.equal(Array.isArray(info.output.example.test_cases), true);
});

test("x402 proxy forwards payment signatures, payloads, and receipts", async () => {
  let observed = null;
  const fetchImpl = async (url, options) => {
    observed = { url, options };
    return new Response(JSON.stringify({ summary: "paid result" }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Payment-Response": "settlement-receipt",
      },
    });
  };

  await withServer(createHandler({ fetchImpl }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/x402`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Payment-Signature": "signed-usdc-authorization",
      },
      body: JSON.stringify({ input: "POST /v1/orders must return 201" }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("payment-response"), "settlement-receipt");
    assert.equal(
      response.headers.get("x-payment-response"),
      "settlement-receipt",
    );
    assert.deepEqual(await response.json(), { summary: "paid result" });
  });

  assert.equal(observed.url.includes("payanagent.com/x402/"), true);
  assert.equal(
    observed.options.headers["payment-signature"],
    "signed-usdc-authorization",
  );
  assert.deepEqual(JSON.parse(observed.options.body.toString("utf8")), {
    input: "POST /v1/orders must return 201",
  });
});

test("AgentPact webhook accepts only a valid HMAC signature", async () => {
  const secret = "test-only-agentpact-webhook-secret";
  const event = { type: "deal.proposed", data: { dealId: "deal-123" } };
  const rawBody = JSON.stringify(event);
  const signature = createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  const recorded = [];

  await withServer(
    createHandler({
      agentPactWebhookSecret: secret,
      recordAgentPactWebhook: async (entry) => recorded.push(entry),
    }),
    async (baseUrl) => {
      const rejected = await fetch(`${baseUrl}/agentpact/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AgentPact-Signature": "bad-signature",
        },
        body: rawBody,
      });
      assert.equal(rejected.status, 401);

      const accepted = await fetch(`${baseUrl}/agentpact/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AgentPact-Signature": signature,
        },
        body: rawBody,
      });
      assert.equal(accepted.status, 200);
      assert.deepEqual(await accepted.json(), { ok: true });
    },
  );

  assert.equal(recorded.length, 1);
  assert.deepEqual(recorded[0].event, event);
  assert.match(recorded[0].receivedAt, /^\d{4}-\d{2}-\d{2}T/);
});
