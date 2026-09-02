// GET /api/order?session_id=cs_... -> order summary for the thank-you page.
//
// If the webhook has not arrived yet, the session is fetched from Stripe and,
// when paid, settled here -- the buyer must never stare at "pending" because
// a webhook is slow. Session ids are long random strings; the summary carries
// no personal data.

import { json, fail, nowSec } from "../../shop/lib/http.js";
import { getOrderBySession } from "../../shop/lib/ledger.js";
import { retrieveCheckoutSession } from "../../shop/lib/stripe.js";
import { settleOrder } from "../../shop/lib/settle.js";

export async function onRequestGet({ request, env }) {
  if (!env.SHOP_DB) return fail(503, "ledger_unavailable");
  const sessionId = new URL(request.url).searchParams.get("session_id") || "";
  if (!/^cs_[A-Za-z0-9_]{10,}$/.test(sessionId)) return fail(400, "bad_session");

  let order = await getOrderBySession(env.SHOP_DB, sessionId);
  if (!order) return fail(404, "not_found");

  if (order.status === "pending" && env.STRIPE_SECRET_KEY) {
    try {
      const session = await retrieveCheckoutSession(env, sessionId, ["shipping_cost.shipping_rate"]);
      if (session.payment_status === "paid") {
        await settleOrder(env, order, session, { now: nowSec(), siteUrl: env.SHOP_SITE_URL || new URL(request.url).origin });
        order = await getOrderBySession(env.SHOP_DB, sessionId);
      }
    } catch (err) {
      console.warn(`order lookup ${order.id}: Stripe retrieve failed: ${err.message}`);
    }
  }

  const items = JSON.parse(order.items_json).map((i) => ({ number: i.number, description: i.description, price_cents: i.price_cents }));
  return json({
    id: order.id,
    status: order.status,
    lang: order.lang,
    items,
    amount_items: order.amount_items,
    amount_shipping: order.amount_shipping,
    amount_total: order.amount_total,
    shipping_option: order.shipping_option,
  });
}
