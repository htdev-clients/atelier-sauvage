# Decisions and findings

A running log of choices made and things discovered the hard way. Newest first.

Entries are short on purpose. The aim is that someone picking this repo up in a
year understands *why* it is shaped the way it is, and does not rediscover the
same traps.

---

## 2026-09-02 — the shop build

Built on the branch `ecommerce`, tested on preview deployments only. What is
recorded here is what the brief left open or what the build changed its mind
about; the operating detail is in [`shop-runbook.md`](shop-runbook.md).

### The all-or-nothing claim is a CHECK constraint, not a rollback path

**Context.** The brief's claim is an UPDATE … WHERE available, followed by
"assert rows-affected equals the cart size, otherwise roll back". A manual
rollback is a second write that can itself fail or race.

**Decision.** The claim batch ends by inserting the order row with
`claimed_count = (SELECT COUNT(*) … held by this order)` and the table
carries `CHECK (claimed_count = expected_count)`. A partial claim fails the
INSERT, and D1 rolls the whole batch back — D1 batches are single
transactions. There is nothing to undo by hand.

**Consequences.** `tests/checkout.test.mjs` races 2 and then 25 concurrent
checkouts for one item and overlapping carts, against the real Functions on a
local D1, and runs in CI before every publish. It has never produced a
partial hold. The one case not covered by the constraint is a Function dying
between the batch and Stripe; that hold lapses on its own after 36 minutes.

### The ledger is not seeded

**Context.** The brief says "seed from catalog.csv; the reconcile step keeps
new items appearing". That is a sync job with its own failure modes, and CI
cannot write to D1 anyway (the token is Pages-only).

**Decision.** The claim batch starts with `INSERT OR IGNORE` for each item, so
a row exists from the first time anyone tries to buy it. Whether an item is
*buyable* comes from the build (`/catalogue.json`, read through the ASSETS
binding), never from the ledger. The ledger only knows held and sold.

**Consequences.** Nothing to seed, nothing to drift. An in-shop sale marked
`Vendu` in the Sheet while an online hold is live is still a window the
system cannot see; it lasts until the next catalogue run.

### Functions call Stripe and Resend over fetch, without SDKs

**Decision.** `shop/lib/stripe.js` form-encodes requests and verifies webhook
signatures itself (HMAC-SHA256 over `t.body`, constant-time compare, 300 s
tolerance). CI does not run `npm install` for the site, and keeping the
Functions bundle dependency-free keeps it that way. The brief's warning about
`constructEventAsync` is the SDK's problem; the raw body is read with
`request.text()` before anything parses it.

### Prices come from the deployment, not the request

`_plugins/catalog_generator.rb` emits `/catalogue.json` on the
default-language pass; `functions/api/checkout.js` reads it via
`env.ASSETS.fetch` so the price charged is the price on the page of the same
deployment. Sellability is read from `_database/catalog_validation.json` as
the brief asked; an item is buyable only when sellable, unsold, with a
transport band and an integer price.

### Function secrets: GitHub secrets → Pages API, per environment

**Context.** `wrangler pages secret put` cannot target the preview
environment, and the local machine has no Cloudflare token at all.

**Decision.** `scripts/sync_pages_secrets.py` runs in `deploy.yml` before
publishing and PATCHes `deployment_configs.<env>.env_vars` with the
`PREVIEW_*` or `PROD_*` GitHub secrets that are set, using the existing
Pages:Edit token. Missing names are left alone, so a missing key means a 503
from that feature, never a failed deploy.

### Write-back goes through a bearer-authenticated Function

Rather than giving the reconcile Action a D1-scoped Cloudflare token,
`/api/reconcile` exposes unwritten sales and a mark step behind
`RECONCILE_TOKEN`. The Action needs only what it already has plus that token,
and `atelier-sauvage.pages.dev` is reachable from CI where the apex is not.

### Shipping is priced as one consignment; rates are placeholders

`shop/lib/shipping.js`: the largest band sets the base, each extra item adds
€10, Belgium only, plus free pickup. S/M/L/XL at €15/35/75/140 are
placeholders until the carrier's rate card arrives. Stripe Checkout offers
the two options; the buyer's choice is read back from the rate's metadata.

### Preview fixtures instead of test data in the CSV

The Sheet has no `transport` column yet, so nothing is buyable and a preview
cannot exercise checkout. `deploy.yml`'s `test_fixtures` input gives a dozen
items placeholder bands in the CI checkout only, and refuses on `main`.
Nothing test-shaped is committed to `_database/`.

### Production D1 exists but carries no schema

`atelier-sauvage-shop` was created alongside `-preview`, but applying the
schema to it is a launch step (runbook checklist), consistent with nothing
touching production before the whole flow has been exercised in test mode.

### Reviewed by fresh agents, twice

Two independent reviews after phases 01–03 found: the webhook recorded an
event before handling it (a retry would have been dropped as a duplicate),
the availability cache key was shared by preview and production, a paid
order that displaced a lapsed hold left the other buyer's session payable,
the meta description was unescaped, and a browser-back from Stripe left the
buyer blocked by their own hold. All fixed, each with a test.

