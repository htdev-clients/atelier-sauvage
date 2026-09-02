// End-to-end against the real Functions on a local D1 (miniflare) with Stripe
// and Resend mocked. The first test is the one that matters: two concurrent
// checkouts for the same one-of-a-kind item, exactly one wins.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startHarness, TEST_ENV } from "./harness.mjs";
import { signPayload } from "../shop/lib/stripe.js";

let h;
before(async () => { h = await startHarness(); });
after(async () => { if (h) await h.stop(); });

async function checkout(items, extra = {}) {
  const res = await fetch(`${h.base}/api/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items, lang: "fr", accept_terms: true, ...extra }),
  });
  return { status: res.status, body: await res.json() };
}

async function availability() {
  const res = await fetch(`${h.base}/api/availability`);
  assert.equal(res.status, 200);
  return res.json();
}

async function webhook(event, { secret = TEST_ENV.STRIPE_WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000) } = {}) {
  const raw = JSON.stringify(event);
  const sig = await signPayload(secret, t, raw);
  const res = await fetch(`${h.base}/api/stripe-hook`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${sig}` },
    body: raw,
  });
  return { status: res.status, body: await res.json() };
}

async function mockSession(id) {
  const res = await fetch(`${h.mock.base}/v1/checkout/sessions/${id}`);
  return res.json();
}

function completedEvent(session, overrides = {}) {
  return {
    id: `evt_${session.id}_${overrides.suffix || "completed"}`,
    type: "checkout.session.completed",
    data: {
      object: {
        ...session,
        payment_status: "paid",
        payment_intent: `pi_${session.id}`,
        customer_details: { email: "buyer@example.be", name: "Buyer", phone: "+32470000000" },
        collected_information: { shipping_details: { name: "Buyer", address: { line1: "Rue 1", postal_code: "4800", city: "Verviers", country: "BE" } } },
        ...overrides,
      },
    },
  };
}

// ── validation ──────────────────────────────────────────────────────────────

test("availability starts empty", async () => {
  const av = await availability();
  assert.deepEqual(av.sold, []);
  assert.deepEqual(av.held, []);
});

test("checkout rejects bad input and unbuyable items before touching the ledger", async () => {
  assert.equal((await checkout([])).status, 400);
  assert.equal((await checkout(["24b"], { accept_terms: false })).status, 400);
  assert.equal((await checkout(["24b; DROP"])).status, 400);
  const unbuyable = await checkout(["3"]);
  assert.equal(unbuyable.status, 409);
  assert.deepEqual(unbuyable.body.unavailable, ["3"]);
  const sold = await checkout(["24b", "2"]);
  assert.equal(sold.status, 409);
  assert.deepEqual(sold.body.unavailable, ["2"]);
  assert.deepEqual((await availability()).held, [], "nothing was held by rejected requests");
});

// ── THE race ────────────────────────────────────────────────────────────────

let winner; // { order_id, session }

test("two concurrent checkouts for the same item: exactly one wins", async () => {
  const [a, b] = await Promise.all([checkout(["24b"]), checkout(["24b", "170c"])]);
  const results = [a, b];
  const ok = results.filter((r) => r.status === 200);
  const lost = results.filter((r) => r.status === 409);
  assert.equal(ok.length, 1, `expected exactly one 200, got ${JSON.stringify(results)}`);
  assert.equal(lost.length, 1);
  assert.ok(lost[0].body.unavailable.includes("24b"));
  assert.match(ok[0].body.url, /^https:\/\/checkout\.stripe\.com\//);

  const orders = h.sql("SELECT id, status, item_numbers FROM orders");
  assert.equal(orders.length, 1, "one order row -- the losing claim was rolled back");
  assert.equal(orders[0].id, ok[0].body.order_id);
  const item = h.sql("SELECT status, order_id FROM items WHERE number = '24b'")[0];
  assert.equal(item.status, "held");
  assert.equal(item.order_id, ok[0].body.order_id);

  const state = await (await fetch(`${h.mock.base}/__mock/state`)).json();
  assert.equal(state.sessions.length, 1, "Stripe saw exactly one session");
  assert.equal(state.sessions[0].client_reference_id, ok[0].body.order_id);
  assert.equal(state.sessions[0].idempotency_key, ok[0].body.order_id);
  winner = { order_id: ok[0].body.order_id, cancel_token: ok[0].body.cancel_token, session: state.sessions[0] };

  // If the two-item cart lost, 170c must be untouched: all or nothing.
  const wonTwo = JSON.parse(orders[0].item_numbers).length === 2;
  const other = h.sql("SELECT status FROM items WHERE number = '170c'");
  if (wonTwo) assert.equal(other[0].status, "held");
  else assert.ok(other.length === 0 || other[0].status === "available", "the loser's second item was not left held");
});

test("twenty-five concurrent checkouts for one item: exactly one wins, no partial holds", async () => {
  const results = await Promise.all(Array.from({ length: 25 }, () => checkout(["12", "10"])));
  const ok = results.filter((r) => r.status === 200);
  assert.equal(ok.length, 1, `statuses: ${results.map((r) => r.status).join(",")}`);
  assert.equal(results.filter((r) => r.status === 409).length, 24);
  const held = h.sql("SELECT number, order_id FROM items WHERE status = 'held' AND number IN ('12','10')");
  assert.equal(held.length, 2);
  assert.ok(held.every((r) => r.order_id === ok[0].body.order_id));
  assert.equal(h.sql("SELECT COUNT(*) AS n FROM orders WHERE item_numbers LIKE '%\"12\"%'")[0].n, 1);
  // Free them again for later tests.
  const release = await fetch(`${h.base}/api/release`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ order_id: ok[0].body.order_id, token: ok[0].body.cancel_token }),
  });
  assert.equal((await release.json()).released, true);
});

