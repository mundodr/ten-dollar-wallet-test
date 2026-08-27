import { readFile } from "node:fs/promises";
import path from "node:path";
import { compileAcceptanceCriteria } from "./agentictrade-service-api.mjs";

const apiBase = "https://api.useatelier.ai/api";
const serviceId = "svc_1787852818130_ohbyd94n1";
const credentials = JSON.parse(
  await readFile(path.resolve(".atelier/credentials.json"), "utf8"),
);
const authHeaders = {
  Accept: "application/json",
  Authorization: `Bearer ${credentials.apiKey}`,
};

async function requestJson(route, options = {}) {
  const response = await fetch(`${apiBase}${route}`, {
    ...options,
    headers: {
      ...authHeaders,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { nonJsonResponse: text.slice(0, 500) };
  }
  if (!response.ok || body?.success === false) {
    throw new Error(
      `Atelier ${options.method ?? "GET"} ${route} failed (${response.status}): ${body?.error?.message ?? body?.error ?? body?.message ?? "unknown error"}`,
    );
  }
  return body?.data ?? body;
}

function listFrom(data, key) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.[key])) return data[key];
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function orderInput(order) {
  const brief =
    order?.brief ??
    order?.requirements?.brief ??
    order?.requirement_values?.brief ??
    order?.requirement_values?.Scope ??
    order?.requirements ??
    order?.requirement_values;
  const revision =
    order?.revision_notes ??
    order?.revision_request ??
    order?.revision_feedback ??
    null;
  if (!revision) return brief;
  return {
    brief,
    revision_request: revision,
  };
}

async function uploadJson(orderId, result) {
  const form = new FormData();
  const encoded = `${JSON.stringify(result, null, 2)}\n`;
  form.append(
    "file",
    new Blob([encoded], { type: "application/json" }),
    `acceptance-checklist-${orderId}.json`,
  );
  const response = await fetch(`${apiBase}/upload`, {
    method: "POST",
    headers: authHeaders,
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success === false) {
    throw new Error(
      `Atelier upload failed (${response.status}): ${body?.error?.message ?? body?.error ?? "unknown error"}`,
    );
  }
  const uploaded = body?.data ?? body;
  if (!uploaded?.url) throw new Error("Atelier upload returned no deliverable URL");
  return uploaded;
}

const response = await requestJson(
  `/agents/${credentials.agentId}/orders?status=paid,in_progress,revision_requested`,
);
const orders = listFrom(response, "orders").filter(
  (order) => order?.service_id === serviceId,
);
const processed = [];

for (const order of orders) {
  const orderId = order?.id ?? order?.order_id;
  if (!orderId) continue;
  try {
    const detail = await requestJson(`/orders/${encodeURIComponent(orderId)}`);
    const completeOrder = detail?.order ?? detail ?? order;
    const input = orderInput(completeOrder) ?? orderInput(order);
    const result = compileAcceptanceCriteria(input);
    const uploaded = await uploadJson(orderId, result);
    const delivered = await requestJson(`/orders/${encodeURIComponent(orderId)}/deliver`, {
      method: "POST",
      body: JSON.stringify({
        deliverable_url: uploaded.url,
        deliverable_media_type: uploaded.media_type ?? "document",
      }),
    });
    processed.push({
      orderId,
      status: "delivered",
      deliverableUrl: uploaded.url,
      platformStatus: delivered?.status ?? delivered?.order?.status ?? null,
    });
  } catch (error) {
    processed.push({
      orderId,
      status: "error",
      error: error?.message ?? String(error),
    });
  }
}

console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      agentId: credentials.agentId,
      serviceId,
      actionableOrderCount: orders.length,
      processed,
    },
    null,
    2,
  ),
);

if (processed.some((item) => item.status === "error")) process.exitCode = 1;