### Still open, and who owns it

- **Stripe account for Atelier Sauvage.** No key on this machine belongs to
  this client; the CLI is logged into another project's account and was not
  reused. Test keys must be created in the client's own Stripe account.
- **Resend.** The available account is another project's, with no
  `ateliersauvageheusy.be` domain. The client needs their own, with the
  domain verified.
- **VAT margin scheme** (accountant), **carrier rate card**, **legal review**
  of the CGV: the build assumes TTC prices, Stripe Tax off, placeholder rates,
  a one-year guarantee on second-hand goods.
- **Sheet:** `transport`, `poids`, `dimensions`, `etat` columns; service
  account as Editor for the write-back.

---

## 2026-09-02

### Publish from CI, not Cloudflare's Git integration

**Context.** In July 2026 the Cloudflare Pages Git integration silently
disconnected. No build ran for 23 days. The catalog Action, git and
`scripts/.last_run.json` all stayed green while the site served a stale build.
It was noticed only because a human looked at the live site. Reconnecting is
dashboard-only — there is no API or `wrangler` command for it.

**Decision.** `.github/workflows/deploy.yml` builds with Jekyll and publishes
with `wrangler pages deploy`. The Pages Git integration is disconnected, so CI
is the sole publisher.

**Consequences.** A failed publish is a failed workflow run: red in Actions,
emailed, and for catalog runs written into `.last_run.json` in French so the
client's Sheets popup shows it. The trade-off is that if Actions breaks, there
is no silent fallback — but Actions breaking is loud, which is the property that
was missing.

### Verify deploys via the Pages API, not the public URL

**Context.** The natural check after publishing is "does the live site serve
this build?". It cannot be done: Cloudflare's bot protection returns **403 to
the GitHub runner's datacenter IP**, regardless of user-agent. Eight attempts,
eight 403s, while the deploy itself had succeeded.

**Decision.** The verify step checks (1) the deployment URL wrangler just
created serves the sitemap this run built, and (2) the Pages API reports that
same deployment as the project's `canonical_deployment`.

**Consequences.** Together these catch a stale deployment or one that landed on
a preview branch by mistake. What they cannot see is the custom domain mapping.
A WAF skip rule keyed to a secret header would restore that, but it needs
dashboard config and behaves differently across Cloudflare plans, so it is not
worth it unless domain mapping becomes a live risk.

### Catalog data: normalise, quarantine, warn — never fail the run

**Context.** The pipeline wrote the Google Sheet to CSV verbatim. Two prices
carried a trailing space and one description carried an embedded newline that
split its CSV row across two lines. Harmless as display text; not harmless once
a price becomes a charge.

**Decision.** `scripts/validate.py` sits between reading the sheet and writing
the CSV, in three tiers:

- **Normalise silently** — trim, collapse newlines, strip currency symbols and
  thousands separators, canonicalise `statut` and `category` with accent folding
  so `decoration` matches `Décoration`.
- **Quarantine one item** — a structurally unusable row (no number, duplicate)
  is dropped; an ambiguous price only costs that item its `sellable` flag and it
  still appears in the catalogue.
- **Warn, block nothing** — large price moves, items returning from sold, a
  sharp drop in item count, unknown categories.

**Consequences.** One bad cell never costs the client their other twenty edits.
Prices are never guessed at: `1.250` could be 1250 or 1.25, so it is reported
rather than interpreted. Findings surface in French through the existing
`.last_run.json` popup, so there is no new surface for the client to learn.

### Item numbers are text, and we do not renumber

**Context.** 62 of 265 items use letter suffixes — `24b`, `170c`, `219f` — a
historical convention for grouping related pieces. New items are numeric, but
`190b` was added in September 2026, so the convention is still in use.

**Decision.** Item numbers are `TEXT` everywhere: the D1 primary key, the URL
segment, Stripe metadata. The old numbering is left alone.

**Consequences.** An `INTEGER` key would silently drop a quarter of the
catalogue. Renumbering was considered and rejected: it means a coordinated
rename of ~400 image files across Drive *and* git with no transaction protecting
it, and the image filename is the join key to the Sheet. A `TEXT` key costs
nothing.

### Generate the sitemap; one canonical per page

**Context.** `sitemap.xml` was a hand-written stub listing one URL with a
`lastmod` from October 2025. Separately, every page carried two
`<link rel="canonical">` tags — one hand-written, one from `{% I18n_Headers %}` —
which contradicted each other on non-default languages. Google discards all
canonicals when it finds conflicting ones, which is why URL Inspection reported
`User-declared canonical: None`.

**Decision.** The sitemap is generated from `site.html_pages`, 16 URLs with full
hreflang. The hand-written canonical was deleted; polyglot's is language-aware
and correct.

**Consequences.** New pages appear in the sitemap automatically, including the
per-item catalogue pages when those land. A small `_plugins` hook also corrects
polyglot's `x-default`, which its own relativizer was rewriting to the wrong
language.

