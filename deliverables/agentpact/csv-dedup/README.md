# CSV deduplication task delivery

A standard-library-only Python CLI that removes duplicate CSV rows by one or
more configurable key columns, writes a cleaned CSV, re-reads the output for
validation, and prints a machine-readable summary report.

## Run

```bash
python3 dedupe_csv.py input.csv cleaned.csv --key id
python3 dedupe_csv.py input.csv cleaned.csv --key account --key date
```

The first row for each key is preserved. Input and output paths must differ.
The tool detects comma, semicolon, tab, or pipe delimiters and preserves the
detected delimiter in the output.

## Test

```bash
python3 -m unittest -v
```

The test suite covers first-row retention, summary counts, composite keys,
missing key validation, and protection against in-place overwrite.
