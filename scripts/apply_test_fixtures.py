"""
Preview-only test data for the shop.

The Sheet does not yet carry the transport/poids/dimensions/etat columns, so
nothing is buyable and a preview deployment cannot exercise checkout. When
deploy.yml is dispatched against a branch with test_fixtures=true, this adds
those columns to the CSV in the CI checkout (never committed) and gives a
handful of sellable items placeholder bands.

deploy.yml refuses to run this on main.
"""

import csv
import json
import sys
from pathlib import Path

CSV_PATH = Path("_database/catalog.csv")
VALIDATION_PATH = Path("_database/catalog_validation.json")
COLUMNS = ["transport", "poids", "dimensions", "etat"]
BANDS = ["S", "M", "L", "XL"]
FIXTURE_COUNT = 12


def main():
    sellable = json.loads(VALIDATION_PATH.read_text(encoding="utf-8"))["sellable"]
    with open(CSV_PATH, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f, delimiter=";")
        headers = list(reader.fieldnames)
        rows = list(reader)

    for column in COLUMNS:
        if column not in headers:
            headers.append(column)

    chosen = []
    for row in rows:
        number = row["number"].strip()
        if number in sellable and (row.get("statut") or "").strip() == "" and len(chosen) < FIXTURE_COUNT:
            band = BANDS[len(chosen) % len(BANDS)]
            row["transport"] = band
            row["poids"] = {"S": "1", "M": "4", "L": "12", "XL": "35"}[band]
            row["dimensions"] = {"S": "20 x 15 x 10", "M": "45 x 30 x 30", "L": "90 x 60 x 40", "XL": "180 x 80 x 75"}[band]
            row["etat"] = "Bon état général, traces d'usage (données de test)"
            chosen.append((number, band))

    with open(CSV_PATH, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f, delimiter=";")
        writer.writerow(headers)
        for row in rows:
            writer.writerow([row.get(h, "") or "" for h in headers])

    print(f"test fixtures: {len(chosen)} item(s) given placeholder bands: "
          + ", ".join(f"{n}={b}" for n, b in chosen))
    return 0


if __name__ == "__main__":
    sys.exit(main())
