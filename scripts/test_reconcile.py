import unittest

import reconcile


class ColumnLetterTests(unittest.TestCase):
    def test_letters(self):
        self.assertEqual(reconcile.column_letter(0), "A")
        self.assertEqual(reconcile.column_letter(4), "E")
        self.assertEqual(reconcile.column_letter(25), "Z")
        self.assertEqual(reconcile.column_letter(26), "AA")


class PlanUpdatesTests(unittest.TestCase):
    values = [
        ["number", "category", "description", "prix", "statut", "transport"],
        ["2", "Meuble", "Table", "70", "Vendu", "L"],
        ["24b", "Décoration", "Vase", "45", "", "S"],
        ["170c", "Luminaire", "Lampe"],            # short row: no statut cell at all
        ["24b", "Décoration", "Duplicate", "1", ""],  # duplicate number: first row wins
    ]

    def test_plans_cells_for_unsold_rows_only(self):
        updates, already, missing = reconcile.plan_updates(
            self.values, [{"number": "24b"}, {"number": "170c"}, {"number": "2"}, {"number": "999"}]
        )
        self.assertEqual(updates, [
            {"range": "Sheet1!E3", "number": "24b"},
            {"range": "Sheet1!E4", "number": "170c"},
        ])
        self.assertEqual(already, ["2"])
        self.assertEqual(missing, ["999"])

    def test_statut_column_is_found_by_header_not_position(self):
        values = [["statut", "number"], ["", "24b"]]
        updates, _, _ = reconcile.plan_updates(values, [{"number": "24b"}])
        self.assertEqual(updates, [{"range": "Sheet1!A2", "number": "24b"}])

    def test_missing_headers_raise(self):
        with self.assertRaises(ValueError):
            reconcile.plan_updates([["number", "prix"]], [{"number": "1"}])
        with self.assertRaises(ValueError):
            reconcile.plan_updates([], [])


if __name__ == "__main__":
    unittest.main()
