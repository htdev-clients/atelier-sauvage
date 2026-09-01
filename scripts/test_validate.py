"""
Unit tests for the catalog validator.

Run with:  python3 -m unittest discover -s scripts -p 'test_*.py'
Stdlib only -- no extra dependency in requirements.txt.
"""

import unittest

from validate import (
    STATUT_SOLD,
    clean_price,
    clean_statut,
    clean_text,
    popup_message,
    validate,
)


def row(number, prix="100", statut="", description="Un objet", category="Décoration", **extra):
    base = {
        "number": number,
        "category": category,
        "description": description,
        "prix": prix,
        "statut": statut,
    }
    base.update(extra)
    return base


class CleanText(unittest.TestCase):
    def test_trims_and_collapses(self):
        self.assertEqual(clean_text("  Vase   bleu  "), "Vase bleu")

    def test_collapses_embedded_newline(self):
        self.assertEqual(clean_text("Eau forte\n"), "Eau forte")
        self.assertEqual(clean_text("Ligne 1\nLigne 2"), "Ligne 1 Ligne 2")

    def test_none_becomes_empty(self):
        self.assertEqual(clean_text(None), "")


class CleanPrice(unittest.TestCase):
    def test_trailing_space_is_cleaned(self):
        self.assertEqual(clean_price("95 "), (95, "95", None))

    def test_thousands_separator_space(self):
        self.assertEqual(clean_price("1 250"), (1250, "1250", None))

    def test_euro_sign_stripped(self):
        self.assertEqual(clean_price("130 €"), (130, "130", None))

    def test_missing(self):
        value, _, problem = clean_price("")
        self.assertIsNone(value)
        self.assertEqual(problem, "prix manquant")

    def test_zero_rejected(self):
        value, _, problem = clean_price("0")
        self.assertIsNone(value)
        self.assertEqual(problem, "prix à zéro")

    def test_ambiguous_decimal_is_not_guessed(self):
        # 1.250 could be 1250 or 1.25. Reported, never interpreted.
        for raw in ("1.250", "130,50", "cent trente"):
            value, _, problem = clean_price(raw)
            self.assertIsNone(value, raw)
            self.assertIn("illisible", problem)


class CleanStatut(unittest.TestCase):
    def test_canonicalises_case_and_space(self):
        self.assertEqual(clean_statut("  VENDU "), STATUT_SOLD)
        self.assertEqual(clean_statut("vendu"), STATUT_SOLD)

    def test_blank_stays_blank(self):
        self.assertEqual(clean_statut("   "), "")

    def test_unknown_passes_through(self):
        self.assertEqual(clean_statut("réservé"), "réservé")


class Normalisation(unittest.TestCase):
    def test_cleans_without_dropping(self):
        rows, report = validate([row("200", prix="95 ")])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["prix"], "95")
        self.assertEqual(report["dropped"], [])
        self.assertTrue(any(n["field"] == "prix" for n in report["normalised"]))

    def test_clean_row_reports_nothing(self):
        _, report = validate([row("1")])
        self.assertEqual(report["normalised"], [])
        self.assertEqual(report["not_sellable"], [])


class Quarantine(unittest.TestCase):
    def test_blank_number_is_dropped(self):
        rows, report = validate([row("")])
        self.assertEqual(rows, [])
        self.assertEqual(report["dropped"][0]["reason"], "numéro manquant")

    def test_duplicate_number_keeps_the_first(self):
        rows, report = validate([row("7", prix="100"), row("7", prix="200")])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["prix"], "100")
        self.assertIn("double", report["dropped"][0]["reason"])

    def test_letter_suffix_is_valid(self):
        rows, report = validate([row("24b"), row("190b")])
        self.assertEqual(len(rows), 2)
        self.assertEqual(report["dropped"], [])

    def test_bad_price_keeps_item_but_marks_unsellable(self):
        rows, report = validate([row("7", prix="1.250")])
        self.assertEqual(len(rows), 1, "item stays in the catalogue")
        self.assertFalse(rows[0]["_sellable"])
        self.assertEqual(report["not_sellable"][0]["item"], "7")

    def test_sold_item_with_no_price_is_not_flagged(self):
        # A sold item is not meant to be for sale; a missing price is not news.
        _, report = validate([row("7", prix="", statut="Vendu")])
        self.assertEqual(report["not_sellable"], [])

    def test_available_item_with_no_price_is_flagged(self):
        _, report = validate([row("7", prix="")])
        self.assertEqual(report["not_sellable"][0]["item"], "7")
        self.assertEqual(report["not_sellable"][0]["reason"], "prix manquant")

    def test_pending_item_is_not_flagged(self):
        _, report = validate([row("7", prix="", statut="pending")])
        self.assertEqual(report["not_sellable"], [])


