# Shop runbook

How the online shop is wired, what has to be true for it to work, and what to
do when it does not. The design is in [`ecommerce-brief.md`](ecommerce-brief.md);
the reasoning behind the choices is in [`decisions.md`](decisions.md).

---

## Moving parts

| Piece | Where | Notes |
|---|---|---|
| Product pages, cart, thank-you page, CGV | Jekyll (`_layouts/product.html`, `panier.html`, `merci.html`, `cgv.html`, `assets/js/shop.js`) | Generated per language by `_plugins/catalog_generator.rb`. |
| Build data | `/catalogue.json` | Emitted by the generator on the default-language pass. The Functions read prices and sellability from it through the `ASSETS` binding, never from the request. |
| Functions | `functions/api/*.js`, shared code in `shop/lib/` | `checkout`, `stripe-hook`, `order`, `release`, `availability`, `reconcile`. No npm dependencies at runtime. |
| Ledger | D1 `atelier-sauvage-shop` (production) and `atelier-sauvage-shop-preview` | Schema in `migrations/`. Binding `SHOP_DB`. |
| Availability cache | KV `ATELIER_DATA`, key `shop:availability:<env>` | 60 s TTL, invalidated on every write. |
| Bindings | `wrangler.toml` | Applied by `wrangler pages deploy`. Includes the pre-existing `ATELIER_STORE` KV binding on purpose: once a deployment carries a Wrangler file, bindings not listed there are gone. |
| Secrets | GitHub secrets → Pages environment | `scripts/sync_pages_secrets.py`, run by `deploy.yml` before publishing. |
| Write-back | `.github/workflows/reconcile.yml`, `scripts/reconcile.py` | Every 15 min on `main`: sold items → `Vendu` in the Sheet → catalogue run → rebuild. |
| Tests | `npm test` | Races concurrent checkouts on a local D1; runs in CI before every publish. |

## An item is buyable when

1. `scripts/validate.py` marked it sellable (a readable price, not `Vendu`, not `pending`), recorded in `_database/catalog_validation.json`;
2. its `transport` column in the Sheet holds `S`, `M`, `L` or `XL`;
3. it is not `Vendu`;
4. the ledger does not hold it as `held` (live hold) or `sold`.

The Sheet has none of the new columns yet, so today nothing is buyable and the
shop is invisible except for the cart link. Adding `transport` values makes
items buyable one by one. `poids`, `dimensions` and `etat` are shown on the
product page when present.

## Secrets

Set as GitHub repository secrets; `deploy.yml` pushes them to the Pages
environment matching the branch (`main` → production, anything else → preview).

| GitHub secret | Function secret | Where it comes from |
|---|---|---|
| `PREVIEW_STRIPE_SECRET_KEY` / `PROD_STRIPE_SECRET_KEY` | `STRIPE_SECRET_KEY` | Stripe → Developers → API keys. Use a **restricted** key with only *Checkout Sessions: write* and *Checkout Sessions: read*. Test mode for preview; live only at launch. |
| `PREVIEW_STRIPE_WEBHOOK_SECRET` / `PROD_STRIPE_WEBHOOK_SECRET` | `STRIPE_WEBHOOK_SECRET` | Stripe → Developers → Webhooks → the endpoint's signing secret. |
| `PREVIEW_RESEND_API_KEY` / `PROD_RESEND_API_KEY` | `RESEND_API_KEY` | Resend, a *sending-only* key scoped to the shop's domain. Needs `ateliersauvageheusy.be` verified in Resend (DNS records in Cloudflare) so mail can come from `commandes@ateliersauvageheusy.be`. |
| `PREVIEW_RECONCILE_TOKEN` / `PROD_RECONCILE_TOKEN` | `RECONCILE_TOKEN` | Random, e.g. `python3 -c 'import secrets;print(secrets.token_urlsafe(32))'`. The preview one is set. |

Set one without it ever appearing in a terminal history or chat:

```
gh secret set PREVIEW_STRIPE_SECRET_KEY        # paste at the prompt
```

Optional plain variables, in `wrangler.toml` `[vars]` if ever needed:
`SHOP_EMAIL_FROM`, `SHOP_EMAIL_TO` (defaults: `commandes@ateliersauvageheusy.be`, `ateliersauvageheusy@gmail.com`),
`SHOP_SITE_URL` (links in e-mails), `SHOP_ASSET_BASE` (image URLs given to Stripe; the apex
returns 403 to some bots, so `https://atelier-sauvage.pages.dev` is the safe value in production).

