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
The catalog is driven by a CSV file (`_database/catalog.csv`) generated from a Google Sheet. A custom Jekyll plugin (`_plugins/catalog_generator.rb`) reads the CSV at build time and generates one page per item, automatically detecting how many photos each item has by checking for indexed image files on disk.

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
6. Commits the updated CSV and images directly to the repo, triggering a new Cloudflare Pages deploy

The result of each run is written to `scripts/.last_run.json` and committed, so the shop owner can check the status of the last update from a second Apps Script button without leaving Google Sheets.

### Instagram integration
The homepage displays the shop's latest Instagram post, fetched at request time via a Cloudflare Pages Function (`functions/instagram.js`). The function reads the access token from Cloudflare KV storage and proxies the Instagram Graph API, keeping the token server-side. Responses are cached at the edge for 15 minutes.

### Responsive design
Fully responsive layout built with Tailwind CSS. The navbar collapses to a burger menu on mobile. The catalog grid adapts from 1 to 3 columns depending on screen size.

## Project structure

```
.
├── _database/
│   └── catalog.csv           # Catalog data (source of truth: Google Sheets)
├── _includes/                # Jekyll partials (navbar, footer, product card, lightbox)
├── _layouts/                 # Page layouts
├── _plugins/
│   └── catalog_generator.rb  # Reads CSV, generates catalog pages, detects image count
├── assets/
│   ├── css/                  # Tailwind source + compiled output
│   ├── fonts/
│   ├── img/catalog/          # Product images (480 / 800 / 1400px WebP)
│   └── js/                   # Vanilla JS (lightbox, navbar, Instagram card)
├── functions/
│   └── instagram.js          # Cloudflare Pages Function — Instagram proxy
├── scripts/
│   ├── update_catalog.py     # Catalog automation script (run by GitHub Actions)
│   ├── convert_to_webp.py    # One-time JPEG → WebP migration script
│   └── .last_run.json        # Written on every pipeline run (success or failure)
└── .github/workflows/
    └── update_catalog.yml    # GitHub Actions workflow (workflow_dispatch)
```

## Environment variables

The automation pipeline relies on the following variables, none of which are stored in the repository:

| Name | Where | Used by |
|---|---|---|
| `GOOGLE_CREDENTIALS_JSON` | GitHub secret | `update_catalog.py` — Google Sheets & Drive auth |
| `SHEET_ID` | GitHub variable | `update_catalog.py` — target spreadsheet |
| `FOLDER_ID` | GitHub variable | `update_catalog.py` — Drive folder with photos |
| `INSTAGRAM_TOKEN` | Cloudflare KV | `functions/instagram.js` — Instagram Graph API |
