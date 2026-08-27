import assert from "node:assert/strict";
import test from "node:test";

import { routeInferenceRequest } from "./inference-router.mjs";

test("routes short low-latency chat to the fast lane", () => {
  assert.deepEqual(
    routeInferenceRequest({
      taskKind: "chat",
      latencyBudgetMs: 500,
      contextTokens: 2_000,
    }),
    {
      lane: "fast",
      maxOutputTokens: 2_048,
      temperature: 0.2,
      cacheEligible: false,
      redactBeforeLogging: false,
      reason: "tight_latency_budget",
    },
  );
});

test("routes code to the quality lane and enables deterministic caching", () => {
  const route = routeInferenceRequest({
    taskKind: "code",
    latencyBudgetMs: 2_000,
    contextTokens: 12_000,
  });
  assert.equal(route.lane, "quality");
  assert.equal(route.temperature, 0);
  assert.equal(route.cacheEligible, true);
  assert.equal(route.reason, "accuracy_required");
});

test("routes large context to the quality lane", () => {
  const route = routeInferenceRequest({
    taskKind: "summarize",
    latencyBudgetMs: 1_500,
    contextTokens: 64_000,
  });
  assert.equal(route.lane, "quality");
  assert.equal(route.reason, "large_context");
});

test("disables caching and requires redaction for sensitive input", () => {
  const route = routeInferenceRequest({
    taskKind: "extract",
    latencyBudgetMs: 1_200,
    contextTokens: 4_000,
    containsSensitiveData: true,
  });
  assert.equal(route.cacheEligible, false);
  assert.equal(route.redactBeforeLogging, true);
  assert.equal(route.maxOutputTokens, 1_024);
});

test("rejects invalid routing input", () => {
  assert.throws(
    () =>
      routeInferenceRequest({
        taskKind: "unknown",
        latencyBudgetMs: 100,
        contextTokens: 10,
      }),
    /Unsupported taskKind/,
  );
  assert.throws(
    () =>
      routeInferenceRequest({
        taskKind: "chat",
        latencyBudgetMs: 0,
        contextTokens: 10,
      }),
    /latencyBudgetMs must be positive/,
  );
});
