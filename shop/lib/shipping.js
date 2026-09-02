// Shipping for a cart is priced as ONE consignment: the largest band in the
// cart sets the base rate, each additional item adds a flat surcharge. That is
// how a specialist carrier quotes a job -- one pickup, one delivery, one
// insurance line -- and it is what makes combining items into a single order
// cheaper for the buyer.
//
// PLACEHOLDER RATES. The carrier's rate card is pending (see
// docs/ecommerce-brief.md). Amounts are in euro cents, TTC. Belgium only.

export const BANDS = ["S", "M", "L", "XL"];

export const RATES_CENTS = {
  S: 1500,
  M: 3500,
  L: 7500,
  XL: 14000,
};

export const EXTRA_ITEM_CENTS = 1000;

export const ALLOWED_COUNTRIES = ["BE"];

export function largestBand(bands) {
  let best = -1;
  for (const band of bands) {
    const rank = BANDS.indexOf(band);
    if (rank > best) best = rank;
  }
  return best === -1 ? null : BANDS[best];
}

// { band, base, extras, total } or null when a band is unknown.
export function consignment(bands) {
  if (!bands.length || bands.some((b) => !BANDS.includes(b))) return null;
  const band = largestBand(bands);
  const base = RATES_CENTS[band];
  const extras = EXTRA_ITEM_CENTS * (bands.length - 1);
  return { band, base, extras, total: base + extras };
}

// Stripe Checkout accepts up to five shipping options; we offer two.
export function shippingOptions(bands, labels) {
  const c = consignment(bands);
  if (!c) return null;
  return [
    {
      key: "delivery",
      amount: c.total,
      display_name: labels.delivery,
      delivery_estimate: { minimum: { unit: "business_day", value: 3 }, maximum: { unit: "business_day", value: 10 } },
    },
    {
      key: "pickup",
      amount: 0,
      display_name: labels.pickup,
    },
  ];
}
