// Write-back API for the scheduled reconcile job (.github/workflows/reconcile.yml).
//   GET  /api/reconcile            -> { sales: [{ number, order_id, sold_at }] } not yet in the Sheet
//   POST /api/reconcile { numbers } -> marks them written
// Bearer-authenticated with RECONCILE_TOKEN, so the job needs no Cloudflare
// token of its own.

import { json, fail, readJson, nowSec, parseNumbers } from "../../shop/lib/http.js";
import { unwrittenSales, markWritten } from "../../shop/lib/ledger.js";

function authorised(request, env) {
  const expected = env.RECONCILE_TOKEN;
  if (!expected) return false;
  const header = request.headers.get("authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function onRequestGet({ request, env }) {
  if (!env.SHOP_DB) return fail(503, "ledger_unavailable");
  if (!authorised(request, env)) return fail(401, "unauthorised");
  return json({ sales: await unwrittenSales(env.SHOP_DB), generated: nowSec() });
}

export async function onRequestPost({ request, env }) {
  if (!env.SHOP_DB) return fail(503, "ledger_unavailable");
  if (!authorised(request, env)) return fail(401, "unauthorised");
  const body = await readJson(request);
  const numbers = parseNumbers(body?.numbers, 500);
  if (!numbers) return fail(400, "bad_numbers");
  return json({ marked: await markWritten(env.SHOP_DB, numbers, nowSec()) });
}
