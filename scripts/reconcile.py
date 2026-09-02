"""
Atelier Sauvage — write online sales back to the Google Sheet.

Reads the sales the ledger has not yet written back (GET /api/reconcile on
the deployed site, bearer-authenticated), writes "Vendu" into the statut
column of the matching rows, then tells the ledger they are written. The
caller (reconcile.yml) rebuilds the site afterwards so the catalogue shows
them as sold.

The Sheet stays the source of truth: nothing is written to catalog.csv here,
because update_catalog.py rewrites that file from the Sheet on every run.

Requires, unlike update_catalog.py:
  - the spreadsheets scope (not readonly), and
  - the service account shared on the Sheet as Editor.
Both, or the write fails with a confusing 403.

Env: SHOP_API_BASE, RECONCILE_TOKEN, GOOGLE_CREDENTIALS_JSON, SHEET_ID
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

SHEET_TAB = "Sheet1"
STATUT_HEADER = "statut"
NUMBER_HEADER = "number"
SOLD = "Vendu"


# ── Pure planning (unit-tested) ───────────────────────────────────────────────

def column_letter(index: int) -> str:
    """0 -> A, 25 -> Z, 26 -> AA."""
    letters = ""
    index += 1
    while index:
        index, rem = divmod(index - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def plan_updates(values: list[list[str]], sales: list[dict]) -> tuple[list[dict], list[str], list[str]]:
    """
    values -- the sheet as rows (header first), as returned by the API
    sales  -- [{"number": "24b", ...}, ...] from the ledger

    Returns (updates, already_sold, missing):
      updates      -- [{"range": "Sheet1!E12", "number": "24b"}] cells to set to Vendu
      already_sold -- numbers whose statut is already Vendu (mark written, no write)
      missing      -- numbers not found in column `number` (left unwritten, reported)
    """
    if not values:
        raise ValueError("Sheet is empty")
    header = [h.strip().lower() for h in values[0]]
    if NUMBER_HEADER not in header or STATUT_HEADER not in header:
        raise ValueError(f"Sheet header lacks '{NUMBER_HEADER}' or '{STATUT_HEADER}': {values[0]}")
    number_col = header.index(NUMBER_HEADER)
    statut_col = header.index(STATUT_HEADER)
    letter = column_letter(statut_col)

    rows_by_number: dict[str, int] = {}
    for offset, row in enumerate(values[1:], start=2):
        number = (row[number_col] if len(row) > number_col else "").strip()
        if number and number not in rows_by_number:
            rows_by_number[number] = offset

    updates, already_sold, missing = [], [], []
    for sale in sales:
        number = str(sale["number"]).strip()
        row = rows_by_number.get(number)
        if row is None:
            missing.append(number)
            continue
        current = values[row - 1]
        statut = (current[statut_col] if len(current) > statut_col else "").strip()
        if statut.lower() == SOLD.lower():
            already_sold.append(number)
        else:
            updates.append({"range": f"{SHEET_TAB}!{letter}{row}", "number": number})
    return updates, already_sold, missing


# ── I/O ───────────────────────────────────────────────────────────────────────

def api(method: str, path: str, payload=None):
    base = os.environ["SHOP_API_BASE"].rstrip("/")
    token = os.environ["RECONCILE_TOKEN"]
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(f"{base}{path}", data=data, method=method, headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "atelier-sauvage-reconcile/1",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read())
    except urllib.error.HTTPError as err:
        raise SystemExit(f"::error::{method} {path} -> {err.code} {err.read().decode(errors='replace')[:300]}")


def sheets_service():
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    creds = service_account.Credentials.from_service_account_info(
        json.loads(os.environ["GOOGLE_CREDENTIALS_JSON"]),
        scopes=["https://www.googleapis.com/auth/spreadsheets"],
    )
    return build("sheets", "v4", credentials=creds)


def set_output(name: str, value: str):
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(f"{name}={value}\n")


def main() -> int:
    sales = api("GET", "/api/reconcile").get("sales", [])
    print(f"ledger: {len(sales)} sale(s) not yet in the Sheet")
    if not sales:
        set_output("written", "false")
        return 0

    sheets = sheets_service()
    sheet_id = os.environ["SHEET_ID"]
    values = (sheets.spreadsheets().values()
              .get(spreadsheetId=sheet_id, range=f"{SHEET_TAB}!A:Z").execute()
              .get("values", []))

    updates, already_sold, missing = plan_updates(values, sales)
    for number in missing:
        print(f"::warning::sold item {number} is not in the Sheet -- left unwritten")

    if updates:
        sheets.spreadsheets().values().batchUpdate(
            spreadsheetId=sheet_id,
            body={
                "valueInputOption": "RAW",
                "data": [{"range": u["range"], "values": [[SOLD]]} for u in updates],
            },
        ).execute()
        print("wrote Vendu for: " + ", ".join(u["number"] for u in updates))
    if already_sold:
        print("already Vendu in the Sheet: " + ", ".join(already_sold))

    done = [u["number"] for u in updates] + already_sold
    if done:
        marked = api("POST", "/api/reconcile", {"numbers": done}).get("marked")
        print(f"ledger: marked {marked} item(s) as written back")

    set_output("written", "true" if updates else "false")
    return 0


if __name__ == "__main__":
    sys.exit(main())