test("overlapping carts: the loser is rolled back entirely", async () => {
  const [a, b] = await Promise.all([checkout(["7", "10"]), checkout(["10"])]);
  const ok = [a, b].filter((r) => r.status === 200);
  assert.equal(ok.length, 1);
  const rows = Object.fromEntries(h.sql("SELECT number, status, order_id FROM items WHERE number IN ('7','10')").map((r) => [r.number, r]));
  assert.equal(rows["10"].status, "held");
  assert.equal(rows["10"].order_id, ok[0].body.order_id);
  if (a.status === 200) {
    assert.equal(rows["7"].order_id, a.body.order_id);
  } else {
    assert.deepEqual(a.body.unavailable, ["10"]);
    assert.ok(!rows["7"] || rows["7"].status === "available", "7 was not held by the failed two-item claim");
  }
  const release = await fetch(`${h.base}/api/release`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ order_id: ok[0].body.order_id, token: ok[0].body.cancel_token }),
  });
  assert.equal((await release.json()).released, true);
  assert.deepEqual((await availability()).held.filter((n) => n !== "24b" && n !== "170c"), []);
});

// ── webhook ─────────────────────────────────────────────────────────────────

test("checkout.session.completed sells the items, e-mails go out, replay is a no-op", async () => {
  const session = await mockSession(winner.session.id);
  const event = completedEvent(session);
  const first = await webhook(event);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.changed, true);
  assert.deepEqual(first.body.conflicts, []);

  const order = h.sql(`SELECT status, amount_total, amount_shipping, shipping_option, customer_email, emails_sent_at, email_error FROM orders WHERE id = '${winner.order_id}'`)[0];
  assert.equal(order.status, "paid");
  assert.equal(order.customer_email, "buyer@example.be");
  assert.equal(order.shipping_option, "delivery");
  assert.equal(order.amount_total, session.amount_total);
  assert.ok(order.emails_sent_at, `emails not recorded: ${order.email_error}`);
  assert.equal(h.sql("SELECT status FROM items WHERE number = '24b'")[0].status, "sold");
  assert.ok((await availability()).sold.includes("24b"));

  const state = await (await fetch(`${h.mock.base}/__mock/state`)).json();
  assert.equal(state.emails.length, 2);
  const toShop = state.emails.find((e) => e.to.includes("ateliersauvageheusy@gmail.com"));
  const toBuyer = state.emails.find((e) => e.to.includes("buyer@example.be"));
  assert.ok(toShop && toBuyer);
  assert.match(toShop.text, /réf\. 24b/);
  assert.match(toShop.text, /4800 Verviers/);

  const replay = await webhook(event);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.duplicate, true);
  assert.equal((await (await fetch(`${h.mock.base}/__mock/state`)).json()).emails.length, 2, "no second e-mail");
});

test("a paid item cannot be bought again, and a cart containing it fails as a whole", async () => {
  const res = await checkout(["7", "24b"]);
  assert.equal(res.status, 409);
  assert.deepEqual(res.body.unavailable, ["24b"]);
  assert.ok(!h.sql("SELECT status FROM items WHERE number = '7'").some((r) => r.status === "held"));
});

test("webhook with a bad signature is refused and records nothing", async () => {
  const bad = await webhook({ id: "evt_forged", type: "checkout.session.completed", data: { object: {} } }, { secret: "whsec_wrong" });
  assert.equal(bad.status, 400);
  const stale = await webhook({ id: "evt_stale", type: "checkout.session.completed", data: { object: {} } }, { t: Math.floor(Date.now() / 1000) - 3600 });
  assert.equal(stale.status, 400);
  assert.equal(h.sql("SELECT COUNT(*) AS n FROM webhook_events WHERE id IN ('evt_forged','evt_stale')")[0].n, 0);
});

test("checkout.session.expired releases the hold", async () => {
  const res = await checkout(["7"]);
  assert.equal(res.status, 200);
  assert.ok((await availability()).held.includes("7"));
  const session = await mockSession(h.sql(`SELECT stripe_session_id AS s FROM orders WHERE id = '${res.body.order_id}'`)[0].s);
  const out = await webhook({ id: `evt_${session.id}_expired`, type: "checkout.session.expired", data: { object: session } });
  assert.equal(out.body.released, true);
  assert.equal(h.sql("SELECT status FROM items WHERE number = '7'")[0].status, "available");
  assert.equal(h.sql(`SELECT status FROM orders WHERE id = '${res.body.order_id}'`)[0].status, "expired");
  assert.ok(!(await availability()).held.includes("7"));
});

