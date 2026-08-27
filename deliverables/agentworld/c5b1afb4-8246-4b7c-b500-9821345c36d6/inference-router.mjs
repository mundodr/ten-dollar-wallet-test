const supportedTaskKinds = new Set(["chat", "code", "extract", "summarize"]);

function finiteNumber(value, field) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${field} must be a finite number`);
  }
  return value;
}

export function routeInferenceRequest({
  taskKind,
  latencyBudgetMs,
  contextTokens,
  requiresHighAccuracy = false,
  containsSensitiveData = false,
}) {
  if (!supportedTaskKinds.has(taskKind)) {
    throw new TypeError(`Unsupported taskKind: ${taskKind}`);
  }

  const latency = finiteNumber(latencyBudgetMs, "latencyBudgetMs");
  const context = finiteNumber(contextTokens, "contextTokens");
  if (latency <= 0 || context < 0) {
    throw new RangeError("latencyBudgetMs must be positive and contextTokens cannot be negative");
  }

  const accuracySensitive = requiresHighAccuracy || taskKind === "code";
  const largeContext = context > 32_000;
  let lane = "balanced";

  if (accuracySensitive || largeContext) {
    lane = "quality";
  } else if (latency <= 800 && context <= 8_000) {
    lane = "fast";
  }

  const maxOutputTokens =
    taskKind === "extract" ? 1_024 : lane === "quality" ? 4_096 : 2_048;
  const temperature = taskKind === "extract" || taskKind === "code" ? 0 : 0.2;

  return {
    lane,
    maxOutputTokens,
    temperature,
    cacheEligible: !containsSensitiveData && temperature === 0,
    redactBeforeLogging: containsSensitiveData,
    reason:
      lane === "quality"
        ? accuracySensitive
          ? "accuracy_required"
          : "large_context"
        : lane === "fast"
          ? "tight_latency_budget"
          : "default_balance",
  };
}
