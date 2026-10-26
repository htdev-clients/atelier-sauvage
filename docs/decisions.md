# Decisions and findings

A running log of choices made and things discovered the hard way. Newest first.

Entries are short on purpose. The aim is that someone picking this repo up in a
year understands *why* it is shaped the way it is, and does not rediscover the
same traps.

---

## 2026-10-26

### Catalog update: a missing photo fails the whole run

**Finding.** Lot 392 was added to the Sheet before its photo reached Drive. The
image-coverage check in `update_catalog.py` stops the run, so none of the other
lots' edits went live until the photo was uploaded and the update re-run. The
failed lot is named in `scripts/.last_run.json` (`missing_lots`), which is what
the Sheets popup shows. Quarantining just that lot (unlike the data rules above)
was considered and not done; revisit if it keeps happening.

### Catalog update: check out latest main

**Context.** A double click queued a second run behind the first (concurrency
group). It checked out the commit it was dispatched on, so after the first run
pushed it rebuilt on a stale tree and hit a rebase conflict on
`.last_run.json` and `catalog_validation.json`. Nothing was lost, but the
failure emailed a red "Run failed".

**Decision.** The update job checks out `ref: main`, so a queued run starts from
what the previous run pushed and normally finds nothing to commit.

---

## 2026-10-19

### Meta assets and the Ads MCP

Business portfolio "Atelier Sauvage Heusy" `717742644715095` owns the ad account
"Atelier Sauvage Ads" `1682492246265215` (EUR), the Pixel/dataset
`1719009352576992` and the Page "Atelier Sauvage" `1046438385209103`. Grant
people or agencies access from that portfolio only (procedure in
`HTDev/business/SOPs/Meta access SOP.md`, outside this repo).

Meta's official Ads MCP (`https://mcp.facebook.com/ads`, OAuth, no token) is
configured locally for this repo. Its OAuth grant reaches every portfolio on
Harold's Facebook login and the consent screen cannot narrow it, so the scope is
enforced locally (all of it under the gitignored `.claude/`):

- `settings.local.json` denies every write tool.
- `hooks/meta_ads_guard.py` (PreToolUse) allows only listed read tools, blocks
  the cross-portfolio listings, and requires every ID in a call to be one of the
  root IDs above or one returned by an earlier allowed call. Fails closed.
- The same script (PostToolUse) appends returned IDs to
  `hooks/meta-ads-seen-ids.txt`. Delete that file to reset what was learned.

New tools Meta adds are blocked until added to `READ_TOOLS` in the script.

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

**Cloudflare blocks CI from fetching the site.** See the deploy verification
decision above. Any future health check that runs in Actions has the same
problem.
