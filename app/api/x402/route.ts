const PAYAN_X402_URL =
  "https://payanagent.com/x402/kh7ezjzt4etk8x1s908z7wngqn8d89hx";

function decodePaymentRequired(value: string | null) {
  if (!value) return null;
  try {
    const bytes = Uint8Array.from(atob(value), (character) =>
      character.charCodeAt(0),
    );
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function encodePaymentRequired(value: Record<string, unknown>) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function proxyPayan(request: Request) {
  const upstreamHeaders = new Headers({ Accept: "application/json" });
  for (const header of [
    "content-type",
    "payment-signature",
    "x-payment",
    "x-payment-signature",
  ]) {
    const value = request.headers.get(header);
    if (value) upstreamHeaders.set(header, value);
  }

  let body: ArrayBuffer | undefined;
  if (request.method === "POST") {
    body = await request.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(PAYAN_X402_URL, {
      method: request.method,
      headers: upstreamHeaders,
      ...(body?.byteLength ? { body } : {}),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return Response.json(
      { error: "payment_route_unavailable" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }

  const responseHeaders = new Headers({
    "cache-control": "no-store",
    "content-type": upstream.headers.get("content-type") ?? "application/json",
  });
  const paymentResponse =
    upstream.headers.get("payment-response") ??
    upstream.headers.get("x-payment-response");
  if (paymentResponse) {
    responseHeaders.set("payment-response", paymentResponse);
    responseHeaders.set("x-payment-response", paymentResponse);
  }
  const extensionResponses = upstream.headers.get("extension-responses");
  if (extensionResponses) {
    responseHeaders.set("extension-responses", extensionResponses);
  }

  const encodedChallenge =
    upstream.headers.get("payment-required") ??
    upstream.headers.get("x-payment-required");
  if (upstream.status === 402) {
    const challenge = decodePaymentRequired(encodedChallenge);
    if (challenge) {
      const resource =
        challenge.resource && typeof challenge.resource === "object"
          ? (challenge.resource as Record<string, unknown>)
          : {};
      const publicUrl = new URL("/api/x402", request.url).toString();
      const publicChallenge = {
        ...challenge,
        resource: {
          ...resource,
          url: publicUrl,
          serviceName: "Acceptance Checklist API",
        },
      };
      const publicHeader = encodePaymentRequired(publicChallenge);
      responseHeaders.set("payment-required", publicHeader);
      responseHeaders.set("x-payment-required", publicHeader);
      return Response.json(publicChallenge, {
        status: 402,
        headers: responseHeaders,
      });
    }
  }

  if (encodedChallenge) {
    responseHeaders.set("payment-required", encodedChallenge);
    responseHeaders.set("x-payment-required", encodedChallenge);
  }
  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export async function GET(request: Request) {
  return proxyPayan(request);
}

export async function POST(request: Request) {
  return proxyPayan(request);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { allow: "GET, POST, OPTIONS" },
  });
}
