// Write-back API for the scheduled reconcile job (.github/workflows/reconcile.yml).
//   GET  /api/reconcile            -> { sales: [{ number, order_id, sold_at }] } not yet in the Sheet
//   POST /api/reconcile { numbers } -> marks them written
// Bearer-authenticated with RECONCILE_TOKEN, so the job needs no Cloudflare
// token of its own.

import { json, fail, readJson, nowSec, parseNumbers } from "../../shop/lib/http.js";
import { unwrittenSales, markWritten, ordersWithFailedEmails, recordEmails } from "../../shop/lib/ledger.js";
import { sendOrderEmails } from "../../shop/lib/email.js";

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
  const now = nowSec();

  // Second chance for order e-mails that failed at settlement time: the shop
  // notification is what reaches the carrier, so a Resend outage must not
  // lose it. Retried here because this endpoint is called every 15 minutes.
  const retried = [];
  for (const order of await ordersWithFailedEmails(env.SHOP_DB, now - 7 * 86400)) {
    try {
      await sendOrderEmails(env, order, JSON.parse(order.items_json), {
        conflicts: order.conflict_items ? JSON.parse(order.conflict_items) : [],
        siteUrl: env.SHOP_SITE_URL || new URL(request.url).origin,
      });
      await recordEmails(env.SHOP_DB, order.id, now);
      retried.push({ order: order.id, sent: true });
    } catch (err) {
      await recordEmails(env.SHOP_DB, order.id, now, String(err.message).slice(0, 500));
      retried.push({ order: order.id, sent: false, error: err.message });
    }
  }

  return json({ sales: await unwrittenSales(env.SHOP_DB), email_retries: retried, generated: now });
}

export async function onRequestPost({ request, env }) {
  if (!env.SHOP_DB) return fail(503, "ledger_unavailable");
  if (!authorised(request, env)) return fail(401, "unauthorised");
  const body = await readJson(request);
  const numbers = parseNumbers(body?.numbers, 500);
  if (!numbers) return fail(400, "bad_numbers");
  return json({ marked: await markWritten(env.SHOP_DB, numbers, nowSec()) });
}
