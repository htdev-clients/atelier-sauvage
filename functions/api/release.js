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
  if (!order || !constantTimeEqual(order.cancel_token, token)) return fail(403, "forbidden");
  if (order.status !== "pending") return json({ released: false, status: order.status });

  // Expire the Stripe session BEFORE freeing the items: if the session stayed
  // payable, a browser-back could pay for items someone else now holds. If
  // Stripe cannot be reached, keep the hold; it lapses on its own.
  if (order.stripe_session_id && env.STRIPE_SECRET_KEY) {
    try {
      await expireCheckoutSession(env, order.stripe_session_id);
    } catch (err) {
      const alreadyClosed = err.status === 400 && /not open|already/i.test(err.body?.error?.message || "");
      if (!alreadyClosed) {
        console.warn(`release ${order.id}: could not expire session: ${err.message}`);
        return json({ released: false, status: "pending" }, 503);
      }
    }
  }
  await releaseOrder(env.SHOP_DB, order.id, nowSec(), "released");
  await invalidateAvailability(env);
  return json({ released: true });
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