## Stripe setup (test mode, then live)

1. Webhook endpoint: `https://<deployment>/api/stripe-hook`, events
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`.
   For previews, point it at the branch alias `https://ecommerce.atelier-sauvage.pages.dev`.
2. Payment methods: enable **Bancontact** and cards in the dashboard. Checkout
   picks methods dynamically; nothing is hard-coded.
3. Branding: name, icon and colours in Stripe → Settings → Branding.
4. Prices are TTC; **Stripe Tax is off** (margin scheme pending the accountant).

Test with the Stripe test cards (`4242 4242 4242 4242`) and the Bancontact test
flow. A hosted Checkout page shows `Retrait à l'atelier` and `Livraison en Belgique`.

## Previews

```
gh workflow run deploy.yml --ref ecommerce -f test_fixtures=true
```

`test_fixtures=true` gives a dozen sellable items placeholder bands in the CI
checkout only (never committed, refused on `main`) so the cart can be
exercised. The run prints the deployment URL; the branch alias is
`https://ecommerce.atelier-sauvage.pages.dev`. Never verify against
`ateliersauvageheusy.be` from CI or a datacenter: Cloudflare answers 403.

## Launch checklist

- [ ] Accountant's answer on the VAT margin scheme; adjust CGV §4 and invoice wording.
- [ ] Carrier rate card → replace the placeholder rates in `shop/lib/shipping.js`; decide the minimum-charge policy (pickup-only threshold?).
- [ ] Legal review of `cgv.html` in the four languages (withdrawal, one-year guarantee on second-hand goods, return carriage).
- [ ] Apply `migrations/*.sql` to the **production** D1 (`atelier-sauvage-shop`) — only the preview database has the schema today.
- [ ] Stripe live keys as `PROD_*` GitHub secrets; live webhook endpoint on the apex; Bancontact enabled.
- [ ] Resend: domain verified, `PROD_RESEND_API_KEY`.
- [ ] `PROD_RECONCILE_TOKEN`; service account shared as **Editor** on the Sheet (the write-back needs it).
- [ ] Sheet columns `transport`, `poids`, `dimensions`, `etat` added; bands filled for the items to launch with.
- [ ] Cloudflare: rate-limiting rule on `/api/checkout` (e.g. 10 requests / minute / IP) and, ideally, Turnstile on the cart. The Function's own cap (3 open checkouts per address, 40 overall in 10 min) is a floor, not a fence.
- [ ] A full test-mode run on the preview: two browsers racing the same item; a cart where one item sells mid-session; Bancontact; a cancelled payment; the thank-you page; both e-mails.
- [ ] Merge to `main` with a normal commit (the deploy runs the tests, then publishes).

## When something is wrong

**"Le paiement n'a pas pu démarrer"** on the cart → `/api/checkout` answered
non-200. `503 payments_unavailable`: no `STRIPE_SECRET_KEY` on this
environment. `502 payment_provider_error`: Stripe rejected the session (check
the Function logs in the Cloudflare dashboard → Pages → the project →
Functions → Logs, or `wrangler pages deployment tail`). The items were
released.

**An item shows "Réservé"** → someone is paying for it, or paid and the
webhook has not landed yet. Holds lapse 36 minutes after the checkout started.
`SELECT * FROM items WHERE status = 'held'` on the D1 console shows who.

**A sale is not on the site** → the write-back runs every 15 minutes on
`main` and needs a successful catalogue run after it. Check Actions →
*Reconcile online sales*. `GET /api/reconcile` with the bearer token lists
what is still unwritten. GitHub pauses schedules after 60 days without commits.

**No e-mails after a sale** → `orders.email_error` holds the reason; the
reconcile call retries failed e-mails from the last 7 days every 15 minutes.

**"CONFLIT" in a shop e-mail** → two payments landed for one item after a
lapsed hold (webhook lost for >36 min). The first keeps it; refund the second
in Stripe. `orders.conflict_items` records it.

**Manual release of a stuck hold** (D1 console, preview or production):

```sql
UPDATE items SET status='available', order_id=NULL, hold_expires_at=NULL WHERE number='24b' AND status='held';
```
