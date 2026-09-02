// /api/availability is cached in KV for ~60s. Writes that change availability
// drop the key so the next read is fresh from the same colo; elsewhere it ages
// out. Staleness on the read path is harmless -- the claim is authoritative.

export const AVAILABILITY_KEY = "shop:availability";
export const AVAILABILITY_TTL = 60;

export async function invalidateAvailability(env) {
  if (!env.ATELIER_STORE) return;
  try {
    await env.ATELIER_STORE.delete(AVAILABILITY_KEY);
  } catch (err) {
    console.warn("availability cache invalidation failed", err?.message || err);
  }
}
