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
import re
import sys
from pathlib import Path
from datetime import datetime, timezone

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from PIL import Image, ImageOps

import validate as validation

# ── Config ────────────────────────────────────────────────────────────────────

SHEET_ID    = os.environ["SHEET_ID"]
SHEET_TAB   = "Sheet1"
FOLDER_ID   = os.environ["FOLDER_ID"]

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive",
]

SIZES        = [480, 800, 1400]
WEBP_QUALITY = 85
CATALOG_DIR   = Path("assets/img/catalog")
CSV_PATH      = Path("_database/catalog.csv")
LAST_RUN_PATH = Path("scripts/.last_run.json")
VALIDATION_PATH = Path("_database/catalog_validation.json")

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


def load_previous_rows() -> dict:
    """
    Return {number: {"prix", "statut"}} from the CSV currently on disk.

    This is the state the incoming sheet is compared against, so the run can
    flag a price that moved a long way or an item that stopped being sold.
    """
    if not CSV_PATH.exists():
        return {}
    with open(CSV_PATH, encoding="utf-8-sig", newline="") as f:
        return {
            row["number"].strip(): {
                "prix": row.get("prix", ""),
                "statut": row.get("statut", ""),
            }
            for row in csv.DictReader(f, delimiter=";")
            if (row.get("number") or "").strip()
        }


def load_existing_items() -> set[str]:
    """Return item numbers currently in the CSV (before this run)."""
    return set(load_previous_rows())


