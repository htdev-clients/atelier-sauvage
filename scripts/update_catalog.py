"""
Atelier Sauvage — catalog update script.
Reads the Google Sheet, downloads new photos from Google Drive,
validates coverage, cleans up orphans, updates _database/catalog.csv.

Run by GitHub Actions (workflow_dispatch). Not intended for direct use.

Required env var:
  GOOGLE_CREDENTIALS_JSON  — service account JSON (stored as GitHub secret)
"""

import csv
import io
import json
import os
import sys
from pathlib import Path
from datetime import datetime, timezone

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from PIL import Image, ImageOps

# ── Config ────────────────────────────────────────────────────────────────────

SHEET_ID    = "1JyYUQBV6BARw3A-sjA8Ovv_SXCF0vCwLPzlzQi-hgrU"
SHEET_TAB   = "Sheet1"
FOLDER_ID   = "1zMb6P3HeqsBWinUfDELrblCtERiEdyc3"

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
]

SIZES        = [480, 800, 1400]
WEBP_QUALITY = 85
CATALOG_DIR   = Path("assets/img/catalog")
CSV_PATH      = Path("_database/catalog.csv")
LAST_RUN_PATH = Path("scripts/.last_run.json")

# ── Auth ──────────────────────────────────────────────────────────────────────

def get_services():
    creds_json = os.environ["GOOGLE_CREDENTIALS_JSON"]
    creds_info = json.loads(creds_json)
    creds = service_account.Credentials.from_service_account_info(
        creds_info, scopes=SCOPES
    )
    sheets = build("sheets", "v4", credentials=creds)
    drive  = build("drive",  "v3", credentials=creds)
    return sheets, drive

# ── Sheet ─────────────────────────────────────────────────────────────────────

def get_sheet_items(sheets) -> list[str]:
    """Return ordered list of item numbers from the sheet (skips header)."""
    result = (
        sheets.spreadsheets()
        .values()
        .get(spreadsheetId=SHEET_ID, range=f"{SHEET_TAB}!A:A")
        .execute()
    )
    values = result.get("values", [])
    return [row[0].strip() for row in values[1:] if row and row[0].strip()]


def update_csv(sheets):
    result = (
        sheets.spreadsheets()
        .values()
        .get(spreadsheetId=SHEET_ID, range=f"{SHEET_TAB}!A:Z")
        .execute()
    )
    values = result.get("values", [])
    if not values:
        raise ValueError("Sheet is empty")

    headers = values[0]
    rows    = values[1:]

    with open(CSV_PATH, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f, delimiter=";")
        writer.writerow(headers)
        for row in rows:
            while len(row) < len(headers):
                row.append("")
            writer.writerow(row)

    print(f"CSV: wrote {len(rows)} rows → {CSV_PATH}")

# ── Images ────────────────────────────────────────────────────────────────────

def parse_drive_filename(name: str):
    """
    '100.jpg'    → ('100', None)
    '100-1.jpg'  → ('100', 1)
    '155a-2.jpg' → ('155a', 2)
    """
    stem = Path(name).stem
    parts = stem.rsplit("-", 1)
    if len(parts) == 2 and parts[1].isdigit():
        return parts[0], int(parts[1])
    return stem, None


def item_number_from_webp(filename: str) -> str:
    """
    '100-1400.webp'    → '100'
    '100-1-1400.webp'  → '100'
    '155a-1-1400.webp' → '155a'
    """
    stem = filename.replace("-1400.webp", "")
    parts = stem.rsplit("-", 1)
    if len(parts) == 2 and parts[1].isdigit():
        return parts[0]
    return stem


def webp_path(item_number: str, index, size: int) -> Path:
    suffix = f"-{index}" if index is not None else ""
    return CATALOG_DIR / str(size) / f"{item_number}{suffix}-{size}.webp"


def process_image(data: bytes, item_number: str, index):
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img)
    for size in SIZES:
        out = webp_path(item_number, index, size)
        out.parent.mkdir(parents=True, exist_ok=True)
        resized = img.copy()
        resized.thumbnail((size, size * 4))
        resized.save(out, "WEBP", quality=WEBP_QUALITY)
        print(f"  → {out}")


