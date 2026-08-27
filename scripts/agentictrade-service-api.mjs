import { createHmac, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const maxBodyBytes = 64 * 1024;
const defaultPayanX402Url =
  "https://payanagent.com/x402/kh7ezjzt4etk8x1s908z7wngqn8d89hx";
const defaultPublicX402Url =
  "https://simply-technician-crowd-newton.trycloudflare.com/x402";

export const x402BazaarExtension = {
  info: {
    input: {
      type: "http",
      method: "POST",
      bodyType: "json",
      body: {
        input:
          "POST /v1/orders requires bearer auth, returns HTTP 201, and retries must be idempotent.",
      },
    },
    output: {
      type: "json",
      format: "Structured API acceptance criteria and test cases",
      example: {
        summary:
          "Verifiable API acceptance checklist for: POST /v1/orders requires bearer auth.",
        assumptions: [],
        acceptance_criteria: [
          {
            id: "AC-1",
            requirement:
              "For contract-valid input, POST /v1/orders succeeds and returns a parseable response.",
            verification:
              "Assert with an isolated request and observable response or state.",
          },
        ],
        test_cases: [
          {
            id: "TC-1",
            type: "happy_path",
            setup: "Prepare the smallest contract-valid input.",
            action: "Call POST /v1/orders.",
            expected:
              "Request succeeds; response parses and satisfies every declared field constraint.",
          },
        ],
        edge_cases: ["Empty and whitespace-only input"],
        open_questions: [],
      },
    },
  },
  schema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      input: {
        type: "object",
        properties: {
          type: { type: "string", const: "http" },
          method: { type: "string", enum: ["POST"] },
          bodyType: { type: "string", enum: ["json"] },
          body: {
            type: "object",
            properties: {
              input: {
                type: "string",
                minLength: 1,
                description:
                  "English or Chinese API feature brief, contract, or bug report.",
              },
            },
            required: ["input"],
            additionalProperties: false,
          },
        },
        required: ["type", "method", "bodyType", "body"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          type: { type: "string", const: "json" },
          format: { type: "string" },
          example: { type: "object" },
        },
        required: ["type", "example"],
        additionalProperties: false,
      },
    },
    required: ["input", "output"],
    additionalProperties: false,
  },
};

export const x402ServiceManifest = {
  x402: "1.0",
  name: "deterministic-api-brief-acceptance-checklist",
  capabilities: ["api-testing", "acceptance-criteria", "json", "bilingual"],
  pricing: { currency: "USDC", base: "0.01", unit: "request" },
  payment: {
    address: "0x4244f335c42ebd82dbd1378a9cb192f582d9ad18",
    chain: "base",
    facilitator: "https://api.datapoint.market",
  },
  endpoint:
    "https://api.datapoint.market/r/ten-dollar-wallet-test/api-brief-acceptance-checklist",
};

function cleanBrief(value) {
  let normalized = value;
  if (value && typeof value === "object" && Array.isArray(value.messages)) {
    const contents = value.messages
      .map((message) => message?.content)
      .flatMap((content) => (Array.isArray(content) ? content : [content]))
      .map((content) =>
        typeof content === "string"
          ? content
          : typeof content?.text === "string"
            ? content.text
            : "",
      )
      .filter(Boolean);
    if (contents.length > 0) normalized = contents.join("\n");
  }
  const raw =
    typeof normalized === "string" ? normalized : JSON.stringify(normalized);
  return raw.replace(/\s+/g, " ").trim().slice(0, 20_000);
}

function firstMatch(text, expression) {
  return text.match(expression)?.[0] ?? null;
}

