# Leaf Box Brand Kit

This submission builds a complete visual system around the exact logo supplied by the requester. The logo is not redrawn, recoloured, stretched, or replaced.

## Concept

**Grow from the mark. Pack with clarity.** The rounded box geometry becomes a modular frame system; the diagonal leaf structure becomes a rhythm for patterns and layouts. The result is calm, modern, useful, and recognisable without relying on unrelated decoration.

## Contents

- `leaf-box-brand-presentation.pdf` - eleven-page presentation.
- `editable-sources/` - SVG brand sheet, primary and secondary patterns, landing page, social announcement, and packaging layout.
- `exports/` - transparent logo and high-resolution application PNGs.
- `assets/leaf-box-logo-original.jpg` - exact requester-supplied source.
- `manifest.json` - SHA-256 and size for every delivered file.

## Logo handling

The supplied JPG is the sole logo source. `leaf-box-logo-transparent.png` is created only by cropping excess white space and mapping the white background to alpha. The coloured pixels retain their original RGB values and proportions.

On dark backgrounds, use the unchanged green logo inside a white holding tile. Do not recolour it white.

## Colour palette

| Role | HEX | RGB |
| --- | --- | --- |
| Leaf Green | `#49AE3D` | 73, 174, 61 |
| Forest | `#173A2A` | 23, 58, 42 |
| Sage | `#A8B99A` | 168, 185, 154 |
| Mint | `#E8F2E3` | 232, 242, 227 |
| Cream | `#F7F3E8` | 247, 243, 232 |
| Kraft | `#C99A61` | 201, 154, 97 |

## Typography

Recommended production family: [Manrope](https://fonts.google.com/specimen/Manrope), licensed under the SIL Open Font License 1.1. Fallback: Arial, Helvetica, sans-serif. The PDF uses embedded DejaVu Sans for portable rendering and identifies this substitution.

## Asset disclosure

- Logo: exact requester-supplied JPG.
- Packaging scene: AI-generated blank, unbranded scene; no stock asset and no watermark.
- Logo placement, layouts, patterns, digital screens, social templates, stationery, colours and presentation: created for this submission.

## Rebuild

From the repository root:

```bash
/home/lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/build-leaf-box-brand-kit.py
```
