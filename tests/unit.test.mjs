import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeForm, parseSignatureHeader, signPayload, verifyWebhook } from "../shop/lib/stripe.js";
import { consignment, largestBand, shippingOptions } from "../shop/lib/shipping.js";
import { parseNumbers, pickLang, langPrefix } from "../shop/lib/http.js";
import { selectBuyable } from "../shop/lib/catalog.js";
import { buyerEmail, shopEmail } from "../shop/lib/email.js";
import { newOrderId, newToken } from "../shop/lib/ledger.js";

test("encodeForm flattens nested params the way Stripe expects", () => {
  const out = encodeForm({
    mode: "payment",
    line_items: [{ quantity: 1, price_data: { currency: "eur", unit_amount: 4500, product_data: { name: "Vase" } } }],
    metadata: { order_id: "AS-1" },
    expand: ["shipping_cost.shipping_rate"],
  });
  assert.equal(out.get("mode"), "payment");
  assert.equal(out.get("line_items[0][price_data][unit_amount]"), "4500");
  assert.equal(out.get("line_items[0][price_data][product_data][name]"), "Vase");
  assert.equal(out.get("metadata[order_id]"), "AS-1");
  assert.equal(out.get("expand[0]"), "shipping_cost.shipping_rate");
  assert.equal(encodeForm({ a: null, b: undefined, c: 0 }).toString(), "c=0");
});

test("webhook signature: valid, tampered, stale, malformed", async () => {
  const secret = "whsec_unit";
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
  const t = 1_800_000_000;
  const sig = await signPayload(secret, t, body);
  const header = `t=${t},v1=${sig}`;
  assert.deepEqual(parseSignatureHeader(header), { t, v1: [sig] });

  const event = await verifyWebhook(body, header, secret, { now: t + 10 });
  assert.equal(event.id, "evt_1");
  await assert.rejects(verifyWebhook(body + " ", header, secret, { now: t }), /mismatch/);
  await assert.rejects(verifyWebhook(body, header, "whsec_other", { now: t }), /mismatch/);
  await assert.rejects(verifyWebhook(body, header, secret, { now: t + 301 }), /tolerance/);
  await assert.rejects(verifyWebhook(body, "garbage", secret, { now: t }), /malformed/);
  await assert.rejects(verifyWebhook(body, header, "", { now: t }), /not configured/);
  // A header with several v1 entries (key rotation) passes if any matches.
  const rotated = `t=${t},v1=deadbeef,v1=${sig}`;
  assert.equal((await verifyWebhook(body, rotated, secret, { now: t })).id, "evt_1");
});

test("shipping: the largest band sets the base, extras add a surcharge", () => {
  assert.equal(largestBand(["S", "L", "M"]), "L");
  assert.deepEqual(consignment(["S"]), { band: "S", base: 1500, extras: 0, total: 1500 });
  assert.deepEqual(consignment(["S", "M"]), { band: "M", base: 3500, extras: 1000, total: 4500 });
  assert.deepEqual(consignment(["XL", "S", "S"]), { band: "XL", base: 14000, extras: 2000, total: 16000 });
  assert.equal(consignment([]), null);
  assert.equal(consignment(["S", ""]), null);
  const options = shippingOptions(["M", "S"], { delivery: "D", pickup: "P" });
  assert.equal(options.length, 2);
  assert.equal(options[0].key, "delivery");
  assert.equal(options[0].amount, 4500);
  assert.equal(options[1].key, "pickup");
  assert.equal(options[1].amount, 0);
});

test("request parsing: item numbers, language", () => {
  assert.deepEqual(parseNumbers(["24b", " 170c ", "24b"]), ["24b", "170c"]);
  assert.equal(parseNumbers([]), null);
  assert.equal(parseNumbers(["24b; DROP TABLE"]), null);
  assert.equal(parseNumbers([24]), null);
  assert.equal(parseNumbers(Array.from({ length: 11 }, (_, i) => `n${i}`)), null);
  assert.equal(pickLang("de"), "de");
  assert.equal(pickLang("xx"), "fr");
  assert.equal(langPrefix("fr"), "");
  assert.equal(langPrefix("nl"), "/nl");
});

test("catalog: only buyable items with a positive price are accepted", () => {
  const catalog = {
    items: {
      a: { description: "A", price_cents: 100, transport: "S", buyable: true },
      b: { description: "B", price_cents: 100, transport: "", buyable: false },
      c: { description: "C", price_cents: null, transport: "S", buyable: true },
    },
  };
  const { items, rejected } = selectBuyable(catalog, ["a", "b", "c", "zzz"]);
  assert.deepEqual(items.map((i) => i.number), ["a"]);
  assert.deepEqual(rejected, ["b", "c", "zzz"]);
});

test("emails carry the item numbers, band and address the carrier needs", () => {
  const order = {
    id: "AS-TEST1234", lang: "nl", amount_shipping: 4500, amount_total: 34000, shipping_option: "delivery",
    shipping_band: "M", customer_name: "Jan", customer_email: "jan@example.be", customer_phone: "+32 470 00 00 00",
    shipping_address: JSON.stringify({ line1: "Rue X 1", postal_code: "4800", city: "Verviers", country: "BE" }),
    stripe_payment_intent: "pi_1",
  };
  const items = [{ number: "24b", description: "Vase", price_cents: 4500, transport: "S" }, { number: "170c", description: "Lampe", price_cents: 25000, transport: "M" }];
  const buyer = buyerEmail(order, items, "https://example.test");
  assert.match(buyer.subject, /AS-TEST1234/);
  assert.match(buyer.html, /Vase/);
  assert.match(buyer.html, /https:\/\/example.test\/nl\/cgv\//);
  assert.match(buyer.text, /Betaald totaal : 340 €/);
  const shop = shopEmail(order, items, ["170c"]);
  assert.match(shop.subject, /CONFLIT/);
  assert.match(shop.text, /réf\. 24b/);
  assert.match(shop.text, /transport M/);
  assert.match(shop.text, /4800 Verviers/);
  assert.match(shop.text, /\+32 470 00 00 00/);
});

test("identifiers", () => {
  assert.match(newOrderId(), /^AS-[A-Z2-9]{8}$/);
  assert.match(newToken(), /^[a-z0-9]{32}$/);
  assert.notEqual(newOrderId(), newOrderId());
});
