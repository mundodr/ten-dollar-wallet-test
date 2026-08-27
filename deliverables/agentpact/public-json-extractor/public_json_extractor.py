#!/usr/bin/env python3
"""Fetch an explicitly allowed public JSON API and export validated records."""

from __future__ import annotations

import argparse
import csv
import ipaddress
import json
import socket
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable, Iterable


MAX_RESPONSE_BYTES = 1_000_000


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Reject redirects so an allowed host cannot redirect into a private network."""

    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        return None


def validate_target(
    url: str,
    allowed_hosts: Iterable[str],
    resolver: Callable[..., list[tuple[Any, ...]]] = socket.getaddrinfo,
) -> urllib.parse.ParseResult:
    """Require HTTPS, an exact host allowlist match, and globally routed DNS results."""
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https":
        raise ValueError("target URL must use https")
    if not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("target URL must contain a plain hostname and no credentials")

    allowlist = {host.strip().lower().rstrip(".") for host in allowed_hosts if host.strip()}
    hostname = parsed.hostname.lower().rstrip(".")
    if hostname not in allowlist:
        raise ValueError("target hostname is not in the explicit allowlist")

    addresses = {
        item[4][0]
        for item in resolver(hostname, parsed.port or 443, type=socket.SOCK_STREAM)
    }
    if not addresses:
        raise ValueError("target hostname did not resolve")
    for address in addresses:
        if not ipaddress.ip_address(address).is_global:
            raise ValueError("target hostname resolves to a non-public address")
    return parsed


def fetch_json(
    url: str,
    allowed_hosts: Iterable[str],
    *,
    timeout_seconds: float = 10,
    max_bytes: int = MAX_RESPONSE_BYTES,
    resolver: Callable[..., list[tuple[Any, ...]]] = socket.getaddrinfo,
    opener: Any = None,
) -> Any:
    """Fetch one bounded JSON document without redirects or authentication headers."""
    validate_target(url, allowed_hosts, resolver)
    client = opener or urllib.request.build_opener(NoRedirectHandler())
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "public-json-extractor/1.0",
        },
    )
    with client.open(request, timeout=timeout_seconds) as response:
        status = getattr(response, "status", response.getcode())
        if status != 200:
            raise ValueError(f"public API returned HTTP {status}")
        content_type = response.headers.get_content_type()
        if content_type != "application/json" and not content_type.endswith("+json"):
            raise ValueError("public API did not return JSON content")
        payload = response.read(max_bytes + 1)
        if len(payload) > max_bytes:
            raise ValueError("public API response exceeds the configured byte limit")
    try:
        return json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("public API response is not valid UTF-8 JSON") from error


def select_records(document: Any, records_path: str | None) -> list[dict[str, Any]]:
    """Select a dotted path and require a list of object records."""
    value = document
    if records_path:
        for segment in records_path.split("."):
            if not isinstance(value, dict) or segment not in value:
                raise ValueError(f"records path is missing segment: {segment}")
            value = value[segment]
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise ValueError("selected value must be a list of JSON objects")
    return value


def write_records(
    records: list[dict[str, Any]], output_path: Path, output_format: str
) -> dict[str, Any]:
    """Write deterministic JSON or flat CSV and return a validation summary."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_format == "json":
        output_path.write_text(
            json.dumps(records, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        parsed = json.loads(output_path.read_text(encoding="utf-8"))
        if parsed != records:
            raise ValueError("JSON output validation failed")
        columns = sorted({key for record in records for key in record})
    elif output_format == "csv":
        columns = sorted({key for record in records for key in record})
        for record in records:
            if any(isinstance(value, (dict, list)) for value in record.values()):
                raise ValueError("CSV output requires flat scalar records")
        with output_path.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=columns, lineterminator="\n")
            writer.writeheader()
            writer.writerows(records)
        with output_path.open(encoding="utf-8", newline="") as stream:
            if len(list(csv.DictReader(stream))) != len(records):
                raise ValueError("CSV output row-count validation failed")
    else:
        raise ValueError("output format must be json or csv")

    return {
        "output": str(output_path),
        "format": output_format,
        "record_count": len(records),
        "columns": columns,
        "validation": "passed",
    }


def run(
    url: str,
    allowed_hosts: Iterable[str],
    output_path: Path,
    output_format: str,
    records_path: str | None = None,
    **fetch_options: Any,
) -> dict[str, Any]:
    document = fetch_json(url, allowed_hosts, **fetch_options)
    records = select_records(document, records_path)
    summary = write_records(records, output_path, output_format)
    return {"source_url": url, "records_path": records_path, **summary}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", help="public HTTPS JSON API URL")
    parser.add_argument("output", type=Path, help="output .json or .csv path")
    parser.add_argument(
        "--allow-host",
        action="append",
        required=True,
        dest="allowed_hosts",
        help="exact public API hostname; repeat only when intentionally required",
    )
    parser.add_argument("--format", choices=("json", "csv"), required=True)
    parser.add_argument("--records-path", help="optional dotted path to the record list")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        summary = run(
            args.url,
            args.allowed_hosts,
            args.output,
            args.format,
            args.records_path,
        )
    except (OSError, ValueError, urllib.error.URLError) as error:
        print(json.dumps({"status": "error", "error": str(error)}))
        return 1
    print(json.dumps({"status": "ok", **summary}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
