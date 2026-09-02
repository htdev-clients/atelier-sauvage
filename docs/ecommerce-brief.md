# E-commerce build brief

Turning the catalogue into a real shop: buy online, ship to the customer.

This is the working brief for whoever builds it. The approach is settled; what
follows is the reasoning, the constraints, and the traps. Read
[`decisions.md`](decisions.md) alongside it.

---

## Hard constraints

**Nothing goes to production.** All work happens on a feature branch and is
tested against a Cloudflare Pages **preview** deployment. `main` deploys to the
live shop on every push, so the branch must not be merged until the whole flow
has been exercised end to end in Stripe **test mode**.

**Stripe stays in test mode** for the entire build. Live keys go in only at
launch, as a deliberate separate step.

**Secrets are per-project.** Never in global settings, never in the repo. The
Cloudflare deploy token deliberately carries only `Cloudflare Pages: Edit`;
anything needing more scope gets its own token, minted for the task and revoked.

**Verify against the preview URL, not the apex.** Cloudflare blocks CI and
datacenter IPs from fetching `ateliersauvageheusy.be` with a 403. Preview
deployments on `*.pages.dev` are reachable.

---

## What the shop is

265 items, all **one of a kind**. Median price €130, range €9–€1250. Categories
are Meuble, Décoration, Luminaire. The client manages everything from a Google
Sheet and a Drive folder and will not be learning a new tool.

Four languages: fr (default), en, nl, de, via jekyll-polyglot. Item descriptions
stay in French everywhere; only the surrounding chrome is translated.

## Decisions already made

| Question | Settled |
|---|---|
| Payment | Stripe Checkout, hosted. No PCI surface here. Bancontact matters more than cards for a Belgian shop. |
| Cart | Yes — multi-item is common in the shop. Claimed all-or-nothing. |
| Stock safety | D1, not KV. KV is eventually consistent; a stale read lets two people buy the same vase. |
| Item key | `TEXT`. 23% of items have letter suffixes (`24b`, `170c`). |
| Shipping | A specialist art/antiques carrier, assumed able to ship anything. Rate card pending. |
| Countries | Belgium at launch. NL, DE, FR, LU as a later phase. |
| Returns | Buyer pays return carriage, disclosed in the CGV and on the product page. Revisit at legal review. |
| Per-item pages | Proven to work — see below. |

## Still open

**VAT — blocking for launch, not for building.** Antiques dealers typically use
the margin scheme, which changes invoicing and whether VAT can be shown as a
line. The client's accountant has been asked. Build on the assumption of prices
TTC with Stripe Tax **off**; it is cheap to revisit.

**Carrier rate card — blocks the shipping phase only.** Everything else can be
built against placeholder bands.

**Minimum shipping charge.** Median item is €130 and 38 items are under €50.
Specialist carriers often have a minimum job charge in that range. The build
treats every item identically either way, but if the minimum is high the fix is
commercial rather than technical: a threshold below which items are pickup-only,
or a nudge to combine items into one consignment. The cart makes the second
option attractive.

---

## Architecture

The static site stays. Stripe holds the payment surface. D1 holds the truth
about what is still for sale.

```
  Cart (localStorage)
        |  N items
        v
  POST /api/checkout ------> D1 batch: claim all N or none
        |                        items | orders | webhook_events
        v                        hold expires in 35 min
  Stripe Checkout
        |  paid
        v
  POST /api/stripe-hook ---> mark N items sold ---> Resend (buyer + shop)
        |
        v
  reconcile cron (15 min) -> Google Sheet statut = Vendu -> rebuild
```

`GET /api/availability` returns sold and held item numbers, KV-cached ~60s. The
catalogue grid, product pages and cart call it on load and grey out what has
gone. Staleness is harmless on that read path — the authoritative check happens
at claim time.

### The claim is the whole design

Claiming one item is a conditional update. Claiming four is a **transaction**:
either all four are held or none are, otherwise someone pays for a set and
receives three quarters of it.

```sql
UPDATE items
   SET status = 'held', hold_expires_at = ?, order_id = ?
 WHERE number IN (...)
   AND (status = 'available' OR (status = 'held' AND hold_expires_at < ?))
```

Run it in a D1 batch, then assert rows-affected equals the cart size. If it does
not, roll back and tell the customer exactly which items went. That assertion is
the entire concurrency defence — get it right and the rest is plumbing.

Holds expire lazily via the `WHERE` clause. No cron needed to reclaim them.

### Shipping a cart

Bands cannot be summed. A carrier prices a *consignment* — one pickup, one
delivery, one insurance line. So **the largest band in the cart sets the base
rate, plus a surcharge per additional item**. That mirrors how the carrier will
quote it, comes out cheaper than summing, and gives buyers a reason to combine
items, which is the argument for having a cart at all.

---

## Phases

Ordered so each is independently shippable and the risky parts land early.

