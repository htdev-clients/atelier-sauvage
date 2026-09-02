// GET /api/availability -> { sold: [...], held: [...], generated }
// Sold and held item numbers from the ledger, cached in KV for ~60s.

import { json, fail, nowSec } from "../../shop/lib/http.js";
import { availability } from "../../shop/lib/ledger.js";
import { AVAILABILITY_KEY, AVAILABILITY_TTL } from "../../shop/lib/cache.js";

export async function onRequestGet({ env }) {
  if (!env.SHOP_DB) return fail(503, "ledger_unavailable");
  const headers = { "cache-control": "public, max-age=15" };

  if (env.ATELIER_STORE) {
    const cached = await env.ATELIER_STORE.get(AVAILABILITY_KEY);
    if (cached) {
      return new Response(cached, { headers: { "content-type": "application/json; charset=utf-8", ...headers, "x-cache": "hit" } });
    }
  }

  const now = nowSec();
  const data = { ...(await availability(env.SHOP_DB, now)), generated: now };
  const body = JSON.stringify(data);
  if (env.ATELIER_STORE) {
    try {
      await env.ATELIER_STORE.put(AVAILABILITY_KEY, body, { expirationTtl: AVAILABILITY_TTL });
    } catch (err) {
      console.warn("availability cache write failed", err?.message || err);
    }
  }
  return new Response(body, { headers: { "content-type": "application/json; charset=utf-8", ...headers, "x-cache": "miss" } });
}
