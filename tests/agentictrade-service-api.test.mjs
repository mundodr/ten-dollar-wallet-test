import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  compileAcceptanceCriteria,
  createHandler,
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

  await withServer(createHandler({ fetchImpl }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/x402`);
    assert.equal(response.status, 402);
    assert.equal(response.headers.get("payment-required"), paymentRequired);
    assert.equal(response.headers.get("x-payment-required"), paymentRequired);
    assert.deepEqual(await response.json(), challenge);
  });
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
