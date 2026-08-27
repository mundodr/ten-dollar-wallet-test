# Static review: CSV deduplication utility

## Scope and threat model

Reviewed file: `deliverables/agentpact/csv-dedup/dedupe_csv.py`.

This is a local command-line tool, not a network service. The review covers
file handling, resource bounds, exported data safety, and failure behavior.
Severity assumes the input can be supplied by someone other than the operator.
Local-only concerns are explicitly marked so they are not presented as remote
exploits.

## Executive summary

No critical or high-severity issue was found. The utility has two contextual
medium findings and two low findings. The most useful first change is a clear
input-size limit because the current path keeps several full representations of
the CSV in memory. Spreadsheet formula handling should be a documented opt-in
mode because neutralizing cells changes the source data.

## Findings

### PY-001: Unbounded whole-file reads can exhaust memory

- Severity: medium
- Confidence: high
- Evidence: lines 15, 28, and 79 load the input text, parsed rows, and then the
  output rows into memory during validation.
- Impact: a very large or attacker-supplied CSV can exhaust process memory and
  terminate the job before a validated output is produced.
- Assumption: file size is not already limited by a trusted upload or caller.
- Remediation: enforce byte and row limits, use only a prefix for dialect
  detection, and document when a disk-backed key store is required.

### PY-002: Spreadsheet formulas are preserved in exported cells

- Severity: medium
- Confidence: high
- Evidence: lines 39 through 45 retain each row verbatim and line 68 writes it
  unchanged. Formula-leading values such as `=`, `+`, `-`, and `@` survive.
- Impact: opening untrusted output in formula-capable spreadsheet software can
  trigger application-supported formula behavior or attacker-controlled links.
- Assumption: a person later opens the output in spreadsheet software. A pure
  data pipeline is not affected in the same way.
- Remediation: add an explicit spreadsheet-safe option that prefixes dangerous
  cells, while preserving the current raw mode for lossless data processing.

### PY-003: Direct output writes can leave a partial file

- Severity: low
- Confidence: high
- Evidence: lines 58 through 68 truncate and write the requested destination;
  validation does not occur until line 111.
- Impact: another process can observe a partial file after interruption or a
  write failure, and a previous valid destination has already been replaced.
- Remediation: write and validate a temporary sibling, flush it, then use an
  atomic replace operation.

### PY-004: Input and output identity is checked before the write

- Severity: low
- Confidence: medium
- Evidence: line 98 resolves both paths, while the destination is opened later
  at line 110 through `write_csv`. A concurrently changed symlink can invalidate
  the earlier conclusion.
- Impact: only in a privileged multi-user wrapper, a local actor able to mutate
  path components may redirect a write.
- Assumption: this is not considered exploitable in the documented single-user
  CLI model.
- Remediation: privileged wrappers should reject symlinks or use descriptor-
  relative, no-follow opens in a trusted directory and atomically replace the
  final destination.

## Positive observations

- Duplicate headers are rejected before processing.
- Input and output paths are prevented from resolving to the same file in the
  normal single-user case.
- Key-column validation happens before output creation.
- The tool re-reads and validates schema, row count, and key uniqueness.
- Expected operational errors become structured JSON instead of tracebacks.

## Recommended order

1. Add input byte and row limits with tests at each boundary.
2. Switch output publication to validate-then-atomic-replace.
3. Add and document an optional spreadsheet-safe export policy.
4. Use no-follow path handling only if the CLI is embedded in a privileged or
   multi-user service.