export function compileAcceptanceCriteria(value) {
  const brief = cleanBrief(value);
  if (!brief) throw new TypeError("input must contain a non-empty API task brief");

  const chinese = /[\u3400-\u9fff]/.test(brief);
  const method = firstMatch(brief.toUpperCase(), /\b(?:GET|POST|PUT|PATCH|DELETE)\b/);
  const endpoint = firstMatch(brief, /\/(?:[A-Za-z0-9._~!$&'()*+,;=:@%-]+\/?){1,8}/);
  const mentionsAuth = /auth|bearer|oauth|jwt|permission|role|权限|鉴权|认证/i.test(brief);
  const mentionsPagination = /paginat|cursor|page size|limit|offset|分页/i.test(brief);
  const mentionsIdempotency = /idempoten|retry|重复|重试|幂等/i.test(brief);
  const mentionsConcurrency = /concurren|race|parallel|并发|竞态/i.test(brief);
  const mentionsSchema = /schema|json|field|property|response|字段|响应|结构/i.test(brief);
  const mentionsStatus = /\b[1-5][0-9]{2}\b|status code|状态码/i.test(brief);
  const subject = brief.length > 220 ? `${brief.slice(0, 217)}...` : brief;

  const assumptions = [];
  if (!method) assumptions.push(chinese ? "请求方法未给出，测试时需确认。" : "HTTP method is not specified and must be confirmed.");
  if (!endpoint) assumptions.push(chinese ? "端点路径未给出，测试时需确认。" : "Endpoint path is not specified and must be confirmed.");
  if (!mentionsSchema) assumptions.push(chinese ? "未给出完整响应结构，字段级断言暂记为待定。" : "No complete response schema was supplied; field-level assertions remain TBD.");
  if (!mentionsStatus) assumptions.push(chinese ? "未给出明确状态码，成功与失败码需由实现方确认。" : "Exact success and error status codes were not supplied and need confirmation.");

  const criteria = [
    chinese
      ? `当输入满足契约时，${method ?? "目标方法"} ${endpoint ?? "目标端点"} 返回成功且响应可解析。`
      : `For contract-valid input, ${method ?? "the target method"} ${endpoint ?? "the target endpoint"} succeeds and returns a parseable response.`,
    chinese
      ? "缺少必填字段、类型错误或越界值必须被拒绝，并返回稳定、可定位的错误信息。"
      : "Missing required fields, wrong types, and out-of-range values are rejected with stable, actionable errors.",
    chinese
      ? "服务不得在失败时留下未声明的部分写入或不一致状态。"
      : "A failed request leaves no undocumented partial write or inconsistent state.",
    chinese
      ? "响应不得泄露密钥、内部堆栈或未授权数据。"
      : "Responses expose no credentials, internal stack traces, or unauthorized data.",
  ];
  if (mentionsAuth) criteria.push(chinese ? "未认证与无权限调用分别被一致地拒绝。" : "Unauthenticated and unauthorized callers are rejected consistently.");
  if (mentionsPagination) criteria.push(chinese ? "分页边界无重复、无遗漏，游标或页码行为稳定。" : "Pagination boundaries produce no duplicates or omissions, with stable cursor or page behavior.");
  if (mentionsIdempotency) criteria.push(chinese ? "同一幂等请求重试不会产生重复副作用。" : "Retrying the same idempotent request creates no duplicate side effect.");
  if (mentionsConcurrency) criteria.push(chinese ? "并发请求不会突破约束或覆盖已提交结果。" : "Concurrent requests do not violate constraints or overwrite committed results.");

  const acceptanceCriteria = criteria.map((requirement, index) => ({
    id: `AC-${index + 1}`,
    requirement,
    verification: chinese ? "以独立请求和可观察响应/状态进行断言。" : "Assert with an isolated request and observable response or state.",
  }));

  const testCases = [
    {
      id: "TC-1",
      type: "happy_path",
      setup: chinese ? "准备一组最小合法输入。" : "Prepare the smallest contract-valid input.",
      action: chinese ? `调用 ${method ?? "目标方法"} ${endpoint ?? "目标端点"}。` : `Call ${method ?? "the target method"} ${endpoint ?? "the target endpoint"}.`,
      expected: chinese ? "请求成功；响应可解析并满足已声明字段约束。" : "Request succeeds; response parses and satisfies every declared field constraint.",
    },
    {
      id: "TC-2",
      type: "missing_required_input",
      setup: chinese ? "逐一删除每个必填字段。" : "Remove each required field one at a time.",
      action: chinese ? "提交每个缺字段变体。" : "Submit every missing-field variant.",
      expected: chinese ? "每次调用均被拒绝，错误能定位对应字段。" : "Every call is rejected and identifies the corresponding field.",
    },
    {
      id: "TC-3",
      type: "type_and_boundary_validation",
      setup: chinese ? "构造错误类型、空值、最小值与最大值附近输入。" : "Prepare wrong types, nulls, and values around documented minima and maxima.",
      action: chinese ? "逐个提交边界变体。" : "Submit each boundary variant independently.",
      expected: chinese ? "有效边界通过；无效边界以稳定错误失败。" : "Valid boundaries pass; invalid boundaries fail with stable errors.",
    },
    {
      id: "TC-4",
      type: "authorization",
      setup: chinese ? "准备无凭证、过期凭证和权限不足凭证。" : "Prepare missing, expired, and insufficient-privilege credentials.",
      action: chinese ? "分别调用目标端点。" : "Call the target endpoint with each credential state.",
      expected: chinese ? "调用被拒绝，且不泄露受保护数据。" : "Calls are rejected without exposing protected data.",
    },
    {
      id: "TC-5",
      type: "failure_atomicity",
      setup: chinese ? "制造可控的下游或持久化失败。" : "Arrange a controlled downstream or persistence failure.",
      action: chinese ? "提交原本合法的请求。" : "Submit an otherwise valid request.",
      expected: chinese ? "返回可诊断错误，且没有未声明的部分副作用。" : "A diagnosable error returns with no undocumented partial side effect.",
    },
    {
      id: "TC-6",
      type: mentionsConcurrency ? "concurrency" : "repeatability",
      setup: chinese ? "准备两个等价请求。" : "Prepare two equivalent requests.",
      action: chinese ? (mentionsConcurrency ? "并发提交请求。" : "连续重复提交请求。") : (mentionsConcurrency ? "Submit both requests concurrently." : "Submit the request twice in sequence."),
      expected: chinese ? "结果符合幂等/重复调用契约且状态保持一致。" : "Results match the idempotency or repeat-call contract and state remains consistent.",
    },
  ];

  const openQuestions = [];
  if (!method) openQuestions.push(chinese ? "目标 HTTP 方法是什么？" : "What is the target HTTP method?");
  if (!endpoint) openQuestions.push(chinese ? "目标端点路径是什么？" : "What is the target endpoint path?");
  if (!mentionsStatus) openQuestions.push(chinese ? "成功与主要失败场景应返回哪些状态码？" : "Which status codes define success and the principal failures?");
  if (!mentionsAuth) openQuestions.push(chinese ? "该接口是否需要认证或角色权限？" : "Does the endpoint require authentication or role-based authorization?");
  if (!mentionsSchema) openQuestions.push(chinese ? "请求与响应的字段结构、类型和限制是什么？" : "What are the request and response fields, types, and constraints?");

  return {
    summary: chinese ? `为以下任务生成可验证的接口验收清单：${subject}` : `Verifiable API acceptance checklist for: ${subject}`,
    assumptions,
    acceptance_criteria: acceptanceCriteria,
    test_cases: testCases,
    edge_cases: chinese
      ? ["空输入与仅空白字符串", "超长文本或集合", "重复请求", "未知字段", "依赖超时或暂时不可用"]
      : ["Empty and whitespace-only input", "Very long strings or collections", "Duplicate requests", "Unknown fields", "Dependency timeout or temporary outage"],
    open_questions: openQuestions,
  };
}

function sendJson(response, status, body, headers = {}) {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(encoded),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(encoded);
}

async function readRequestBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      const error = new Error("payload_too_large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function decodePaymentRequired(value) {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
    return Array.isArray(decoded?.accepts) ? decoded : null;
  } catch {
    return null;
  }
}

function addBazaarMetadata(challenge, publicX402Url) {
  return {
    ...challenge,
    resource: {
      ...challenge.resource,
      url: publicX402Url,
      description:
        "Turn an English or Chinese API brief into deterministic JSON acceptance criteria, assumptions, edge cases, open questions, and six test cases.",
      mimeType: "application/json",
      serviceName: "Acceptance Checklist API",
      tags: ["api", "testing", "qa", "json", "bilingual"],
    },
    extensions: {
      ...challenge.extensions,
      bazaar: x402BazaarExtension,
    },
  };
}

function safeEqualText(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function verifyWebhookSignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const digest = createHmac("sha256", secret).update(rawBody).digest();
  const expectedHex = digest.toString("hex");
  const expectedBase64 = digest.toString("base64");
  const supplied = signature.trim();
  return [expectedHex, `sha256=${expectedHex}`, expectedBase64].some(
    (candidate) => safeEqualText(supplied, candidate),
  );
}

async function receiveAgentPactWebhook(
  request,
  response,
  { agentPactWebhookSecret, recordAgentPactWebhook },
) {
  if (!agentPactWebhookSecret) {
    return sendJson(response, 503, { error: "webhook_not_configured" });
  }

  let rawBody;
  try {
    rawBody = await readRequestBody(request);
  } catch (error) {
    return sendJson(response, error.statusCode ?? 400, {
      error: error.message,
    });
  }
  const signature =
    request.headers["x-agentpact-signature"] ??
    request.headers["x-webhook-signature"] ??
    request.headers["x-signature"];
  if (
    typeof signature !== "string" ||
    !verifyWebhookSignature(rawBody, signature, agentPactWebhookSecret)
  ) {
    return sendJson(response, 401, { error: "invalid_webhook_signature" });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return sendJson(response, 400, { error: "invalid_json" });
  }
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return sendJson(response, 400, { error: "invalid_event" });
  }

  try {
    await recordAgentPactWebhook?.({
      receivedAt: new Date().toISOString(),
      event,
    });
  } catch {
    return sendJson(response, 500, { error: "webhook_record_failed" });
  }
  return sendJson(response, 200, { ok: true });
}

async function proxyPayanX402(
  request,
  response,
  { fetchImpl, payanX402Url, publicX402Url },
) {
  let rawBody = null;
  try {
    if (request.method === "POST") rawBody = await readRequestBody(request);
  } catch (error) {
    return sendJson(response, error.statusCode ?? 400, {
      error: error.message,
    });
  }

  const headers = { Accept: "application/json" };
  if (rawBody?.length) {
    headers["Content-Type"] =
      request.headers["content-type"] ?? "application/json";
  }
  for (const name of [
    "payment-signature",
    "x-payment",
    "x-payment-signature",
  ]) {
    const value = request.headers[name];
    if (typeof value === "string" && value) headers[name] = value;
  }

  let upstream;
  try {
    upstream = await fetchImpl(payanX402Url, {
      method: request.method,
      headers,
      ...(rawBody?.length ? { body: rawBody } : {}),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return sendJson(response, 502, { error: "payment_route_unavailable" });
  }

  const upstreamBody = Buffer.from(await upstream.arrayBuffer());
  let paymentRequired =
    upstream.headers.get("payment-required") ??
    upstream.headers.get("x-payment-required");
  const paymentResponse =
    upstream.headers.get("payment-response") ??
    upstream.headers.get("x-payment-response");
  const extensionResponses = upstream.headers.get("extension-responses");
  const responseHeaders = {};
  if (paymentResponse) {
    responseHeaders["Payment-Response"] = paymentResponse;
    responseHeaders["X-Payment-Response"] = paymentResponse;
  }
  if (extensionResponses) {
    responseHeaders["Extension-Responses"] = extensionResponses;
  }

  if (upstream.status === 402) {
    const challenge = decodePaymentRequired(paymentRequired);
    if (challenge) {
      const discoverableChallenge = addBazaarMetadata(
        challenge,
        publicX402Url,
      );
      paymentRequired = Buffer.from(
        JSON.stringify(discoverableChallenge),
      ).toString("base64");
      responseHeaders["Payment-Required"] = paymentRequired;
      responseHeaders["X-Payment-Required"] = paymentRequired;
      return sendJson(response, 402, discoverableChallenge, responseHeaders);
    }
  }

  if (paymentRequired) {
    responseHeaders["Payment-Required"] = paymentRequired;
    responseHeaders["X-Payment-Required"] = paymentRequired;
  }

  response.writeHead(upstream.status, {
    "Content-Type":
      upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
    "Content-Length": upstreamBody.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...responseHeaders,
  });
  return response.end(upstreamBody);
}

export function createHandler({
  fetchImpl = fetch,
  payanX402Url = defaultPayanX402Url,
  publicX402Url = defaultPublicX402Url,
  agentPactWebhookSecret = null,
  recordAgentPactWebhook = null,
} = {}) {
  return async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (request.method === "GET" && pathname === "/health") {
      return sendJson(response, 200, { status: "ok", service: "api-acceptance-criteria-json-compiler" });
    }
    if (
      request.method === "GET" &&
      pathname === "/.well-known/x402-service.json"
    ) {
      return sendJson(response, 200, x402ServiceManifest);
    }
    if (
      pathname === "/x402" &&
      (request.method === "GET" || request.method === "POST")
    ) {
      return proxyPayanX402(request, response, {
        fetchImpl,
        payanX402Url,
        publicX402Url,
      });
    }
    if (pathname === "/agentpact/webhook") {
      if (request.method !== "POST") {
        return sendJson(response, 405, { error: "method_not_allowed" });
      }
      return receiveAgentPactWebhook(request, response, {
        agentPactWebhookSecret,
        recordAgentPactWebhook,
      });
    }
    if (request.method === "GET") {
      return sendJson(response, 200, {
        service: "API Acceptance Criteria JSON Compiler",
        method: "POST",
        input: { input: "API feature brief or bug report" },
        retention: "none",
      });
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204, { Allow: "GET, POST, OPTIONS" });
      return response.end();
    }
    if (request.method !== "POST") return sendJson(response, 405, { error: "method_not_allowed" });

    try {
      const raw = (await readRequestBody(request)).toString("utf8");
      const contentType = request.headers["content-type"] ?? "";
      const body = contentType.includes("application/json") ? JSON.parse(raw || "{}") : { input: raw };
      return sendJson(
        response,
        200,
        compileAcceptanceCriteria(
          body.input ??
            body.query ??
            body.brief ??
            body.requirements ??
            body.messages ??
            body,
        ),
      );
    } catch (error) {
      return sendJson(response, error.statusCode ?? 400, {
        error: error.statusCode === 413 ? "payload_too_large" : "invalid_input",
        message: error.message,
      });
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number.parseInt(process.env.AGENTICTRADE_SERVICE_PORT ?? "8788", 10);
  let agentPactWebhookSecret = null;
  try {
    const webhookConfig = JSON.parse(
      await readFile(path.resolve(".agentpact/webhook.json"), "utf8"),
    );
    agentPactWebhookSecret = webhookConfig.secret ?? null;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const recordAgentPactWebhook = async (entry) => {
    const directory = path.resolve(".agentpact");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await appendFile(
      path.join(directory, "webhook-events.ndjson"),
      `${JSON.stringify(entry)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  };
  const server = createServer(
    createHandler({ agentPactWebhookSecret, recordAgentPactWebhook }),
  );
  server.listen(port, "127.0.0.1", () => {
    console.log(JSON.stringify({ ready: true, host: "127.0.0.1", port }));
  });
}
