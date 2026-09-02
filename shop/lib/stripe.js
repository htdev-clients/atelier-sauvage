// Stripe over plain fetch. No SDK: the Functions bundle stays dependency-free
// (nothing in CI runs npm install for the site) and the two things we need --
// form-encoded requests and webhook signature checks -- are small.

const DEFAULT_BASE = "https://api.stripe.com";
const encoder = new TextEncoder();

// Stripe's form encoding: nested objects and arrays become bracket paths,
// e.g. line_items[0][price_data][currency]=eur.
export function encodeForm(value, prefix = "", out = new URLSearchParams()) {
  if (value === undefined || value === null) return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => encodeForm(v, `${prefix}[${i}]`, out));
  } else if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      encodeForm(v, prefix ? `${prefix}[${k}]` : k, out);
    }
  } else {
    out.append(prefix, String(value));
  }
  return out;
}

export class StripeError extends Error {
  constructor(status, body) {
    super(`Stripe ${status}: ${body?.error?.message || "request failed"}`);
    this.status = status;
    this.body = body;
  }
}

export async function stripeRequest(env, method, path, params, { idempotencyKey } = {}) {
  if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not configured");
  const base = env.STRIPE_API_BASE || DEFAULT_BASE;
  const headers = {
    authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    "content-type": "application/x-www-form-urlencoded",
  };
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  let url = `${base}${path}`;
  let body;
  const encoded = encodeForm(params || {}).toString();
  if (method === "GET") {
    if (encoded) url += `?${encoded}`;
  } else {
    body = encoded;
  }
  const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
  if (!res.ok) throw new StripeError(res.status, parsed);
  return parsed;
}

export function createCheckoutSession(env, params, idempotencyKey) {
  return stripeRequest(env, "POST", "/v1/checkout/sessions", params, { idempotencyKey });
}

export function retrieveCheckoutSession(env, id, expand = []) {
  return stripeRequest(env, "GET", `/v1/checkout/sessions/${encodeURIComponent(id)}`, expand.length ? { expand } : {});
}

export function expireCheckoutSession(env, id) {
  return stripeRequest(env, "POST", `/v1/checkout/sessions/${encodeURIComponent(id)}/expire`, {});
}

// ── Webhook signatures ────────────────────────────────────────────────────
// Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>...]
// signed payload = `${t}.${rawBody}`; HMAC-SHA256 with the endpoint secret.

export function parseSignatureHeader(header) {
  const out = { t: null, v1: [] };
  if (!header) return out;
  for (const part of header.split(",")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key === "t") out.t = Number(val);
    else if (key === "v1") out.v1.push(val);
  }
  return out;
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function signPayload(secret, timestamp, rawBody) {
  return hmacHex(secret, `${timestamp}.${rawBody}`);
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Resolves with the parsed event, or throws. `now` in seconds, injectable for tests.
export async function verifyWebhook(rawBody, header, secret, { toleranceSec = 300, now = Math.floor(Date.now() / 1000) } = {}) {
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET not configured");
  const { t, v1 } = parseSignatureHeader(header);
  if (!Number.isFinite(t) || v1.length === 0) throw new Error("malformed signature header");
  if (Math.abs(now - t) > toleranceSec) throw new Error("signature timestamp outside tolerance");
  const expected = await signPayload(secret, t, rawBody);
  if (!v1.some((candidate) => constantTimeEqual(candidate, expected))) throw new Error("signature mismatch");
  return JSON.parse(rawBody);
}
