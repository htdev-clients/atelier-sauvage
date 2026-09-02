// POST /api/release { order_id, token }
// The buyer backed out of Checkout: free their items now rather than in 36
// minutes, and expire the Stripe session so it cannot be paid later.

import { json, fail, readJson, nowSec } from "../../shop/lib/http.js";
import { getOrder, releaseOrder } from "../../shop/lib/ledger.js";
import { expireCheckoutSession } from "../../shop/lib/stripe.js";
import { invalidateAvailability } from "../../shop/lib/cache.js";

export async function onRequestPost({ request, env }) {
  if (!env.SHOP_DB) return fail(503, "ledger_unavailable");
  const body = await readJson(request);
  const orderId = typeof body?.order_id === "string" ? body.order_id : "";
  const token = typeof body?.token === "string" ? body.token : "";
  if (!/^AS-[A-Z2-9]{8}$/.test(orderId) || !/^[a-z0-9]{32}$/.test(token)) return fail(400, "bad_request");

  const order = await getOrder(env.SHOP_DB, orderId);
  if (!order || order.cancel_token !== token) return fail(403, "forbidden");
  if (order.status !== "pending") return json({ released: false, status: order.status });

  await releaseOrder(env.SHOP_DB, order.id, nowSec(), "released");
  await invalidateAvailability(env);
  if (order.stripe_session_id && env.STRIPE_SECRET_KEY) {
    try {
      await expireCheckoutSession(env, order.stripe_session_id);
    } catch (err) {
      console.warn(`release ${order.id}: could not expire session: ${err.message}`);
    }
  }
  return json({ released: true });
}
