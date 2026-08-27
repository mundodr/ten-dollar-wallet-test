#!/usr/bin/env python3
"""Validate Leaf Box deliverables before Taskmarket submission."""

from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path
from xml.etree import ElementTree

from PIL import Image
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
KIT = ROOT / "deliverables" / "taskmarket" / "TSK-20W651EW"
PDF = KIT / "leaf-box-brand-presentation.pdf"
ZIP = KIT / "leaf-box-brand-kit.zip"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_pdf() -> dict:
    reader = PdfReader(str(PDF))
    if len(reader.pages) != 11:
        raise AssertionError(f"Expected 11 pages, found {len(reader.pages)}")
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    required = [
        "GROW FROM THE MARK.",
        "One logo. No reinterpretation.",
        "Recognisable green, quieter company.",
        "Friendly geometry. Practical reading.",
        "A modular rhythm derived from the mark.",
        "Three formats. One visual grammar.",
        "Recognition on a real surface.",
        "A system ready to use.",
    ]
    missing = [value for value in required if value not in text]
    if missing:
        raise AssertionError(f"Missing PDF text: {missing}")
    for page in reader.pages:
        width = float(page.mediabox.width)
        height = float(page.mediabox.height)
        if (width, height) != (960.0, 540.0):
            raise AssertionError(f"Unexpected page size: {(width, height)}")
    return {"pages": len(reader.pages), "bytes": PDF.stat().st_size, "sha256": sha256(PDF)}


def validate_logo() -> dict:
    original = Image.open(KIT / "assets" / "leaf-box-logo-original.jpg").convert("RGBA")
    transparent = Image.open(KIT / "assets" / "leaf-box-logo-transparent.png").convert("RGBA")
    alpha = Image.new("L", original.size, 0)
    source_pixels = original.load()
    alpha_pixels = alpha.load()
    for y in range(original.height):
        for x in range(original.width):
            r, g, b, _ = source_pixels[x, y]
            distance = 255 - min(r, g, b)
            alpha_pixels[x, y] = max(0, min(255, int((distance - 2) * 8)))
    bbox = alpha.getbbox()
    if not bbox:
        raise AssertionError("Original logo contains no visible mark")
    pad = 14
    bbox = (
        max(0, bbox[0] - pad),
        max(0, bbox[1] - pad),
        min(original.width, bbox[2] + pad),
        min(original.height, bbox[3] + pad),
    )
    expected = original.crop(bbox)
    expected.putalpha(alpha.crop(bbox))
    if expected.size != transparent.size:
        raise AssertionError("Transparent logo dimensions differ from deterministic crop")
    if expected.tobytes() != transparent.tobytes():
        raise AssertionError("Transparent logo changed requester-supplied RGB or alpha pixels")
    export = Image.open(KIT / "exports" / "leaf-box-logo-transparent.png").convert("RGBA")
    if export.tobytes() != transparent.tobytes():
        raise AssertionError("Exported transparent logo differs from the validated asset")
    return {
        "originalSize": original.size,
        "transparentSize": transparent.size,
        "preservedPixelExact": True,
        "originalSha256": sha256(KIT / "assets" / "leaf-box-logo-original.jpg"),
        "transparentSha256": sha256(KIT / "assets" / "leaf-box-logo-transparent.png"),
    }


def validate_svgs() -> dict:
    files = sorted((KIT / "editable-sources").glob("*.svg"))
    if len(files) < 8:
        raise AssertionError(f"Expected at least 8 SVG sources, found {len(files)}")
    for path in files:
        root = ElementTree.parse(path).getroot()
        if not root.tag.endswith("svg"):
            raise AssertionError(f"Not an SVG root: {path.name}")
        if "width" not in root.attrib or "height" not in root.attrib:
            raise AssertionError(f"Missing SVG dimensions: {path.name}")
    return {"count": len(files), "files": [path.name for path in files]}


def validate_manifest() -> dict:
    manifest_path = KIT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for item in manifest["files"]:
        path = KIT / item["path"]
        if not path.is_file():
            raise AssertionError(f"Manifest file missing: {item['path']}")
        if path.stat().st_size != item["bytes"]:
            raise AssertionError(f"Manifest size mismatch: {item['path']}")
        if sha256(path) != item["sha256"]:
            raise AssertionError(f"Manifest hash mismatch: {item['path']}")
    if manifest["fileCount"] != len(manifest["files"]):
        raise AssertionError("Manifest fileCount mismatch")
    return {"fileCount": manifest["fileCount"], "sha256": sha256(manifest_path)}


def validate_zip() -> dict:
    with zipfile.ZipFile(ZIP) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise AssertionError("ZIP contains duplicate paths")
        bad = archive.testzip()
        if bad:
            raise AssertionError(f"Corrupt ZIP member: {bad}")
        required = {
            "leaf-box-brand-presentation.pdf",
            "manifest.json",
            "README.md",
            "assets/leaf-box-logo-original.jpg",
            "exports/leaf-box-logo-transparent.png",
            "editable-sources/logo-on-light.svg",
            "editable-sources/logo-on-dark.svg",
        }
        missing = sorted(required - set(names))
        if missing:
            raise AssertionError(f"ZIP missing required files: {missing}")
    return {"members": len(names), "bytes": ZIP.stat().st_size, "sha256": sha256(ZIP)}


def main() -> None:
    result = {
        "pdf": validate_pdf(),
        "logo": validate_logo(),
        "svgs": validate_svgs(),
        "manifest": validate_manifest(),
        "zip": validate_zip(),
        "allValid": True,
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
