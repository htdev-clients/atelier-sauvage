// POST /api/stripe-hook -- Stripe webhook endpoint.
//
// The raw body is read with request.text() BEFORE anything parses it, because
// the signature covers the exact bytes Stripe sent. Every event id is recorded
// first; a redelivery is answered 200 without doing anything twice.

import { json, fail, nowSec } from "../../shop/lib/http.js";
import { verifyWebhook } from "../../shop/lib/stripe.js";
import { recordWebhookEvent, forgetWebhookEvent, pruneWebhookEvents, getOrder, releaseOrder, extendHold } from "../../shop/lib/ledger.js";
import { retrieveCheckoutSession } from "../../shop/lib/stripe.js";
import { settleOrder } from "../../shop/lib/settle.js";
import { invalidateAvailability } from "../../shop/lib/cache.js";

const ASYNC_PAYMENT_GRACE_SEC = 2 * 24 * 3600;

export async function onRequestPost({ request, env }) {
  if (!env.SHOP_DB) return fail(503, "ledger_unavailable");
  const raw = await request.text();
  let event;
  try {
    event = await verifyWebhook(raw, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return fail(400, "bad_signature");
  }
  if (!event?.id || !event?.type) return fail(400, "bad_event");

  const now = nowSec();
  const first = await recordWebhookEvent(env.SHOP_DB, event.id, event.type, now);
  if (!first) return json({ received: true, duplicate: true });

  try {
    return await handle(event, env, request, now);
  } catch (err) {
    // The event was recorded before it was handled. Forget it again so that
    // Stripe's retry is not answered "duplicate" and silently dropped.
    console.error(`webhook ${event.id}: ${err.message}`);
    await forgetWebhookEvent(env.SHOP_DB, event.id);
    return fail(500, "handler_failed");
  }
}

async function handle(event, env, request, now) {
  let session = event.data?.object || {};
  const orderId = session.client_reference_id || session.metadata?.order_id;
  if (!orderId || !event.type.startsWith("checkout.session.")) return json({ received: true, ignored: true });

  const order = await getOrder(env.SHOP_DB, orderId);
  if (!order) {
    console.warn(`webhook ${event.id}: unknown order ${orderId}`);
    return json({ received: true, ignored: true });
  }

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      if (session.payment_status === "paid") {
        // Re-read the session from Stripe with the chosen shipping rate
        // expanded; the payload only carries its id. Fall back to the payload.
        try {
          const fresh = await retrieveCheckoutSession(env, session.id, ["shipping_cost.shipping_rate"]);
          session = { ...session, ...fresh };
        } catch (err) {
          console.warn(`webhook ${event.id}: retrieve failed, using payload: ${err.message}`);
        }
        const result = await settleOrder(env, order, session, { now, siteUrl: siteUrl(request, env) });
        if (Math.random() < 0.02) await pruneWebhookEvents(env.SHOP_DB, now - 30 * 86400);
        return json({ received: true, ...result });
      }
      // Payment method still settling (async). Keep the hold well past the session.
      await extendHold(env.SHOP_DB, order.id, now + ASYNC_PAYMENT_GRACE_SEC);
      return json({ received: true, awaiting_payment: true });
    }
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired": {
      await releaseOrder(env.SHOP_DB, order.id, now, "expired");
      await invalidateAvailability(env);
      return json({ received: true, released: true });
    }
    default:
      return json({ received: true, ignored: true });
  }
}

function siteUrl(request, env) {
  return env.SHOP_SITE_URL || new URL(request.url).origin;
}