def download_new_photos(drive):
    results = (
        drive.files()
        .list(
            q=f"'{FOLDER_ID}' in parents and trashed=false and mimeType contains 'image/'",
            fields="files(id, name)",
            pageSize=500,
        )
        .execute()
    )
    files = results.get("files", [])
    print(f"Drive folder: {len(files)} image(s) found")

    processed = skipped = 0

    for f in files:
        name = f["name"]
        item_number, index = parse_drive_filename(name)

        if webp_path(item_number, index, 1400).exists():
            skipped += 1
            continue

        print(f"Processing {name} ...")
        request = drive.files().get_media(fileId=f["id"])
        buf = io.BytesIO()
        dl = MediaIoBaseDownload(buf, request)
        done = False
        while not done:
            _, done = dl.next_chunk()

        process_image(buf.getvalue(), item_number, index)
        processed += 1

    print(f"Images: {processed} new, {skipped} already processed")

# ── Validation ────────────────────────────────────────────────────────────────

def validate_coverage(sheet_items: list[str]) -> list[str]:
    """Return item numbers that have no main image in the repo."""
    missing = []
    for number in sheet_items:
        if not webp_path(number, None, 1400).exists():
            missing.append(number)
    return missing

# ── Cleanup ───────────────────────────────────────────────────────────────────

def cleanup_orphans(sheet_items: list[str]) -> int:
    """Delete WebP files for items no longer in the sheet."""
    item_set = set(sheet_items)
    deleted = 0
    for size in SIZES:
        size_dir = CATALOG_DIR / str(size)
        if not size_dir.exists():
            continue
        for webp in sorted(size_dir.glob("*.webp")):
            item = item_number_from_webp(webp.name)
            if item not in item_set:
                print(f"  Deleting orphan: {webp}")
                webp.unlink()
                deleted += 1
    return deleted

# ── Result files ──────────────────────────────────────────────────────────────

def write_summary(content: str):
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "w") as f:
            f.write(content)


def write_last_run(status: str, message: str, missing_items: list[str] = []):
    payload = {
        "status": status,
        "message": message,
        "missing_items": missing_items,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    LAST_RUN_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LAST_RUN_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=== Atelier Sauvage catalog update ===")
    sheets, drive = get_services()

    # 1. Get item list from sheet
    sheet_items = get_sheet_items(sheets)
    print(f"Sheet: {len(sheet_items)} items")

    # 2. Download new photos (must happen before validation)
    print("\nDownloading new photos...")
    download_new_photos(drive)

    # 3. Validate: every sheet item must have a main image
    print("\nValidating image coverage...")
    missing = validate_coverage(sheet_items)
    if missing:
        msg = (
            f"VALIDATION FAILED — {len(missing)} item(s) in the sheet have no image:\n"
            + "\n".join(f"  - {n}" for n in missing)
            + "\n\nAdd the missing images to the Drive folder and trigger the update again."
        )
        print(f"\n❌ {msg}")
        write_summary(
            "## Catalog update failed — missing images\n\n"
            f"**{len(missing)} item(s)** are in the spreadsheet but have no image in the Drive folder:\n\n"
            + "\n".join(f"- `{n}`" for n in missing)
            + "\n\nAdd the missing images and trigger the update again."
        )
        write_last_run(
            "failure",
            f"{len(missing)} article(s) sans image dans le Drive.",
            missing,
        )
        sys.exit(1)

    print(f"  All {len(sheet_items)} items have images.")

    # 4. Delete images for items removed from the sheet
    print("\nCleaning up orphaned images...")
    deleted = cleanup_orphans(sheet_items)
    print(f"  {deleted} file(s) deleted." if deleted else "  Nothing to clean up.")

    # 5. Update CSV
    print("\nUpdating CSV...")
    update_csv(sheets)

    write_summary(
        "## Catalog update successful\n\n"
        f"- **{len(sheet_items)}** items in catalog\n"
        f"- **{deleted}** orphaned image(s) removed\n"
    )
    write_last_run(
        "success",
        f"{len(sheet_items)} articles mis à jour, {deleted} image(s) supprimée(s).",
    )

    print("\n=== Done ===")


if __name__ == "__main__":
    main()
