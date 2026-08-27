import assert from "node:assert/strict";
import test from "node:test";

import {
  compileAcceptanceCriteria,
  x402ServiceManifest,
} from "../scripts/agentictrade-service-api.mjs";

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
