import json
import re
import unittest
from pathlib import Path


HERE = Path(__file__).resolve().parent
TARGET = HERE.parent / "csv-dedup" / "dedupe_csv.py"


class FindingsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.packet = json.loads((HERE / "findings.json").read_text(encoding="utf-8"))
        self.findings = self.packet["findings"]

    def test_finding_schema_and_source_bounds(self) -> None:
        line_count = len(TARGET.read_text(encoding="utf-8").splitlines())
        allowed_severities = {"critical", "high", "medium", "low", "informational"}
        allowed_confidences = {"high", "medium", "low"}

        for finding in self.findings:
            self.assertRegex(finding["id"], r"^PY-\d{3}$")
            self.assertIn(finding["severity"], allowed_severities)
            self.assertIn(finding["confidence"], allowed_confidences)
            self.assertTrue(finding["evidence"].strip())
            self.assertTrue(finding["impact"].strip())
            self.assertTrue(finding["assumptions"].strip())
            self.assertTrue(finding["remediation"].strip())
            self.assertTrue(finding["lines"])
            self.assertTrue(all(1 <= line <= line_count for line in finding["lines"]))

    def test_ids_are_unique_and_match_markdown(self) -> None:
        ids = [finding["id"] for finding in self.findings]
        self.assertEqual(len(ids), len(set(ids)))
        markdown = (HERE / "review.md").read_text(encoding="utf-8")
        markdown_ids = re.findall(r"^### (PY-\d{3}):", markdown, flags=re.MULTILINE)
        self.assertEqual(markdown_ids, ids)

    def test_summary_matches_finding_counts(self) -> None:
        expected = {severity: 0 for severity in self.packet["summary"]}
        for finding in self.findings:
            expected[finding["severity"]] += 1
        self.assertEqual(self.packet["summary"], expected)


if __name__ == "__main__":
    unittest.main()
