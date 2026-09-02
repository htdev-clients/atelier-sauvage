// POST /api/stripe-hook -- Stripe webhook endpoint.
//
// The raw body is read with request.text() BEFORE anything parses it, because
// the signature covers the exact bytes Stripe sent. Every event id is recorded
// first; a redelivery is answered 200 without doing anything twice.

import { json, fail, nowSec } from "../../shop/lib/http.js";
import { verifyWebhook } from "../../shop/lib/stripe.js";
import { recordWebhookEvent, getOrder, releaseOrder, extendHold } from "../../shop/lib/ledger.js";
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

  const session = event.data?.object || {};
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
        const result = await settleOrder(env, order, session, { now, siteUrl: siteUrl(request, env) });
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
