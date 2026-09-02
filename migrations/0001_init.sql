-- Atelier Sauvage shop ledger.
--
-- items is the truth about what is still for sale online. Rows are created
-- lazily by the first claim (INSERT OR IGNORE), so the table never needs to be
-- seeded from the catalogue: an item that is absent is simply available, and
-- the build's catalogue.json decides whether it is buyable at all.
--
-- Item numbers are TEXT: a quarter of the catalogue carries letter suffixes.

CREATE TABLE IF NOT EXISTS items (
  number           TEXT PRIMARY KEY,
  status           TEXT NOT NULL DEFAULT 'available'
                   CHECK (status IN ('available', 'held', 'sold')),
  hold_expires_at  INTEGER,            -- unix seconds; holds expire lazily
  order_id         TEXT,
  sold_at          INTEGER,
  sheet_written_at INTEGER,            -- when the reconcile job wrote Vendu
  updated_at       INTEGER
);

CREATE INDEX IF NOT EXISTS items_status ON items (status);
CREATE INDEX IF NOT EXISTS items_order  ON items (order_id);

-- expected_count / claimed_count carry the all-or-nothing guarantee: the
-- order row is inserted in the same batch as the claim UPDATE, with
-- claimed_count computed from what that UPDATE actually held. If fewer rows
-- than the cart size were claimed, the CHECK fails, the batch is rolled back
-- and nothing is held. No separate rollback path to get wrong.
CREATE TABLE IF NOT EXISTS orders (
  id                    TEXT PRIMARY KEY,
  status                TEXT NOT NULL
                        CHECK (status IN ('pending', 'paid', 'expired', 'released', 'failed')),
  expected_count        INTEGER NOT NULL,
  claimed_count         INTEGER NOT NULL,
  lang                  TEXT NOT NULL DEFAULT 'fr',
  item_numbers          TEXT NOT NULL,   -- JSON array
  items_json            TEXT NOT NULL,   -- JSON snapshot: number, description, price_cents, transport
  amount_items          INTEGER NOT NULL,
  amount_shipping       INTEGER,
  amount_total          INTEGER,
  currency              TEXT NOT NULL DEFAULT 'eur',
  shipping_band         TEXT,
  shipping_option       TEXT,            -- 'delivery' | 'pickup'
  stripe_session_id     TEXT UNIQUE,
  stripe_payment_intent TEXT,
  customer_email        TEXT,
  customer_name         TEXT,
  customer_phone        TEXT,
  shipping_address      TEXT,            -- JSON
  cancel_token          TEXT NOT NULL,
  conflict_items        TEXT,            -- JSON array; set when a paid order lost an item
  created_at            INTEGER NOT NULL,
  hold_expires_at       INTEGER NOT NULL,
  paid_at               INTEGER,
  closed_at             INTEGER,
  emails_sent_at        INTEGER,
  email_error           TEXT,
  CHECK (claimed_count = expected_count)
);

CREATE INDEX IF NOT EXISTS orders_status ON orders (status);

-- Stripe delivers an event more than once now and then. The primary key makes
-- the second delivery a no-op.
CREATE TABLE IF NOT EXISTS webhook_events (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
