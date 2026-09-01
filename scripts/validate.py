"""
Atelier Sauvage — catalog data validation and normalisation.

Pure functions: no Google API calls, no filesystem access. update_catalog.py
calls validate() between reading the sheet and writing the CSV, which keeps
these rules unit-testable against fixtures.

Three tiers, by design:

  1. NORMALISE silently. A trailing space in a price is a typing slip, not an
     error. Cosmetic problems are cleaned and listed in the report so they can
     be fixed at source, but they never hold up a run.

  2. QUARANTINE one item, never the batch. Failing a whole run because of one
     bad cell punishes every other edit the client made. A structurally
     unusable row is dropped; an ambiguous price only costs that item its
     'sellable' flag -- it still appears in the catalogue.

  3. WARN and block nothing. Suspicious-but-legal changes (a price that moved a
     long way, a sold item coming back) are surfaced for a human to judge.

Prices are deliberately not guessed at. '1.250' might mean 1250 or 1.25, and
picking one is how you end up charging the wrong amount, so anything that is
not a plain run of digits after whitespace and currency symbols are stripped
gets reported rather than interpreted.
"""

from __future__ import annotations

import re
import unicodedata

CATEGORIES = ("Meuble", "Décoration", "Luminaire")
STATUT_SOLD = "Vendu"
STATUT_PENDING = "pending"

# A price moving further than this between runs is worth a human glance.
PRICE_JUMP_RATIO = 0.4
# The sheet shrinking by more than this suggests a truncated read, not deletions.
COUNT_DROP_RATIO = 0.10

_WHITESPACE = re.compile(r"\s+")
# \s covers the non-breaking and narrow no-break spaces too, under Python 3.
_CURRENCY = re.compile(r"[€\s]")
_SAFE_NUMBER = re.compile(r"[0-9a-zA-Z]+")


# ── Field-level normalisation ─────────────────────────────────────────────────

def _fold(text: str) -> str:
    """Lowercase and strip accents, so 'decoration' matches 'Décoration'."""
    decomposed = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def clean_text(value) -> str:
    """Trim, and collapse internal whitespace (newlines included) to single spaces."""
    if value is None:
        return ""
    return _WHITESPACE.sub(" ", str(value)).strip()


def clean_price(raw) -> tuple[int | None, str, str | None]:
    """
    Return (value, cleaned_text, problem).

    value is an int when the price is unambiguous, otherwise None and problem
    explains why, in French, for the client.
    """
    text = clean_text(raw)
    if text == "":
        return None, "", "prix manquant"

    stripped = _CURRENCY.sub("", text)
    if stripped.isdigit():
        value = int(stripped)
        if value <= 0:
            return None, stripped, "prix à zéro"
        return value, stripped, None

    return None, text, f"prix illisible : « {text} »"


def clean_statut(raw) -> str:
    """Canonicalise the status. Unknown values are passed through untouched."""
    text = clean_text(raw)
    folded = _fold(text)
    if folded == "":
        return ""
    if folded == "vendu":
        return STATUT_SOLD
    if folded == "pending":
        return STATUT_PENDING
    return text


def clean_category(raw) -> str:
    """Canonicalise the category case. Unknown values are passed through."""
    text = clean_text(raw)
    for category in CATEGORIES:
        if _fold(text) == _fold(category):
            return category
    return text


# ── Row-level validation ──────────────────────────────────────────────────────

def validate(rows: list[dict], previous: dict | None = None) -> tuple[list[dict], dict]:
    """
    rows     -- list of dicts straight from the sheet, keyed by header
    previous -- {number: {"prix": str, "statut": str}} from the CSV on disk

    Returns (clean_rows, report). clean_rows is safe to write to the CSV.
    """
    previous = previous or {}
    report = {
        "normalised": [],
        "dropped": [],
        "not_sellable": [],
        "warnings": [],
    }

    clean_rows: list[dict] = []
    seen: set[str] = set()

    for index, row in enumerate(rows):
        number = clean_text(row.get("number"))

        if number == "":
            report["dropped"].append({
                "item": f"ligne {index + 2}",
                "reason": "numéro manquant",
            })
            continue

        if not _SAFE_NUMBER.fullmatch(number):
            report["dropped"].append({
                "item": number,
                "reason": "numéro contenant des caractères invalides",
            })
            continue

        if number in seen:
            report["dropped"].append({
                "item": number,
                "reason": "numéro en double (seule la première ligne est conservée)",
            })
            continue
        seen.add(number)

        clean = dict(row)
        clean["number"] = number

        def note(field: str, before, after):
            if str(before or "") != after:
                report["normalised"].append({
                    "item": number,
                    "field": field,
                    "from": str(before or ""),
                    "to": after,
                })

        for field, cleaner in (
            ("description", clean_text),
            ("category", clean_category),
            ("statut", clean_statut),
        ):
            if field in row:
                after = cleaner(row.get(field))
                note(field, row.get(field), after)
                clean[field] = after

        category = clean.get("category", "")
        if category and category not in CATEGORIES:
            report["warnings"].append({
                "item": number,
                "kind": "unknown_category",
                "detail": f"catégorie « {category} » inconnue — elle ajoutera un "
                          f"filtre supplémentaire sur la page catalogue",
            })

        value, cleaned_price, problem = clean_price(row.get("prix"))
        if "prix" in row:
            note("prix", row.get("prix"), cleaned_price)
        clean["prix"] = cleaned_price

        statut = clean.get("statut", "")
        sellable = value is not None and statut not in (STATUT_SOLD, STATUT_PENDING)

        # A sold or pending item is not meant to be for sale, so a missing or
        # unreadable price on one is not worth reporting.
        if problem and statut not in (STATUT_SOLD, STATUT_PENDING):
            report["not_sellable"].append({"item": number, "reason": problem})

        # A transport band is only required once the column exists in the sheet.
        if "transport" in row and sellable:
            band = clean_text(row.get("transport")).upper()
            clean["transport"] = band
            if band not in ("S", "M", "L", "XL"):
                sellable = False
                report["not_sellable"].append({
                    "item": number,
                    "reason": "catégorie de transport manquante ou inconnue",
                })

        clean["_sellable"] = sellable
        clean["_price_value"] = value

        _check_against_previous(number, value, statut, previous, report)

        clean_rows.append(clean)

    _check_count_drop(len(clean_rows), previous, report)

    return clean_rows, report


