// Turning a paid Stripe session into a sold order. Called from the webhook
// (normal path) and from /api/order when the thank-you page arrives before
// the webhook does. Idempotent: the second caller finds the order paid.

import { markPaid, getOrder, recordEmails, releaseOrder } from "./ledger.js";
import { expireCheckoutSession } from "./stripe.js";
import { sendOrderEmails } from "./email.js";
import { invalidateAvailability } from "./cache.js";

export function sessionDetails(session) {
  const shipping = session.collected_information?.shipping_details || session.shipping_details || null;
  const customer = session.customer_details || {};
  const shippingCost = session.shipping_cost?.amount_total ?? 0;
  const rate = session.shipping_cost?.shipping_rate;
  const optionFromRate = typeof rate === "object" && rate ? rate.metadata?.option : null;
  const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  return {
    session_id: session.id,
    payment_intent: paymentIntent || null,
    amount_total: session.amount_total ?? null,
    amount_shipping: shippingCost,
    // From the rate's metadata when the session was retrieved with
    // shipping_cost.shipping_rate expanded; otherwise pickup is the only
    // zero-cost option we offer.
    shipping_option: optionFromRate || (shippingCost === 0 ? "pickup" : "delivery"),
    email: customer.email || null,
    name: shipping?.name || customer.name || null,
    phone: customer.phone || null,
    address: shipping?.address || customer.address || null,
  };
}

export async function settleOrder(env, order, session, { now, siteUrl }) {
  if (order.status === "paid") return { changed: false, conflicts: [] };
  const db = env.SHOP_DB;
  const { changed, conflicts, displaced } = await markPaid(db, order, sessionDetails(session), now);
  await invalidateAvailability(env);
  if (!changed) return { changed: false, conflicts };

  // This payment took items out from under other pending orders (their hold
  // had lapsed). Close those orders now, and expire their Stripe sessions so
  // the other buyer cannot still pay for what is gone.
  for (const otherId of displaced) {
    try {
      const other = await getOrder(db, otherId);
      await releaseOrder(db, otherId, now, "expired");
      if (other?.stripe_session_id && env.STRIPE_SECRET_KEY) await expireCheckoutSession(env, other.stripe_session_id);
    } catch (err) {
      console.error(`order ${order.id}: could not close displaced order ${otherId}: ${err.message}`);
    }
  }

  // From here on the sale is recorded; anything that fails is an e-mail
  // problem, recorded on the order so the reconcile job retries it.
  const fresh = await getOrder(db, order.id);
  try {
    const items = JSON.parse(fresh.items_json);
    await sendOrderEmails(env, fresh, items, { conflicts, siteUrl });
    await recordEmails(db, order.id, now);
  } catch (err) {
    console.error(`order ${order.id}: e-mail failed: ${err.message}`);
    await recordEmails(db, order.id, now, String(err.message).slice(0, 500));
  }
  return { changed: true, conflicts };
}
