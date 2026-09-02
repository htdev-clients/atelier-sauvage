# Atelier Sauvage — Website

Website for [Atelier Sauvage](https://ateliersauvageheusy.be/), a vintage furniture and decor shop based in Verviers, Belgium.

## Tech Stack

| Layer | Technology |
|---|---|
| Static site generator | [Jekyll](https://jekyllrb.com/) |
| CSS framework | [Tailwind CSS](https://tailwindcss.com/) |
| Hosting | [Cloudflare Pages](https://pages.cloudflare.com/) |
| Edge functions | Cloudflare Workers (via Pages Functions) |
| Catalog automation | GitHub Actions + Python |
| Image processing | [Pillow](https://python-pillow.org/) |
| Catalog data source | Google Sheets + Google Drive |

## Features

### Product catalog
The catalog is driven by a CSV file (`_database/catalog.csv`) generated from a Google Sheet. A custom Jekyll plugin (`_plugins/catalog_generator.rb`) reads the CSV at build time and renders the catalogue grid, automatically detecting how many photos each item has by checking for indexed image files on disk.

Item numbers are **text, not integers** — around a quarter of them carry letter suffixes (`24b`, `170c`) from a historical grouping convention that is still in use.

Product images are served with `srcset` at three sizes (480, 800, 1400px) in WebP format for optimal performance.

### Image lightbox
Items with multiple photos display a lightbox with keyboard and swipe navigation. The lightbox is built in vanilla JS with no external dependencies.

### Catalog automation pipeline
The owner manages the catalog entirely from Google Sheets and Google Drive — no code required on their end. A GitHub Actions workflow (`workflow_dispatch`, triggered from a Google Sheets Apps Script button) runs a Python script that:
1. Reads the sheet for the current list of items
2. Downloads new photos from a shared Drive folder
3. Resizes and converts them to WebP at all three sizes using Pillow
4. Validates that every item has at least one image
5. Cleans up images for items removed from the sheet
6. Commits the updated CSV and images directly to the repo, then publishes the site

Before writing the CSV, `scripts/validate.py` normalises the sheet data and reports on it: cosmetic problems (stray whitespace, currency symbols, accent and case variations) are cleaned silently, genuinely ambiguous rows are quarantined without failing the run, and suspicious-but-legal changes are flagged. Prices are never guessed at. Findings are written in French into `scripts/.last_run.json`, which the client reads from a Google Sheets popup.

The result of each run is written to `scripts/.last_run.json` and committed, so the shop owner can check the status of the last update from a second Apps Script button without leaving Google Sheets.

### Deployment
The site is built and published by GitHub Actions (`.github/workflows/deploy.yml`), which runs `jekyll build` and then `wrangler pages deploy`. Cloudflare's own Git integration is deliberately disconnected, so CI is the sole publisher and a failed publish is a visibly failed workflow run rather than a silently stale site. See [docs/decisions.md](docs/decisions.md) for why.

### Instagram integration
The homepage displays the shop's latest Instagram post, fetched at request time via a Cloudflare Pages Function (`functions/instagram.js`). The function reads the access token from Cloudflare KV storage and proxies the Instagram Graph API, keeping the token server-side. Responses are cached at the edge for 15 minutes.

That token is kept alive by a scheduled Cloudflare Worker, recorded in [`workers/atelier-refresher/`](workers/atelier-refresher/). It is deployed by hand, not by CI — see that directory's README before touching it.

### Responsive design
Fully responsive layout built with Tailwind CSS. The navbar collapses to a burger menu on mobile. The catalog grid adapts from 1 to 3 columns depending on screen size.

## Documentation

- [docs/decisions.md](docs/decisions.md) — why the project is shaped the way it is, and the traps that cost time to find. **Worth reading before changing the build, the deploy pipeline or the catalogue automation.**
- [docs/ecommerce-brief.md](docs/ecommerce-brief.md) — the brief for turning the catalogue into a shop.
- [docs/shop-runbook.md](docs/shop-runbook.md) — how the shop is wired, its secrets, the launch checklist, and what to do when it misbehaves.
- [workers/atelier-refresher/README.md](workers/atelier-refresher/README.md) — the Instagram token refresher.

New decisions and hard-won findings go in `docs/decisions.md`, newest first.

## Working on this repo

```bash
bundle exec jekyll build                                   # build to _site/
npm run build:css                                          # after adding Tailwind classes
python3 -m unittest discover -s scripts -p 'test_*.py'     # catalogue validation + reconcile tests
npm ci && npm test                                         # shop Functions on a local D1 (races checkouts)
npx wrangler pages dev _site                               # the built site + Functions locally
```

Anything added as a new top-level directory must go in the `exclude` list in `_config.yml`, or Jekyll will publish it on the live site.