test("an expired hold can be claimed by the next buyer", async () => {
  const res = await checkout(["7"]);
  assert.equal(res.status, 200);
  h.sql(`UPDATE items SET hold_expires_at = ${Math.floor(Date.now() / 1000) - 60} WHERE number = '7'`);
  const again = await checkout(["7"]);
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(h.sql("SELECT order_id FROM items WHERE number = '7'")[0].order_id, again.body.order_id);
  // The first order's release must not touch what is now someone else's hold.
  const stale = await fetch(`${h.base}/api/release`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ order_id: res.body.order_id, token: res.body.cancel_token }),
  });
  assert.equal((await stale.json()).released, true);
  assert.equal(h.sql("SELECT status, order_id FROM items WHERE number = '7'")[0].order_id, again.body.order_id);
  // Clean up.
  await fetch(`${h.base}/api/release`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ order_id: again.body.order_id, token: again.body.cancel_token }),
  });
});

test("release: wrong token is refused; a released session is expired at Stripe", async () => {
  const res = await checkout(["10"]);
  assert.equal(res.status, 200);
  const wrong = await fetch(`${h.base}/api/release`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ order_id: res.body.order_id, token: "0".repeat(32) }),
  });
  assert.equal(wrong.status, 403);
  assert.equal(h.sql("SELECT status FROM items WHERE number = '10'")[0].status, "held");
  const right = await fetch(`${h.base}/api/release`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ order_id: res.body.order_id, token: res.body.cancel_token }),
  });
  assert.equal((await right.json()).released, true);
  assert.equal(h.sql("SELECT status FROM items WHERE number = '10'")[0].status, "available");
  const sessionId = h.sql(`SELECT stripe_session_id AS s FROM orders WHERE id = '${res.body.order_id}'`)[0].s;
  assert.equal((await mockSession(sessionId)).status, "expired");
});

test("a Stripe outage after the claim releases the items", async () => {
  await fetch(`${h.mock.base}/__mock/fail-next-session`, { method: "POST" });
  const res = await checkout(["10"]);
  assert.equal(res.status, 502);
  assert.equal(h.sql("SELECT status FROM items WHERE number = '10'")[0].status, "available");
  assert.equal(h.sql("SELECT status FROM orders ORDER BY created_at DESC, rowid DESC LIMIT 1")[0].status, "failed");
});

// ── thank-you page + reconcile ──────────────────────────────────────────────

test("/api/order settles a paid session itself when the webhook is late", async () => {
  const res = await checkout(["12"]);
  assert.equal(res.status, 200);
  const sessionId = h.sql(`SELECT stripe_session_id AS s FROM orders WHERE id = '${res.body.order_id}'`)[0].s;
  let summary = await (await fetch(`${h.base}/api/order?session_id=${sessionId}`)).json();
  assert.equal(summary.status, "pending");
  // Buyer pays; Stripe knows, our webhook has not fired yet.
  await fetch(`${h.mock.base}/__mock/sessions/${sessionId}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ payment_status: "paid", status: "complete", shipping_cost: { amount_total: 0 }, customer_details: { email: "late@example.be", name: "Late" } }),
  });
  summary = await (await fetch(`${h.base}/api/order?session_id=${sessionId}`)).json();
  assert.equal(summary.status, "paid");
  assert.equal(summary.shipping_option, "pickup");
  assert.deepEqual(summary.items.map((i) => i.number), ["12"]);
  assert.equal(summary.customer_email, undefined, "no personal data on the summary");
  assert.equal(h.sql("SELECT status FROM items WHERE number = '12'")[0].status, "sold");
  // The late webhook then changes nothing and sends nothing more.
  const before = (await (await fetch(`${h.mock.base}/__mock/state`)).json()).emails.length;
  const late = await webhook(completedEvent(await mockSession(sessionId), { suffix: "late" }));
  assert.equal(late.body.changed, false);
  assert.equal((await (await fetch(`${h.mock.base}/__mock/state`)).json()).emails.length, before);
  assert.equal((await fetch(`${h.base}/api/order?session_id=cs_nope_000000000000`)).status, 404);
});

test("reconcile: bearer-authenticated, lists sales once", async () => {
  assert.equal((await fetch(`${h.base}/api/reconcile`)).status, 401);
  const headers = { authorization: `Bearer ${TEST_ENV.RECONCILE_TOKEN}`, "content-type": "application/json" };
  let sales = (await (await fetch(`${h.base}/api/reconcile`, { headers })).json()).sales;
  assert.deepEqual(sales.map((s) => s.number).sort(), ["12", "24b"]);
  const marked = await (await fetch(`${h.base}/api/reconcile`, { method: "POST", headers, body: JSON.stringify({ numbers: ["24b"] }) })).json();
  assert.equal(marked.marked, 1);
  sales = (await (await fetch(`${h.base}/api/reconcile`, { headers })).json()).sales;
  assert.deepEqual(sales.map((s) => s.number), ["12"]);
});
