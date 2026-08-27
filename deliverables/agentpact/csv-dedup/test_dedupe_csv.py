import csv
import tempfile
import unittest
from pathlib import Path

from dedupe_csv import run


class DedupeCsvTests(unittest.TestCase):
    def write_rows(self, path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
        with path.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)

    def test_keeps_first_row_and_reports_summary(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "input.csv"
            output = Path(directory) / "output.csv"
            self.write_rows(
                source,
                ["id", "name"],
                [
                    {"id": "1", "name": "first"},
                    {"id": "1", "name": "duplicate"},
                    {"id": "2", "name": "second"},
                ],
            )

            summary = run(source, output, ["id"])

            self.assertEqual(summary["input_rows"], 3)
            self.assertEqual(summary["output_rows"], 2)
            self.assertEqual(summary["duplicates_removed"], 1)
            with output.open(encoding="utf-8") as stream:
                rows = list(csv.DictReader(stream))
            self.assertEqual(rows[0], {"id": "1", "name": "first"})

    def test_supports_composite_keys(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "input.csv"
            output = Path(directory) / "output.csv"
            self.write_rows(
                source,
                ["account", "date", "value"],
                [
                    {"account": "a", "date": "2026-08-01", "value": "1"},
                    {"account": "a", "date": "2026-08-02", "value": "2"},
                    {"account": "a", "date": "2026-08-01", "value": "3"},
                ],
            )

            summary = run(source, output, ["account", "date"])

            self.assertEqual(summary["output_rows"], 2)
            self.assertEqual(summary["validation"], "passed")

    def test_rejects_unknown_key_column(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "input.csv"
            output = Path(directory) / "output.csv"
            self.write_rows(source, ["id"], [{"id": "1"}])

            with self.assertRaisesRegex(ValueError, "key columns not found"):
                run(source, output, ["missing"])

    def test_rejects_in_place_overwrite(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "input.csv"
            self.write_rows(source, ["id"], [{"id": "1"}])

            with self.assertRaisesRegex(ValueError, "must differ"):
                run(source, source, ["id"])


if __name__ == "__main__":
    unittest.main()
