import email.message
import json
import tempfile
import unittest
from pathlib import Path

from public_json_extractor import fetch_json, select_records, validate_target, write_records


def public_resolver(host, port, type):
    return [(2, 1, 6, "", ("93.184.216.34", port))]


class FakeResponse:
    def __init__(self, payload, content_type="application/json", status=200):
        self.payload = payload
        self.status = status
        self.headers = email.message.Message()
        self.headers["Content-Type"] = content_type

    def getcode(self):
        return self.status

    def read(self, size):
        return self.payload[:size]

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeOpener:
    def __init__(self, response):
        self.response = response
        self.request = None

    def open(self, request, timeout):
        self.request = request
        return self.response


class PublicJsonExtractorTests(unittest.TestCase):
    def test_requires_https(self):
        with self.assertRaisesRegex(ValueError, "must use https"):
            validate_target("http://api.example.com/items", ["api.example.com"], public_resolver)

    def test_requires_explicit_host_allowlist(self):
        with self.assertRaisesRegex(ValueError, "explicit allowlist"):
            validate_target("https://api.example.com/items", ["other.example.com"], public_resolver)

    def test_rejects_private_dns_results(self):
        private_resolver = lambda *args, **kwargs: [(2, 1, 6, "", ("127.0.0.1", 443))]
        with self.assertRaisesRegex(ValueError, "non-public"):
            validate_target("https://api.example.com/items", ["api.example.com"], private_resolver)

    def test_fetches_bounded_json_without_auth_headers(self):
        opener = FakeOpener(FakeResponse(json.dumps({"data": [{"id": 1}]}).encode()))
        document = fetch_json(
            "https://api.example.com/items",
            ["api.example.com"],
            resolver=public_resolver,
            opener=opener,
        )
        self.assertEqual(document["data"][0]["id"], 1)
        self.assertIsNone(opener.request.get_header("Authorization"))

    def test_rejects_non_json_content(self):
        opener = FakeOpener(FakeResponse(b"hello", "text/plain"))
        with self.assertRaisesRegex(ValueError, "did not return JSON"):
            fetch_json(
                "https://api.example.com/items",
                ["api.example.com"],
                resolver=public_resolver,
                opener=opener,
            )

    def test_selects_nested_records(self):
        records = select_records({"result": {"items": [{"id": 1}]}}, "result.items")
        self.assertEqual(records, [{"id": 1}])

    def test_writes_and_revalidates_flat_csv(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "items.csv"
            summary = write_records([{"id": 1, "name": "alpha"}], output, "csv")
            self.assertEqual(summary["record_count"], 1)
            self.assertEqual(summary["columns"], ["id", "name"])
            self.assertEqual(summary["validation"], "passed")


if __name__ == "__main__":
    unittest.main()
