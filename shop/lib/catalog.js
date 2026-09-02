// Build data. /catalogue.json is emitted by _plugins/catalog_generator.rb on
// every build and read here through the ASSETS binding, so a Function always
// sees the same prices and sellability as the pages of the deployment it runs
// in. Nothing price-related is ever taken from the request body.

export async function loadCatalog(env, request) {
  const url = new URL("/catalogue.json", request.url);
  const res = await env.ASSETS.fetch(new Request(url.toString(), { headers: { accept: "application/json" } }));
  if (!res.ok) throw new Error(`catalogue.json unavailable (${res.status})`);
  const data = await res.json();
  if (!data || typeof data.items !== "object") throw new Error("catalogue.json malformed");
  return data;
}

// Returns { items: [...snapshots], rejected: [...numbers] }.
export function selectBuyable(catalog, numbers) {
  const items = [];
  const rejected = [];
  for (const number of numbers) {
    const entry = catalog.items[number];
    if (!entry || !entry.buyable || !Number.isInteger(entry.price_cents) || entry.price_cents <= 0) {
      rejected.push(number);
      continue;
    }
    items.push({
      number,
      description: String(entry.description || number),
      category: String(entry.category || ""),
      price_cents: entry.price_cents,
      transport: String(entry.transport || ""),
    });
  }
  return { items, rejected };
}
