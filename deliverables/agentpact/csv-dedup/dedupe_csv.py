#!/usr/bin/env python3
"""Deduplicate a CSV by one or more key columns and validate the result."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Iterable, Sequence


def read_csv(path: Path, encoding: str = "utf-8-sig") -> tuple[list[str], list[dict[str, str]], csv.Dialect]:
    """Read a CSV while preserving its detected delimiter and column order."""
    text = path.read_text(encoding=encoding)
    try:
        dialect = csv.Sniffer().sniff(text[:8192], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel

    with path.open("r", encoding=encoding, newline="") as stream:
        reader = csv.DictReader(stream, dialect=dialect)
        if not reader.fieldnames:
            raise ValueError("input CSV has no header row")
        fieldnames = list(reader.fieldnames)
        if len(set(fieldnames)) != len(fieldnames):
            raise ValueError("input CSV contains duplicate column names")
        return fieldnames, list(reader), dialect


def deduplicate(
    rows: Iterable[dict[str, str]], key_columns: Sequence[str]
) -> tuple[list[dict[str, str]], int]:
    """Keep the first row for each composite key."""
    seen: set[tuple[str, ...]] = set()
    cleaned: list[dict[str, str]] = []
    duplicate_count = 0

    for row in rows:
        key = tuple(row[column] for column in key_columns)
        if key in seen:
            duplicate_count += 1
            continue
        seen.add(key)
        cleaned.append(row)

    return cleaned, duplicate_count


def write_csv(
    path: Path,
    fieldnames: Sequence[str],
    rows: Iterable[dict[str, str]],
    dialect: csv.Dialect,
    encoding: str = "utf-8",
) -> None:
    """Write cleaned rows using the input delimiter and stable line endings."""
    with path.open("w", encoding=encoding, newline="") as stream:
        writer = csv.DictWriter(
            stream,
            fieldnames=fieldnames,
            delimiter=dialect.delimiter,
            quotechar=dialect.quotechar,
            quoting=dialect.quoting,
            lineterminator="\n",
        )
        writer.writeheader()
        writer.writerows(rows)


def validate_output(
    path: Path,
    expected_fieldnames: Sequence[str],
    key_columns: Sequence[str],
    expected_count: int,
    encoding: str = "utf-8-sig",
) -> None:
    """Re-read output and verify its schema, count, and key uniqueness."""
    fieldnames, rows, _ = read_csv(path, encoding=encoding)
    if fieldnames != list(expected_fieldnames):
        raise ValueError("output columns differ from input columns")
    if len(rows) != expected_count:
        raise ValueError(
            f"output row count is {len(rows)}, expected {expected_count}"
        )
    keys = [tuple(row[column] for column in key_columns) for row in rows]
    if len(keys) != len(set(keys)):
        raise ValueError("output still contains duplicate keys")


def run(
    input_path: Path,
    output_path: Path,
    key_columns: Sequence[str],
    encoding: str = "utf-8-sig",
) -> dict[str, object]:
    """Run the full read, deduplicate, write, and validation pipeline."""
    if input_path.resolve() == output_path.resolve():
        raise ValueError("input and output paths must differ")
    if not key_columns:
        raise ValueError("at least one key column is required")

    fieldnames, rows, dialect = read_csv(input_path, encoding=encoding)
    missing = [column for column in key_columns if column not in fieldnames]
    if missing:
        raise ValueError(f"key columns not found: {', '.join(missing)}")

    cleaned, duplicate_count = deduplicate(rows, key_columns)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    write_csv(output_path, fieldnames, cleaned, dialect)
    validate_output(output_path, fieldnames, key_columns, len(cleaned))

    return {
        "input": str(input_path),
        "output": str(output_path),
        "key_columns": list(key_columns),
        "input_rows": len(rows),
        "output_rows": len(cleaned),
        "duplicates_removed": duplicate_count,
        "validation": "passed",
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="source CSV path")
    parser.add_argument("output", type=Path, help="cleaned CSV path")
    parser.add_argument(
        "--key",
        action="append",
        required=True,
        dest="key_columns",
        help="deduplication key column; repeat for a composite key",
    )
    parser.add_argument(
        "--encoding",
        default="utf-8-sig",
        help="input text encoding (default: utf-8-sig)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        summary = run(args.input, args.output, args.key_columns, args.encoding)
    except (OSError, UnicodeError, ValueError, csv.Error) as error:
        print(json.dumps({"status": "error", "error": str(error)}))
        return 1

    print(json.dumps({"status": "ok", **summary}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
