// POST /api/checkout  { items: ["24b", ...], lang: "fr", accept_terms: true }
//
// 1. Read prices and sellability from the build (catalogue.json), never from
//    the request.
// 2. Claim every item in one D1 transaction -- all or nothing.
// 3. Create the Stripe Checkout Session. If Stripe fails, release the claim.
//
// Responses: 200 { url, order_id, cancel_token }
//            409 { error: "unavailable", unavailable: [...] }

import { json, fail, readJson, nowSec, pickLang, langPrefix, parseNumbers } from "../../shop/lib/http.js";
import { loadCatalog, selectBuyable } from "../../shop/lib/catalog.js";
import { shippingOptions, consignment, ALLOWED_COUNTRIES } from "../../shop/lib/shipping.js";
import { strings } from "../../shop/lib/i18n.js";
import { claimItems, releaseOrder, attachSession, newOrderId, newToken, pendingLoad, HOLD_GRACE_SEC } from "../../shop/lib/ledger.js";
import { createCheckoutSession } from "../../shop/lib/stripe.js";
import { invalidateAvailability } from "../../shop/lib/cache.js";

// Stripe requires expires_at at least 30 minutes out; 31 leaves room for clock skew.
const SESSION_MINUTES = 31;

// Holds are free to open, so cap them: per address, and overall as a circuit
// breaker. A real buyer never opens more than a couple of checkouts in ten
// minutes; a script trying to reserve the whole catalogue does. (A Turnstile
// challenge or a Cloudflare rate-limiting rule on /api/checkout is the
// stronger fix; see docs/shop-runbook.md.)
const LOAD_WINDOW_SEC = 10 * 60;
const MAX_PENDING_PER_IP = 3;
const MAX_PENDING_TOTAL = 40;

async function ipHash(request) {
  const ip = request.headers.get("cf-connecting-ip") || "0.0.0.0";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`as-shop|${ip}`));
  return Array.from(new Uint8Array(digest)).slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost({ request, env }) {
  if (!env.SHOP_DB) return fail(503, "ledger_unavailable");
  if (!env.STRIPE_SECRET_KEY) return fail(503, "payments_unavailable");

  const body = await readJson(request);
  if (!body) return fail(400, "bad_json");
  const numbers = parseNumbers(body.items);
  if (!numbers) return fail(400, "bad_items");
  if (body.accept_terms !== true) return fail(400, "terms_required");
  const lang = pickLang(body.lang);
  const s = strings(lang);

  const catalog = await loadCatalog(env, request);
  const { items, rejected } = selectBuyable(catalog, numbers);
  if (rejected.length) return fail(409, "unavailable", { unavailable: rejected });

  const bands = items.map((i) => i.transport);
  const options = shippingOptions(bands, s);
  if (!options) return fail(409, "unavailable", { unavailable: numbers });

  const now = nowSec();
  const hash = await ipHash(request);
  const load = await pendingLoad(env.SHOP_DB, hash, now - LOAD_WINDOW_SEC);
  if (load.mine >= MAX_PENDING_PER_IP || load.total >= MAX_PENDING_TOTAL) {
    return fail(429, "too_many_checkouts", { retry_after: LOAD_WINDOW_SEC });
  }

  const expiresAt = now + SESSION_MINUTES * 60;
  const order = {
    id: newOrderId(),
    lang,
    hold_expires_at: expiresAt + HOLD_GRACE_SEC,
    amount_items: items.reduce((sum, i) => sum + i.price_cents, 0),
    shipping_band: consignment(bands).band,
    cancel_token: newToken(),
    ip_hash: hash,
  };

  const claim = await claimItems(env.SHOP_DB, { items, order, now });
  if (!claim.ok) return fail(409, "unavailable", { unavailable: claim.unavailable });
  await invalidateAvailability(env);

  const origin = new URL(request.url).origin;
  const assetBase = env.SHOP_ASSET_BASE || origin;
  const prefix = langPrefix(lang);

  const params = {
    mode: "payment",
    client_reference_id: order.id,
    locale: lang,
    expires_at: expiresAt,
    success_url: `${origin}${prefix}/merci/?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}${prefix}/panier/?cancelled=1`,
    line_items: items.map((i) => ({
      quantity: 1,
      price_data: {
        currency: "eur",
        unit_amount: i.price_cents,
        product_data: {
          name: i.description,
          images: [`${assetBase}/assets/img/catalog/800/${i.number}-800.webp`],
          metadata: { number: i.number },
        },
      },
    })),
    shipping_address_collection: { allowed_countries: ALLOWED_COUNTRIES },
    shipping_options: options.map((o) => ({
      shipping_rate_data: {
        type: "fixed_amount",
        fixed_amount: { amount: o.amount, currency: "eur" },
        display_name: o.display_name,
        metadata: { option: o.key },
        ...(o.delivery_estimate ? { delivery_estimate: o.delivery_estimate } : {}),
      },
    })),
    phone_number_collection: { enabled: true },
    custom_text: { shipping_address: { message: s.shipping_message } },
    metadata: { order_id: order.id, items: numbers.join(","), shop_env: env.SHOP_ENV || "" },
    payment_intent_data: {
      description: `Atelier Sauvage ${order.id}`,
      metadata: { order_id: order.id, items: numbers.join(",") },
    },
  };

  let session;
  try {
    session = await createCheckoutSession(env, params, order.id);
  } catch (err) {
    console.error(`checkout ${order.id}: Stripe failed: ${err.message}`);
    await releaseOrder(env.SHOP_DB, order.id, nowSec(), "failed");
    await invalidateAvailability(env);
    return fail(502, "payment_provider_error");
  }
  await attachSession(env.SHOP_DB, order.id, session.id, now);

  return json({ url: session.url, order_id: order.id, cancel_token: order.cancel_token });
}