def update_csv(sheets, previous: dict):
    """Read the sheet, normalise it, write the CSV. Returns the validation report."""
    result = (
        sheets.spreadsheets()
        .values()
        .get(spreadsheetId=SHEET_ID, range=f"{SHEET_TAB}!A:Z")
        .execute()
    )
    values = result.get("values", [])
    if not values:
        raise ValueError("Sheet is empty")

    headers  = values[0]
    raw_rows = []
    for row in values[1:]:
        padded = list(row) + [""] * (len(headers) - len(row))
        raw_rows.append(dict(zip(headers, padded)))

    clean_rows, report = validation.validate(raw_rows, previous)

    with open(CSV_PATH, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f, delimiter=";")
        writer.writerow(headers)
        for row in clean_rows:
            writer.writerow([row.get(h, "") for h in headers])

    print(f"CSV: wrote {len(clean_rows)} rows → {CSV_PATH}")
    if report["normalised"]:
        print(f"  {len(report['normalised'])} field(s) normalised")
    for entry in report["dropped"]:
        print(f"  ⚠ dropped {entry['item']}: {entry['reason']}")
    for entry in report["not_sellable"]:
        print(f"  ⚠ not sellable {entry['item']}: {entry['reason']}")
    for entry in report["warnings"]:
        print(f"  ⚠ check {entry['item']}: {entry['detail']}")

    write_validation(clean_rows, report)
    return report

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
    '100-480.webp'     → '100'
    '100-1-1400.webp'  → '100'
    '100-1-480.webp'   → '100'
    '155a-1-800.webp'  → '155a'
    """
    stem = Path(filename).stem  # strip .webp
    # strip trailing size (-480, -800, -1400)
    parts = stem.rsplit("-", 1)
    if len(parts) == 2 and parts[1].isdigit():
        stem = parts[0]
    # strip optional index (-1, -2, ...)
    parts = stem.rsplit("-", 1)
    if len(parts) == 2 and parts[1].isdigit():
        stem = parts[0]
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


def download_photos(drive, existing_items: set[str]):
    """
    Download and process all photos from the Drive folder.
    Returns (new_lots, updated_lots, total) where:
      - new_lots: sorted list of item numbers not in existing_items
      - updated_lots: sorted list of existing item numbers that received new photos
      - total: number of files processed
    """
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

    new_lots     = set()
    updated_lots = set()

    for f in files:
        name = f["name"]
        item_number, index = parse_drive_filename(name)
        print(f"Processing {name} ...")
        try:
            request = drive.files().get_media(fileId=f["id"])
            buf = io.BytesIO()
            dl = MediaIoBaseDownload(buf, request)
            done = False
            while not done:
                _, done = dl.next_chunk()
            process_image(buf.getvalue(), item_number, index)
        except Exception as e:
            print(f"  ERROR processing {name}: {e}")
            continue
        if item_number in existing_items:
            updated_lots.add(item_number)
        else:
            new_lots.add(item_number)

    return sorted(new_lots), sorted(updated_lots), len(files)

# ── Validation ────────────────────────────────────────────────────────────────

def validate_coverage(sheet_items: list[str]) -> list[str]:
    """Return item numbers that have no main image in the repo."""
    missing = []
    for number in sheet_items:
        if not webp_path(number, None, 1400).exists():
            missing.append(number)
    return missing


def check_numbering(sheet_items: list[str]) -> list[dict]:
    """
    Report items whose extra images are not numbered contiguously from 1.

    A gap (e.g. 354, 354-1, 354-3) means the client skipped a number when
    uploading to Drive. The site renders such items correctly, so this is a
    warning rather than a failure -- but the numbering should be tidied up in
    Drive, otherwise it drifts further with every batch.
    """
    size_dir = CATALOG_DIR / "1400"
    if not size_dir.exists():
        return []

    found: dict[str, list[int]] = {}
    for webp in size_dir.glob("*.webp"):
        m = re.fullmatch(r"(.+)-(\d+)-1400\.webp", webp.name)
        if m:
            found.setdefault(m.group(1), []).append(int(m.group(2)))

    warnings = []
    for number in sheet_items:
        indices = sorted(found.get(number, []))
        if not indices or indices == list(range(1, len(indices) + 1)):
            continue
        expected = list(range(1, len(indices) + 1))
        warnings.append({
            "item": number,
            "found": indices,
            "missing": [n for n in expected if n not in indices],
            "renames": [
                {"from": f"{number}-{old}.jpg", "to": f"{number}-{new}.jpg"}
                for old, new in zip(indices, expected) if old != new
            ],
        })
    return warnings


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


def write_validation(clean_rows: list, report: dict):
    """
    Machine-readable twin of the run report.

    Records which items are safe to sell online, so the site, the future order
    ledger and Stripe all read sellability from one place rather than each
    re-deriving it from the CSV.
    """
    payload = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "sellable": sorted(r["number"] for r in clean_rows if r.get("_sellable")),
        "not_sellable": {n["item"]: n["reason"] for n in report["not_sellable"]},
        "report": report,
    }
    VALIDATION_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(VALIDATION_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def write_last_run(payload: dict):
    payload["timestamp"] = datetime.now(timezone.utc).isoformat()
    LAST_RUN_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LAST_RUN_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=== Atelier Sauvage catalog update ===")
    try:
        _run()
    except SystemExit:
        raise
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        try:
            write_last_run({"status": "failure", "message": str(e)})
        except Exception:
            pass
        sys.exit(1)


def _run():
    sheets, drive = get_services()

    # 1. Load existing items before any changes
    previous_rows  = load_previous_rows()
    existing_items = set(previous_rows)
    print(f"CSV: {len(existing_items)} existing lots")

    # 2. Get item list from sheet
    sheet_items = get_sheet_items(sheets)
    print(f"Sheet: {len(sheet_items)} lots")

    new_lots     = sorted(set(sheet_items) - existing_items)
    removed_lots = sorted(existing_items - set(sheet_items))

    # 3. Download new photos (must happen before validation)
    print("\nDownloading photos from Drive...")
    new_photo_lots, updated_photo_lots, total_downloaded = download_photos(
        drive, existing_items
    )

    # 4. Validate: every sheet item must have a main image
    print("\nValidating image coverage...")
    missing = validate_coverage(sheet_items)
    if missing:
        print(f"\n❌ VALIDATION FAILED — {len(missing)} lot(s) sans image")
        write_summary(
            "## Mise à jour du catalogue échouée — lots sans image\n\n"
            f"**{len(missing)} lot(s)** dans la feuille sans image dans le Drive :\n\n"
            + "\n".join(f"- `{n}`" for n in missing)
            + "\n\nAjoutez les images et relancez la mise à jour."
        )
        write_last_run({
            "status": "failure",
            "message": f"{len(missing)} lot(s) sans image dans le Drive.",
            "missing_lots": missing,
        })
        sys.exit(1)

    print(f"  All {len(sheet_items)} lots have images.")

    # 4b. Warn (do not fail) on non-contiguous image numbering
    print("\nChecking image numbering...")
    numbering_warnings = check_numbering(sheet_items)
    for w in numbering_warnings:
        print(f"  ⚠ Lot {w['item']}: indices {w['found']}, missing {w['missing']}")
    if not numbering_warnings:
        print("  Numbering is contiguous for all lots.")

    # 5. Delete images for items removed from the sheet
    print("\nCleaning up orphaned images...")
    deleted_files = cleanup_orphans(sheet_items)
    print(f"  {deleted_files} file(s) deleted." if deleted_files else "  Nothing to clean up.")

    # 6. Update CSV
    print("\nUpdating CSV...")
    validation_report = update_csv(sheets, previous_rows)

    numbering_note = ""
    if numbering_warnings:
        lines = ["\n### ⚠️ Numérotation des photos à corriger\n"]
        for w in numbering_warnings:
            found   = ", ".join(str(n) for n in w["found"])
            missing = ", ".join(str(n) for n in w["missing"])
            lines.append(
                f"\n**Lot {w['item']}** — photos trouvées : {found} "
                f"(il manque : {missing}).\n\n"
                "Renommez dans le Drive :\n"
                + "\n".join(f"- `{r['from']}` → `{r['to']}`" for r in w["renames"])
                + "\n"
            )
        lines.append(
            "\nLes photos s'affichent correctement sur le site malgré tout — "
            "ce renommage évite que la numérotation ne dérive davantage.\n"
        )
        numbering_note = "".join(lines)

    write_summary(
        "## Mise à jour du catalogue réussie\n\n"
        f"- **{len(sheet_items)}** lots au total\n"
        + (f"- **{len(new_lots)}** nouveau(x) lot(s) : {', '.join(new_lots)}\n" if new_lots else "")
        + (f"- **{len(removed_lots)}** lot(s) supprimé(s) : {', '.join(removed_lots)}\n" if removed_lots else "")
        + (f"- **{len(updated_photo_lots)}** lot(s) existant(s) avec nouvelles photos : {', '.join(updated_photo_lots)}\n" if updated_photo_lots else "")
        + (f"- **{total_downloaded}** photo(s) traitée(s)\n" if total_downloaded else "")
        + numbering_note
        + validation.summary_markdown(validation_report)
    )
    write_last_run({
        "status": "success",
        "total_lots": len(sheet_items),
        "new_lots": new_lots,
        "removed_lots": removed_lots,
        "photos_downloaded": total_downloaded,
        "photos_added_to_existing": updated_photo_lots,
        "orphaned_images_deleted": deleted_files,
        "fields_cleaned": len(validation_report["normalised"]),
        "dropped_rows": validation_report["dropped"],
        "not_sellable": validation_report["not_sellable"],
        "data_warnings": validation_report["warnings"],
        "data_message": validation.popup_message(validation_report),
        "numbering_warnings": numbering_warnings,
        "numbering_message": "; ".join(
            f"Lot {w['item']} : il manque la/les photo(s) "
            + ", ".join(str(n) for n in w["missing"])
            for w in numbering_warnings
        ),
    })

    print("\n=== Done ===")


if __name__ == "__main__":
    main()