**01 — Per-item pages.** *~1 day.* The generator half is **already proven**: a
`ProductPage < Jekyll::Page` subclass in `_plugins/catalog_generator.rb`
produced 265 items × 4 languages in 1.6s with correct `active_lang` and
correctly relativized links. That spike is on the local branch `ecommerce-spike`
(commit `7cda0c4`, never pushed) and carries a throwaway layout with `SPIKE_`
debug markers. What remains is the real template: image gallery reusing the
existing PhotoSwipe lightbox, description, dimensions, condition, add-to-cart.
Add `Product`/`Offer` JSON-LD and a Pixel `ViewContent` event.

**02 — The ledger.** *~1 day.* D1: `items(number TEXT PRIMARY KEY, status,
hold_expires_at, order_id, sold_at)`, an `orders` table, and
`webhook_events(id PRIMARY KEY)` for replay protection — Stripe will occasionally
deliver the same event twice. Seed from `catalog.csv`; the reconcile step keeps
new items appearing. D1 is already enabled on the account.

**03 — Cart and checkout.** *~3–4 days.* Three Pages Functions beside the
existing `functions/instagram.js`.

- `POST /api/checkout` — claims the cart atomically, then creates a Stripe
  Session with N line items, `expires_at` at 30 minutes, `locale` from the page
  language. **Prices are read server-side from build data, never from the
  request body.**
- `POST /api/stripe-hook` — `checkout.session.completed` sells every item on the
  order; `checkout.session.expired` releases them. **Workers need
  `constructEventAsync`, not the sync variant, and the raw body via
  `await request.text()` before parsing.**
- `GET /api/availability` — sold and held numbers, KV-cached.

**04 — Shipping, Belgium only.** *~1 day + carrier lead time.* One zone, one
rate table, `allowed_countries: ['BE']`. Bands S/M/L/XL plus the per-extra-item
surcharge. Stripe Checkout accepts up to five shipping options per session.

**05 — Write-back and receipts.** *~1–2 days.* A scheduled Action reads sold
rows from D1 and writes `Vendu` into the Google Sheet, then triggers a rebuild.
This needs the OAuth scope widened to `spreadsheets` **and** the service account
given Editor on the Sheet — both gates, or it fails confusingly. Resend for the
buyer confirmation and a shop notification carrying item numbers, address and
consignment band; that email is what the client forwards to the carrier.

**06 — Legal, testing, launch.** *~2 days + review.* CGV, withdrawal policy and
the statutory withdrawal form in all four languages, extending `mentions.html`.
Full flow in Stripe test mode on the preview, **including a deliberate
two-browser race on the same item** and a cart where one item sells mid-session.
Confirm Bancontact is enabled.

**07 — Later: NL, DE, FR, LU.** *~1 day.* A country selector, a zone column, a
wider `allowed_countries`. Deferred until the carrier relationship and the
returns process have survived real domestic orders.

---

## New columns the Sheet needs

The code can ship with these empty — items stay unbuyable until populated, which
makes the rollout gradual rather than blocked on 265 rows of data entry.
`scripts/validate.py` already enforces the `transport` band when the column
exists, and will flag items that lack it.

| Column | Purpose | Filled by |
|---|---|---|
| `transport` | Band S/M/L/XL. Required before an item can be bought. | Client |
| `poids` | Weight in kg. The carrier will ask regardless. | Client |
| `dimensions` | L × l × H in cm. Also useful copy — furniture buyers always ask. | Client |
| `etat` | Condition note. On second-hand goods this is both a legal safeguard and a returns deterrent. | Client |
| `statut` | Existing column. Written back as `Vendu` by the reconcile job; the client keeps using it by hand for in-shop sales. | System |

---

## Repo facts you need before starting

- **`scripts/validate.py`** normalises and validates catalogue data, with 31
  unit tests: `python3 -m unittest discover -s scripts -p 'test_*.py'`. It emits
  `_database/catalog_validation.json` recording per-item sellability. **Read
  sellability from that sidecar** rather than re-deriving it, so the site, the
  ledger and Stripe cannot disagree.
- **Tailwind is not built in CI.** `assets/css/style.css` is committed prebuilt.
  Run `npm run build:css` after adding classes, or they will silently not exist.
- **Add any new top-level directory to `exclude` in `_config.yml`**, or Jekyll
  publishes it. `functions/` is the deliberate exception.
- **`ATELIER_STORE`** is the Pages KV binding; the namespace is titled
  `ATELIER_DATA`. It is available in both Production and Preview.
- **The deploy pipeline** is `.github/workflows/deploy.yml`. It runs on pushes to
  `main`, on dispatch, and as a reusable workflow called by
  `update_catalog.yml`. Dispatching it against a branch produces a preview
  deployment and skips the production verification.
- **Estimated total: 9–12 working days**, excluding the carrier, the accountant
  and legal review, which run in parallel.
