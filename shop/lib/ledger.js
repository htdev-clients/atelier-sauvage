// The ledger: every read and write against D1 lives here.
//
// The claim is the whole design. Claiming N items is one D1 batch -- a SQL
// transaction -- whose last statement inserts the order row with
// claimed_count = (rows the UPDATE actually held). A CHECK constraint on
// orders requires claimed_count = expected_count, so a partial claim fails the
// INSERT, D1 rolls the batch back, and nothing stays held. Exactly one of two
// concurrent claims on the same item can succeed.

export const HOLD_GRACE_SEC = 5 * 60; // hold outlives the Stripe session by this much

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

function randomString(length, alphabet) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export function newOrderId() {
  return `AS-${randomString(8, ALPHABET)}`;
}

export function newToken() {
  return randomString(32, "abcdefghijklmnopqrstuvwxyz0123456789");
}

function placeholders(n) {
  return Array.from({ length: n }, () => "?").join(",");
}

// Attempts to hold every item in `items` for `order`. Returns
//   { ok: true } or { ok: false, unavailable: [...numbers] }.
export async function claimItems(db, { items, order, now }) {
  const numbers = items.map((i) => i.number);
  const n = numbers.length;
  const ph = placeholders(n);

  const statements = numbers.map((number) =>
    db.prepare("INSERT OR IGNORE INTO items (number, status, updated_at) VALUES (?, 'available', ?)").bind(number, now)
  );

  statements.push(
    db.prepare(
      `UPDATE items
          SET status = 'held', hold_expires_at = ?, order_id = ?, updated_at = ?
        WHERE number IN (${ph})
          AND (status = 'available' OR (status = 'held' AND hold_expires_at < ?))`
    ).bind(order.hold_expires_at, order.id, now, ...numbers, now)
  );

  statements.push(
    db.prepare(
      `INSERT INTO orders (id, status, expected_count, claimed_count, lang, item_numbers, items_json,
                           amount_items, shipping_band, cancel_token, created_at, hold_expires_at)
       VALUES (?, 'pending', ?,
               (SELECT COUNT(*) FROM items WHERE order_id = ? AND status = 'held' AND number IN (${ph})),
               ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      order.id, n, order.id, ...numbers,
      order.lang, JSON.stringify(numbers), JSON.stringify(items),
      order.amount_items, order.shipping_band, order.cancel_token, now, order.hold_expires_at
    )
  );

  try {
    await db.batch(statements);
    return { ok: true };
  } catch (err) {
    const message = String(err?.message || err);
    if (!/CHECK constraint failed|constraint failed/i.test(message)) throw err;
    return { ok: false, unavailable: await unavailableAmong(db, numbers, now) };
  }
}

export async function unavailableAmong(db, numbers, now) {
  if (!numbers.length) return [];
  const { results } = await db
    .prepare(`SELECT number FROM items WHERE number IN (${placeholders(numbers.length)})
                AND (status = 'sold' OR (status = 'held' AND hold_expires_at >= ?))`)
    .bind(...numbers, now)
    .all();
  return results.map((r) => r.number);
}

// Releases whatever this order still holds. Safe to call repeatedly and after
// the hold has been taken over by someone else (WHERE order_id = ? then matches nothing).
export async function releaseOrder(db, orderId, now, status = "released") {
  await db.batch([
    db.prepare(
      `UPDATE items SET status = 'available', hold_expires_at = NULL, order_id = NULL, updated_at = ?
        WHERE order_id = ? AND status = 'held'`
    ).bind(now, orderId),
    db.prepare(
      `UPDATE orders SET status = ?, closed_at = ? WHERE id = ? AND status = 'pending'`
    ).bind(status, now, orderId),
  ]);
}

export async function attachSession(db, orderId, sessionId, now) {
  await db.prepare("UPDATE orders SET stripe_session_id = ? WHERE id = ?").bind(sessionId, orderId).run();
}

export async function extendHold(db, orderId, until) {
  await db.batch([
    db.prepare("UPDATE items SET hold_expires_at = ? WHERE order_id = ? AND status = 'held'").bind(until, orderId),
    db.prepare("UPDATE orders SET hold_expires_at = ? WHERE id = ?").bind(until, orderId),
  ]);
}

// Marks the order paid and its items sold. A paid order takes the item even if
// the hold had lapsed and someone else re-held it -- money has changed hands.
// If the item was ALREADY sold to another paid order, it stays there and this
// order is flagged with conflict_items so the shop can refund.
// Returns { changed: boolean, conflicts: [...] }.
export async function markPaid(db, order, details, now) {
  const numbers = JSON.parse(order.item_numbers);
  const ph = placeholders(numbers.length);
  const res = await db.batch([
    db.prepare(
      `UPDATE items SET status = 'sold', sold_at = ?, order_id = ?, hold_expires_at = NULL, updated_at = ?
        WHERE number IN (${ph}) AND NOT (status = 'sold' AND order_id <> ?)`
    ).bind(now, order.id, now, ...numbers, order.id),
    db.prepare(`SELECT number FROM items WHERE number IN (${ph}) AND order_id <> ?`).bind(...numbers, order.id),
    db.prepare(
      `UPDATE orders
          SET status = 'paid', paid_at = ?, closed_at = ?, amount_shipping = ?, amount_total = ?,
              shipping_option = ?, stripe_payment_intent = ?, customer_email = ?, customer_name = ?,
              customer_phone = ?, shipping_address = ?, stripe_session_id = COALESCE(stripe_session_id, ?)
        WHERE id = ? AND status <> 'paid'`
    ).bind(
      now, now, details.amount_shipping ?? null, details.amount_total ?? null,
      details.shipping_option ?? null, details.payment_intent ?? null, details.email ?? null,
      details.name ?? null, details.phone ?? null,
      details.address ? JSON.stringify(details.address) : null,
      details.session_id ?? null, order.id
    ),
  ]);
  const conflicts = res[1].results.map((r) => r.number);
  if (conflicts.length) {
    await db.prepare("UPDATE orders SET conflict_items = ? WHERE id = ?").bind(JSON.stringify(conflicts), order.id).run();
  }
  return { changed: res[2].meta.changes > 0, conflicts };
}

export async function recordEmails(db, orderId, now, error = null) {
  await db.prepare("UPDATE orders SET emails_sent_at = ?, email_error = ? WHERE id = ?")
    .bind(error ? null : now, error, orderId).run();
}

export function getOrder(db, id) {
  return db.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
}

export function getOrderBySession(db, sessionId) {
  return db.prepare("SELECT * FROM orders WHERE stripe_session_id = ?").bind(sessionId).first();
}

export async function availability(db, now) {
  const { results } = await db
    .prepare(`SELECT number, status FROM items
               WHERE status = 'sold' OR (status = 'held' AND hold_expires_at >= ?)`)
    .bind(now)
    .all();
  const sold = [];
  const held = [];
  for (const row of results) (row.status === "sold" ? sold : held).push(row.number);
  return { sold, held };
}

// True when this is the first time we see the event id.
export async function recordWebhookEvent(db, id, type, now) {
  try {
    await db.prepare("INSERT INTO webhook_events (id, type, received_at) VALUES (?, ?, ?)").bind(id, type, now).run();
    return true;
  } catch (err) {
    if (/UNIQUE|PRIMARY KEY|constraint/i.test(String(err?.message || err))) return false;
    throw err;
  }
}

// Reconcile: sales not yet written back to the Sheet, and the mark step.
export async function unwrittenSales(db) {
  const { results } = await db
    .prepare("SELECT number, order_id, sold_at FROM items WHERE status = 'sold' AND sheet_written_at IS NULL ORDER BY sold_at")
    .all();
  return results;
}

export async function markWritten(db, numbers, now) {
  if (!numbers.length) return 0;
  const res = await db
    .prepare(`UPDATE items SET sheet_written_at = ? WHERE status = 'sold' AND number IN (${placeholders(numbers.length)})`)
    .bind(now, ...numbers)
    .run();
  return res.meta.changes;
}