class TransportBand(unittest.TestCase):
    def test_absent_column_is_not_required(self):
        _, report = validate([row("7")])
        self.assertEqual(report["not_sellable"], [])

    def test_present_but_empty_blocks_sale(self):
        rows, report = validate([row("7", transport="")])
        self.assertFalse(rows[0]["_sellable"])
        self.assertIn("transport", report["not_sellable"][0]["reason"])

    def test_valid_band_is_upcased(self):
        rows, report = validate([row("7", transport=" m ")])
        self.assertEqual(rows[0]["transport"], "M")
        self.assertTrue(rows[0]["_sellable"])
        self.assertEqual(report["not_sellable"], [])


class Category(unittest.TestCase):
    def test_accent_and_case_folded(self):
        rows, report = validate([row("7", category=" decoration ")])
        self.assertEqual(rows[0]["category"], "Décoration")
        self.assertEqual(report["warnings"], [])

    def test_exact_value_is_untouched(self):
        _, report = validate([row("7", category="Décoration")])
        self.assertEqual(report["normalised"], [])

    def test_unknown_category_warns(self):
        rows, report = validate([row("7", category="Bijoux")])
        self.assertEqual(rows[0]["category"], "Bijoux")
        self.assertEqual(report["warnings"][0]["kind"], "unknown_category")


class Warnings(unittest.TestCase):
    def test_large_price_jump_warns(self):
        previous = {"7": {"prix": "100", "statut": ""}}
        _, report = validate([row("7", prix="500")], previous)
        self.assertEqual(report["warnings"][0]["kind"], "price_jump")

    def test_small_price_change_is_quiet(self):
        previous = {"7": {"prix": "100", "statut": ""}}
        _, report = validate([row("7", prix="110")], previous)
        self.assertEqual(report["warnings"], [])

    def test_unsold_warns(self):
        previous = {"7": {"prix": "100", "statut": "Vendu"}}
        _, report = validate([row("7", prix="100")], previous)
        self.assertEqual(report["warnings"][0]["kind"], "unsold")

    def test_sharp_count_drop_warns(self):
        previous = {str(n): {"prix": "10", "statut": ""} for n in range(100)}
        _, report = validate([row("1")], previous)
        self.assertTrue(any(w["kind"] == "count_drop" for w in report["warnings"]))

    def test_small_count_drop_is_quiet(self):
        previous = {str(n): {"prix": "10", "statut": ""} for n in range(100)}
        rows = [row(str(n)) for n in range(97)]
        _, report = validate(rows, previous)
        self.assertEqual([w for w in report["warnings"] if w["kind"] == "count_drop"], [])

    def test_warnings_never_drop_rows(self):
        previous = {"7": {"prix": "100", "statut": "Vendu"}}
        rows, _ = validate([row("7", prix="900")], previous)
        self.assertEqual(len(rows), 1)


class Messages(unittest.TestCase):
    def test_popup_mentions_each_issue(self):
        _, report = validate([row("7", prix="abc"), row("")])
        message = popup_message(report)
        self.assertIn("7", message)
        self.assertIn("Non vendable", message)
        self.assertIn("Ligne ignorée", message)


if __name__ == "__main__":
    unittest.main()