def _check_against_previous(number, value, statut, previous, report):
    """Flag a large price move, or an item coming back from sold."""
    before = previous.get(number)
    if not before:
        return

    old_value, _, old_problem = clean_price(before.get("prix"))
    if value is not None and old_value not in (None, 0) and not old_problem:
        delta = abs(value - old_value) / old_value
        if delta > PRICE_JUMP_RATIO:
            report["warnings"].append({
                "item": number,
                "kind": "price_jump",
                "detail": f"prix passé de {old_value} € à {value} € "
                          f"({delta * 100:.0f} % d'écart)",
            })

    if clean_statut(before.get("statut")) == STATUT_SOLD and statut != STATUT_SOLD:
        report["warnings"].append({
            "item": number,
            "kind": "unsold",
            "detail": "l'article était marqué « Vendu » et ne l'est plus",
        })


def _check_count_drop(new_count, previous, report):
    """A sharp shrink usually means a truncated read, not a real deletion."""
    old_count = len(previous)
    if old_count == 0 or new_count >= old_count:
        return
    drop = (old_count - new_count) / old_count
    if drop > COUNT_DROP_RATIO:
        report["warnings"].append({
            "item": "—",
            "kind": "count_drop",
            "detail": f"le catalogue est passé de {old_count} à {new_count} lots "
                      f"({drop * 100:.0f} % de moins)",
        })


# ── Reporting, in French, for the client ─────────────────────────────────────

def has_anything_to_report(report: dict) -> bool:
    return any(report[key] for key in ("dropped", "not_sellable", "warnings"))


def summary_markdown(report: dict) -> str:
    """Section appended to the GitHub Actions run summary."""
    parts = []

    if report["dropped"]:
        parts.append("\n### ❌ Lignes ignorées\n\n")
        parts += [f"- **{d['item']}** — {d['reason']}\n" for d in report["dropped"]]

    if report["not_sellable"]:
        parts.append("\n### ⚠️ Articles non vendables en ligne\n\n")
        parts += [f"- **{n['item']}** — {n['reason']}\n" for n in report["not_sellable"]]
        parts.append(
            "\nCes articles restent visibles dans le catalogue ; "
            "seule la vente en ligne est désactivée.\n"
        )

    if report["warnings"]:
        parts.append("\n### 👀 À vérifier\n\n")
        parts += [f"- **{w['item']}** — {w['detail']}\n" for w in report["warnings"]]

    if report["normalised"]:
        parts.append(
            f"\n### ✅ {len(report['normalised'])} champ(s) nettoyé(s) automatiquement\n\n"
        )
        for item in report["normalised"][:20]:
            parts.append(
                f"- **{item['item']}** ({item['field']}) : "
                f"« {item['from']} » → « {item['to']} »\n"
            )
        if len(report["normalised"]) > 20:
            parts.append(f"- … et {len(report['normalised']) - 20} autre(s)\n")

    return "".join(parts)


def popup_message(report: dict) -> str:
    """One-line-per-issue text for the Google Sheets popup."""
    lines = []
    for d in report["dropped"]:
        lines.append(f"Ligne ignorée — {d['item']} : {d['reason']}")
    for n in report["not_sellable"]:
        lines.append(f"Non vendable — {n['item']} : {n['reason']}")
    for w in report["warnings"]:
        lines.append(f"À vérifier — {w['item']} : {w['detail']}")
    if report["normalised"]:
        lines.append(f"{len(report['normalised'])} champ(s) nettoyé(s) automatiquement.")
    return " ; ".join(lines)
