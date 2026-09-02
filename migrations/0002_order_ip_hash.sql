-- Abuse guard for /api/checkout: pending orders are counted per address.
-- The value is a salted SHA-256 prefix, never the address itself.
ALTER TABLE orders ADD COLUMN ip_hash TEXT;
CREATE INDEX IF NOT EXISTS orders_pending_load ON orders (status, created_at);
