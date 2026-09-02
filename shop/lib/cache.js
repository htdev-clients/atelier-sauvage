// /api/availability is cached in KV for ~60s. Writes that change availability
// drop the key so the next read is fresh from the same colo; elsewhere it ages
// out. Staleness on the read path is harmless -- the claim is authoritative.

export const AVAILABILITY_TTL = 60;

// The KV namespace is shared by preview and production (the Instagram token
// lives there), so the key carries the environment: a preview hold must never
// grey out an item on the live site.
export function availabilityKey(env) {
  return `shop:availability:${env.SHOP_ENV || "unknown"}`;
}

export async function invalidateAvailability(env) {
  if (!env.ATELIER_STORE) return;
  try {
    await env.ATELIER_STORE.delete(availabilityKey(env));
  } catch (err) {
    console.warn("availability cache invalidation failed", err?.message || err);
  }
}