### `atelier-refresher` is documented here but deployed by hand

**Context.** The homepage Instagram feed depends on a Worker that existed only
in the Cloudflare dashboard for nine months — not in this repo or any notes.

**Decision.** `workers/atelier-refresher/` records it as deployed. It is
deliberately **not** wired into CI: the deploy token carries only
`Cloudflare Pages: Edit`, so the pipeline cannot touch Workers even by accident.

**Consequences.** Redeploying it needs a temporary Workers-scoped token, minted
for the occasion and revoked afterwards. See that directory's README.

### E-commerce direction (decided, not built)

Stripe Checkout on the existing static site, with a cart, shipping by a
specialist art carrier, Belgium at launch. Order state lives in **D1**, not KV,
because KV is eventually consistent and a stale read lets two buyers claim the
same one-of-a-kind item. Full brief in [`ecommerce-brief.md`](ecommerce-brief.md).

### Meta Conversions API parked

Blocked on a Meta-side token generation bug since June 2026, and the branch had
drifted months behind `main`. Deleted and archived as the git tag
`archive/meta-capi`; it will be rebuilt alongside the e-commerce work.

---

## Traps worth knowing

Things that cost time to discover.

**Jekyll copies unknown top-level directories into `_site`.** `scripts/*.py` was
publicly downloadable from the live site for months as a result. `docs/`,
`workers/` and `scripts/` are now in the `exclude` list in `_config.yml`. Add
any new top-level directory there unless it is meant to be served.
`functions/` is the deliberate exception: Cloudflare Pages needs it at the
deploy root and compiles it rather than serving the source.

**Cloudflare's edge cache outlives the file.** Assets are served with
`s-maxage=604800`. A file removed from a deployment can keep being served for
seven days. Check with a cache-buster query string before concluding something
is still deployed, and purge from Caching → Configuration → Purge Custom URLs.

**HTTP 200 is not proof a file exists.** Pages serves `index.html` as a fallback
for unmatched paths, with a 200. Check the content type or the body, never the
status code.

**`workflow_dispatch` resolves workflows from the default branch.** A workflow
that exists only on a feature branch cannot be dispatched at all, even when
targeting that branch. It must land on `main` first. `[skip ci]` in the commit
message is honoured by both GitHub Actions and Cloudflare, which is how to merge
a deploy workflow without immediately triggering it.

**Polyglot re-runs generators for every language.** `Site#process` forks a full
Jekyll pipeline per language, so a `Generator` runs once per language and writes
into that language's destination. Its URL-relativization hook registers on
`:site, :post_render`, *after* generators, so generator-created pages are
localized correctly. Anything hooking `post_render` after polyglot needs
`priority: :low` to win, and should be restricted to HTML — `site.pages`
includes `sitemap.xml`.

**`update_csv()` rewrites the CSV wholesale from the Sheet.** Anything written
into `_database/catalog.csv` by another process is erased on the next catalog
run. The Sheet is the source of truth; write back there, which will need the
OAuth scope widened from `spreadsheets.readonly` to `spreadsheets` *and* the
service account given Editor access on the Sheet itself. Both gates, or it fails
confusingly.

**Pages `wrangler.toml` replaces the dashboard's bindings.** The moment a
deployment carries a Wrangler file, only the bindings in that file exist for
that environment. The KV binding `ATELIER_STORE` was configured in the
dashboard; it is now declared in `wrangler.toml` for both environments, or the
Instagram feed would have stopped. Bindings are non-inheritable: override one
for `[env.preview]` and you must redeclare all of them there.

**`wrangler pages dev` ignores `--config`, and `--persist-to` is the only
isolation.** Tests run the root `wrangler.toml` with the fixture directory as
the positional argument. `migrations_dir` resolves relative to the config
file, not the cwd. On Linux CI, spawning wrangler through `npx` left `workerd`
alive after the tests, and the runner hung until the timeout: spawn the
binary in `node_modules/.bin` directly, in its own process group, and kill the
group.

**`wrangler pages secret put` has no environment flag.** It writes to
production. Preview secrets go through the Pages API (`deployment_configs.preview.env_vars`).

**KV is shared between preview and production.** Anything cached in
`ATELIER_STORE` must carry the environment in its key, or a preview hold
greys out an item on the live site.

**SQLite wants table-level CHECKs after the last column.** A `CHECK (a = b)`
between column definitions is a syntax error at offset N with no better hint.

**A webhook event must not be marked handled before it is handled.** Record
the id, handle, and on failure delete the id again; otherwise the provider's
retry is answered "duplicate" and the order is never settled.

**Stripe's `checkout.session.completed` payload carries the shipping rate as
an id.** Read the session back with `expand[]=shipping_cost.shipping_rate` to
know which option the buyer chose; do not infer it from the amount.

**`node --test tests/`** does not run a directory on Node 22; use a glob.
**macOS has no `timeout`** command; a script that depends on it silently tests nothing.

**Cloudflare blocks CI from fetching the site.** See the deploy verification
decision above. Any future health check that runs in Actions has the same
problem.
