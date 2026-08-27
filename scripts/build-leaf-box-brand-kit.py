#!/usr/bin/env python3
"""Build a complete, editable Leaf Box brand-kit submission.

The requester's supplied JPG remains the sole logo source. This script only
crops its clear space and removes its white background for placement; it never
redraws, recolours, or changes the mark's proportions.
"""

from __future__ import annotations

import hashlib
import json
import math
import shutil
import textwrap
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont
from reportlab.lib.colors import HexColor, white
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
KIT = ROOT / "deliverables" / "taskmarket" / "TSK-20W651EW"
ASSETS = KIT / "assets"
SOURCE = KIT / "editable-sources"
EXPORTS = KIT / "exports"
PDF_DIR = ROOT / "output" / "pdf"
PDF_PATH = PDF_DIR / "leaf-box-brand-presentation.pdf"
ZIP_PATH = KIT / "leaf-box-brand-kit.zip"

LOGO_ORIGINAL = ASSETS / "leaf-box-logo-original.jpg"
PACKAGING_BLANK = ASSETS / "packaging-mockup-blank.png"
LOGO_TRANSPARENT = ASSETS / "leaf-box-logo-transparent.png"
PACKAGING_BRANDED = EXPORTS / "leaf-box-packaging-mockup.png"

GREEN = "#49AE3D"
FOREST = "#173A2A"
SAGE = "#A8B99A"
MINT = "#E8F2E3"
CREAM = "#F7F3E8"
KRAFT = "#C99A61"
INK = "#183028"
WHITE = "#FFFFFF"

W, H = 960, 540


def ensure_dirs() -> None:
    for directory in (ASSETS, SOURCE, EXPORTS, PDF_DIR):
        directory.mkdir(parents=True, exist_ok=True)


def font(size: int, bold: bool = False, mono: bool = False) -> ImageFont.FreeTypeFont:
    if mono:
        path = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
    elif bold:
        path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    else:
        path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    return ImageFont.truetype(path, size)


def register_pdf_fonts() -> None:
    pdfmetrics.registerFont(
        TTFont("DV", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
    )
    pdfmetrics.registerFont(
        TTFont("DV-Bold", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
    )
    pdfmetrics.registerFont(
        TTFont("DV-Mono", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf")
    )


def prepare_logo() -> Image.Image:
    image = Image.open(LOGO_ORIGINAL).convert("RGBA")
    pixels = image.load()
    alpha = Image.new("L", image.size, 0)
    alpha_pixels = alpha.load()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, _ = pixels[x, y]
            distance = 255 - min(r, g, b)
            alpha_pixels[x, y] = max(0, min(255, int((distance - 2) * 8)))
    bbox = alpha.getbbox()
    if not bbox:
        raise RuntimeError("No non-white logo pixels detected")
    pad = 14
    bbox = (
        max(0, bbox[0] - pad),
        max(0, bbox[1] - pad),
        min(image.width, bbox[2] + pad),
        min(image.height, bbox[3] + pad),
    )
    image.putalpha(alpha)
    cropped = image.crop(bbox)
    cropped.save(LOGO_TRANSPARENT)
    shutil.copy2(LOGO_TRANSPARENT, EXPORTS / "leaf-box-logo-transparent.png")
    return cropped


def fit_image(image: Image.Image, max_w: int, max_h: int) -> Image.Image:
    ratio = min(max_w / image.width, max_h / image.height)
    return image.resize(
        (max(1, round(image.width * ratio)), max(1, round(image.height * ratio))),
        Image.Resampling.LANCZOS,
    )


def paste_center(base: Image.Image, overlay: Image.Image, box: tuple[int, int, int, int]) -> None:
    x0, y0, x1, y1 = box
    fitted = fit_image(overlay, x1 - x0, y1 - y0)
    x = x0 + (x1 - x0 - fitted.width) // 2
    y = y0 + (y1 - y0 - fitted.height) // 2
    base.alpha_composite(fitted, (x, y))


def make_packaging_mockup(logo: Image.Image) -> None:
    base = Image.open(PACKAGING_BLANK).convert("RGBA")
    placement = fit_image(logo, 410, 180)
    # The generated box face is nearly frontal; this light affine transform
    # matches its subtle perspective without altering the mark internally.
    placement = placement.transform(
        (placement.width, placement.height),
        Image.Transform.AFFINE,
        (1.0, -0.025, 3.0, 0.0, 0.98, 1.0),
        resample=Image.Resampling.BICUBIC,
    )
    shadow = Image.new("RGBA", placement.size, (0, 0, 0, 0))
    shadow_alpha = placement.getchannel("A").filter(ImageFilter.GaussianBlur(2.2))
    shadow.putalpha(shadow_alpha.point(lambda value: int(value * 0.18)))
    base.alpha_composite(shadow, (590, 470))
    base.alpha_composite(placement, (586, 466))
    base.convert("RGB").save(PACKAGING_BRANDED, quality=94)


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[index : index + 2], 16) for index in (0, 2, 4))


def draw_pattern(draw: ImageDraw.ImageDraw, origin: tuple[int, int], cell: int, cols: int, rows: int, colour: str) -> None:
    ox, oy = origin
    rgb = hex_to_rgb(colour)
    for row in range(rows):
        for col in range(cols):
            x = ox + col * cell
            y = oy + row * cell
            if (row + col) % 2 == 0:
                draw.rounded_rectangle(
                    (x + 5, y + 5, x + cell - 8, y + cell - 8),
                    radius=cell // 4,
                    outline=rgb,
                    width=max(2, cell // 18),
                )
                draw.line(
                    (x + cell * 0.25, y + cell * 0.73, x + cell * 0.73, y + cell * 0.25),
                    fill=rgb,
                    width=max(2, cell // 20),
                )
            else:
                draw.arc(
                    (x + 4, y + 4, x + cell - 4, y + cell - 4),
                    200,
                    340,
                    fill=rgb,
                    width=max(2, cell // 18),
                )


def make_brand_sheet_png(logo: Image.Image) -> None:
    image = Image.new("RGB", (1800, 1200), hex_to_rgb(CREAM))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 1800, 165), fill=hex_to_rgb(FOREST))
    draw.text((90, 52), "LEAF BOX / BRAND SYSTEM 01", font=font(54, True), fill="white")
    draw.text((90, 210), "Grow from the mark. Pack with clarity.", font=font(62, True), fill=hex_to_rgb(INK))
    draw.text(
        (94, 292),
        "A calm, modular identity built from box geometry, leaf rhythm and generous space.",
        font=font(28),
        fill=hex_to_rgb(FOREST),
    )

    tile = Image.new("RGBA", (720, 355), "white")
    paste_center(tile, logo, (80, 70, 640, 285))
    image.paste(tile.convert("RGB"), (90, 380))
    draw.text((90, 760), "OFFICIAL LOGO - UNCHANGED", font=font(20, True), fill=hex_to_rgb(FOREST))

    palette = [GREEN, FOREST, SAGE, MINT, CREAM, KRAFT]
    names = ["LEAF", "FOREST", "SAGE", "MINT", "CREAM", "KRAFT"]
    for index, (colour, name) in enumerate(zip(palette, names)):
        x = 900 + (index % 3) * 260
        y = 410 + (index // 3) * 235
        draw.rounded_rectangle((x, y, x + 215, y + 135), radius=20, fill=hex_to_rgb(colour))
        text_colour = "white" if colour in (FOREST, GREEN) else hex_to_rgb(INK)
        draw.text((x + 16, y + 150), name, font=font(20, True), fill=hex_to_rgb(INK))
        draw.text((x + 16, y + 180), colour, font=font(18, mono=True), fill=hex_to_rgb(INK))
        if text_colour == "white":
            draw.text((x + 16, y + 92), "Aa", font=font(28, True), fill=text_colour)

    draw.rectangle((90, 970, 1710, 1115), fill=hex_to_rgb(MINT))
    draw.text((130, 1002), "TYPE", font=font(20, True), fill=hex_to_rgb(GREEN))
    draw.text((270, 994), "Manrope", font=font(48, True), fill=hex_to_rgb(INK))
    draw.text((585, 1010), "Clear hierarchy / friendly geometry / practical fallback", font=font(23), fill=hex_to_rgb(FOREST))
    image.save(EXPORTS / "leaf-box-brand-sheet.png")


def make_social_kit_png(logo: Image.Image) -> None:
    image = Image.new("RGB", (1800, 1100), hex_to_rgb(CREAM))
    draw = ImageDraw.Draw(image)
    draw.text((80, 55), "SOCIAL SYSTEM", font=font(48, True), fill=hex_to_rgb(INK))
    draw.text((80, 118), "Three repeatable templates - not three disconnected campaigns", font=font(24), fill=hex_to_rgb(FOREST))
    cards = [(80, 210, 570, 980), (655, 210, 1145, 980), (1230, 210, 1720, 980)]
    fills = [FOREST, MINT, GREEN]
    for box, fill in zip(cards, fills):
        draw.rounded_rectangle(box, radius=35, fill=hex_to_rgb(fill))

    # Announcement
    logo_white_tile = Image.new("RGBA", (370, 175), "white")
    paste_center(logo_white_tile, logo, (35, 30, 335, 145))
    image.paste(logo_white_tile.convert("RGB"), (140, 270))
    draw.text((140, 515), "FRESH DROP", font=font(48, True), fill="white")
    draw.text((140, 585), "A box designed to\nleave less behind.", font=font(30), fill="white", spacing=14)
    draw.rectangle((140, 790, 360, 850), fill=hex_to_rgb(GREEN))
    draw.text((170, 804), "DISCOVER", font=font(22, True), fill="white")

    # Editorial quote
    draw_pattern(draw, (690, 250), 92, 4, 3, SAGE)
    draw.text((720, 570), "SMALL BOX.\nLIGHT FOOTPRINT.", font=font(44, True), fill=hex_to_rgb(INK), spacing=12)
    draw.text((720, 780), "01 / PRINCIPLE", font=font(19, True), fill=hex_to_rgb(GREEN))

    # Promo
    draw.text((1300, 275), "LEAF\nBOX", font=font(76, True), fill="white", spacing=0)
    draw.line((1300, 510, 1650, 510), fill="white", width=5)
    draw.text((1300, 570), "PACK SMARTER", font=font(34, True), fill="white")
    draw.text((1300, 630), "MODULAR / CALM / USEFUL", font=font(17, True), fill="white")
    draw.rounded_rectangle((1300, 770, 1600, 850), radius=20, fill=hex_to_rgb(CREAM))
    draw.text((1340, 790), "LEARN MORE", font=font(22, True), fill=hex_to_rgb(FOREST))
    image.save(EXPORTS / "leaf-box-social-kit.png")


def make_digital_mockup_png(logo: Image.Image) -> None:
    image = Image.new("RGB", (1800, 1125), hex_to_rgb(CREAM))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((65, 60, 1735, 1060), radius=30, fill="white", outline=hex_to_rgb(SAGE), width=3)
    draw.rectangle((65, 60, 1735, 155), fill=hex_to_rgb(FOREST))
    draw.ellipse((105, 95, 125, 115), fill="#FF7A70")
    draw.ellipse((140, 95, 160, 115), fill="#F1C75B")
    draw.ellipse((175, 95, 195, 115), fill="#7DBA72")
    draw.text((1450, 92), "SHOP   STORY   JOURNAL", font=font(18, True), fill="white")

    logo_tile = Image.new("RGBA", (500, 210), "white")
    paste_center(logo_tile, logo, (35, 35, 465, 175))
    image.paste(logo_tile.convert("RGB"), (135, 235))
    draw.text((145, 485), "PACK WHAT MATTERS.\nLEAVE LESS BEHIND.", font=font(55, True), fill=hex_to_rgb(INK), spacing=8)
    draw.text((145, 645), "Modular boxes and thoughtful systems\nfor lighter everyday logistics.", font=font(28), fill=hex_to_rgb(FOREST), spacing=10)
    draw.rounded_rectangle((145, 770, 410, 845), radius=15, fill=hex_to_rgb(GREEN))
    draw.text((194, 791), "EXPLORE THE BOX", font=font(20, True), fill="white")

    draw.rounded_rectangle((960, 240, 1615, 900), radius=38, fill=hex_to_rgb(MINT))
    draw_pattern(draw, (1010, 300), 125, 4, 4, GREEN)
    draw.rounded_rectangle((1095, 455, 1485, 710), radius=25, fill=hex_to_rgb(KRAFT))
    mini = fit_image(logo, 285, 120)
    image.paste(mini, (1147, 515), mini)
    draw.text((980, 945), "Responsive hero / 1440 desktop", font=font(20, mono=True), fill=hex_to_rgb(FOREST))
    image.save(EXPORTS / "leaf-box-digital-mockup.png")


def write_svg_sources() -> None:
    logo_ref = "../assets/leaf-box-logo-transparent.png"
    packaging_ref = "../assets/packaging-mockup-blank.png"
    common = f'<style>.h{{font:700 56px sans-serif;fill:{INK}}}.b{{font:400 24px sans-serif;fill:{FOREST}}}.k{{font:700 16px sans-serif;letter-spacing:2px;fill:{GREEN}}}</style>'

    logo_light_svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600">
<rect width="1200" height="600" fill="white"/><image href="{logo_ref}" x="180" y="145" width="840" height="310" preserveAspectRatio="xMidYMid meet"/>
</svg>'''
    (SOURCE / "logo-on-light.svg").write_text(logo_light_svg, encoding="utf-8")

    logo_dark_svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600">
<rect width="1200" height="600" fill="{FOREST}"/><rect x="120" y="90" width="960" height="420" rx="36" fill="white"/>
<image href="{logo_ref}" x="215" y="175" width="770" height="250" preserveAspectRatio="xMidYMid meet"/>
</svg>'''
    (SOURCE / "logo-on-dark.svg").write_text(logo_dark_svg, encoding="utf-8")

    pattern_svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
<rect width="1200" height="800" fill="{MINT}"/>
<defs><pattern id="p" width="160" height="160" patternUnits="userSpaceOnUse">
<rect x="22" y="22" width="100" height="100" rx="28" fill="none" stroke="{GREEN}" stroke-width="10"/>
<path d="M38 118L116 40M55 101L83 103M72 84L72 57" fill="none" stroke="{GREEN}" stroke-width="9" stroke-linecap="round"/>
</pattern></defs><rect width="1200" height="800" fill="url(#p)"/></svg>'''
    (SOURCE / "pattern-primary.svg").write_text(pattern_svg, encoding="utf-8")

    secondary_svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
<rect width="1200" height="800" fill="{FOREST}"/>
<g fill="none" stroke="{SAGE}" stroke-width="12" opacity=".7">
<path d="M-80 180Q120 20 320 180T720 180T1120 180T1520 180"/>
<path d="M-80 440Q120 280 320 440T720 440T1120 440T1520 440"/>
<path d="M-80 700Q120 540 320 700T720 700T1120 700T1520 700"/>
</g></svg>'''
    (SOURCE / "pattern-secondary.svg").write_text(secondary_svg, encoding="utf-8")

    brand_sheet_svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">
{common}<rect width="1600" height="1000" fill="{CREAM}"/><rect width="1600" height="130" fill="{FOREST}"/>
<text x="80" y="83" style="font:700 42px sans-serif;fill:white">LEAF BOX / IDENTITY OVERVIEW</text>
<rect x="80" y="210" width="680" height="350" rx="20" fill="white"/><image href="{logo_ref}" x="170" y="300" width="500" height="170" preserveAspectRatio="xMidYMid meet"/>
<text x="80" y="620" class="k">OFFICIAL LOGO / UNCHANGED</text><text x="80" y="685" class="h">Grow from the mark.</text>
<text x="80" y="735" class="b">Box geometry. Leaf rhythm. Generous space.</text>
<g transform="translate(850 220)"><rect width="210" height="150" rx="18" fill="{GREEN}"/><rect x="240" width="210" height="150" rx="18" fill="{FOREST}"/><rect x="480" width="210" height="150" rx="18" fill="{SAGE}"/>
<rect y="220" width="210" height="150" rx="18" fill="{MINT}"/><rect x="240" y="220" width="210" height="150" rx="18" fill="{CREAM}" stroke="{SAGE}"/><rect x="480" y="220" width="210" height="150" rx="18" fill="{KRAFT}"/>
<text y="190" class="k">{GREEN}</text><text x="240" y="190" class="k">{FOREST}</text><text x="480" y="190" class="k">{SAGE}</text>
<text y="410" class="k">{MINT}</text><text x="240" y="410" class="k">{CREAM}</text><text x="480" y="410" class="k">{KRAFT}</text></g>
<text x="850" y="775" class="k">TYPE SYSTEM</text><text x="850" y="845" class="h">Manrope</text><text x="850" y="900" class="b">Friendly geometry / readable utility</text></svg>'''
    (SOURCE / "brand-sheet.svg").write_text(brand_sheet_svg, encoding="utf-8")

    packaging_svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024" viewBox="0 0 1536 1024">
<image href="{packaging_ref}" width="1536" height="1024"/>
<image href="{logo_ref}" x="585" y="460" width="420" height="185" preserveAspectRatio="xMidYMid meet" opacity=".96"/>
</svg>'''
    (SOURCE / "packaging-layout.svg").write_text(packaging_svg, encoding="utf-8")

    social_svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
{common}<rect width="1080" height="1080" fill="{FOREST}"/><rect x="90" y="90" width="500" height="235" rx="22" fill="white"/>
<image href="{logo_ref}" x="140" y="145" width="400" height="125" preserveAspectRatio="xMidYMid meet"/>
<text x="90" y="500" style="font:700 82px sans-serif;fill:white">FRESH DROP</text><text x="90" y="590" style="font:400 42px sans-serif;fill:white">A box designed to</text><text x="90" y="650" style="font:400 42px sans-serif;fill:white">leave less behind.</text>
<rect x="90" y="790" width="330" height="95" rx="18" fill="{GREEN}"/><text x="155" y="850" style="font:700 30px sans-serif;fill:white">DISCOVER</text></svg>'''
    (SOURCE / "social-announcement.svg").write_text(social_svg, encoding="utf-8")

    landing_svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900">
{common}<rect width="1440" height="900" fill="{CREAM}"/><rect width="1440" height="92" fill="{FOREST}"/>
<text x="1130" y="56" style="font:700 16px sans-serif;fill:white">SHOP  STORY  JOURNAL</text>
<rect x="90" y="155" width="460" height="205" rx="20" fill="white"/><image href="{logo_ref}" x="135" y="205" width="370" height="110" preserveAspectRatio="xMidYMid meet"/>
<text x="90" y="485" class="h">PACK WHAT MATTERS.</text><text x="90" y="555" class="h">LEAVE LESS BEHIND.</text>
<text x="90" y="625" class="b">Modular boxes and thoughtful systems for lighter logistics.</text>
<rect x="90" y="700" width="280" height="78" rx="14" fill="{GREEN}"/><text x="142" y="750" style="font:700 20px sans-serif;fill:white">EXPLORE THE BOX</text>
<rect x="810" y="145" width="520" height="640" rx="35" fill="{MINT}"/><use href="pattern-primary.svg#p"/>
<rect x="900" y="355" width="340" height="230" rx="20" fill="{KRAFT}"/><image href="{logo_ref}" x="950" y="425" width="240" height="90" preserveAspectRatio="xMidYMid meet"/></svg>'''
    (SOURCE / "landing-page.svg").write_text(landing_svg, encoding="utf-8")


def pdf_header(c: canvas.Canvas, section: str, page: int, dark: bool = False) -> None:
    colour = white if dark else HexColor(FOREST)
    c.setFillColor(colour)
    c.setFont("DV-Bold", 10)
    c.drawString(42, H - 34, f"LEAF BOX / {section.upper()}")
    c.setFont("DV-Mono", 8)
    c.drawRightString(W - 42, H - 34, f"BRAND SYSTEM 01  /  {page:02d}")


def pdf_title(c: canvas.Canvas, title: str, subtitle: str | None = None, y: int = 450, dark: bool = False) -> None:
    c.setFillColor(white if dark else HexColor(INK))
    c.setFont("DV-Bold", 34)
    c.drawString(48, y, title)
    if subtitle:
        c.setFont("DV", 13)
        c.setFillColor(HexColor(MINT if dark else FOREST))
        c.drawString(50, y - 30, subtitle)


def wrapped(c: canvas.Canvas, text: str, x: float, y: float, width: float, size: float = 12, leading: float = 18, colour: str = INK, bold: bool = False) -> float:
    c.setFont("DV-Bold" if bold else "DV", size)
    c.setFillColor(HexColor(colour))
    approx_chars = max(18, int(width / (size * 0.53)))
    for line in textwrap.wrap(text, width=approx_chars):
        c.drawString(x, y, line)
        y -= leading
    return y


def draw_logo_tile(c: canvas.Canvas, x: float, y: float, w: float, h: float, dark_stage: bool = False) -> None:
    c.setFillColor(HexColor(FOREST if dark_stage else WHITE))
    c.roundRect(x, y, w, h, 16, fill=1, stroke=0)
    inset = 28
    if dark_stage:
        c.setFillColor(white)
        c.roundRect(x + inset, y + inset, w - 2 * inset, h - 2 * inset, 12, fill=1, stroke=0)
        inset += 20
    c.drawImage(
        ImageReader(str(LOGO_TRANSPARENT)),
        x + inset,
        y + inset,
        w - 2 * inset,
        h - 2 * inset,
        preserveAspectRatio=True,
        anchor="c",
        mask="auto",
    )


def build_pdf() -> None:
    register_pdf_fonts()
    c = canvas.Canvas(str(PDF_PATH), pagesize=(W, H), pageCompression=1)
    c.setTitle("Leaf Box Brand System 01")
    c.setAuthor("Prepared for Leaf Box Taskmarket brief")

    # 1 Cover
    c.setFillColor(HexColor(FOREST))
    c.rect(0, 0, W, H, fill=1, stroke=0)
    pdf_header(c, "Identity presentation", 1, dark=True)
    c.setFillColor(HexColor(GREEN))
    c.circle(790, 80, 250, fill=1, stroke=0)
    draw_logo_tile(c, 58, 205, 490, 220)
    c.setFillColor(white)
    c.setFont("DV-Bold", 39)
    c.drawString(58, 142, "GROW FROM THE MARK.")
    c.setFont("DV", 14)
    c.drawString(60, 109, "A complete visual identity built around the official logo.")
    c.setFont("DV-Mono", 9)
    c.drawString(60, 62, "SYSTEM 01 / AUGUST 2026 / ORIGINAL LOGO PRESERVED")
    c.showPage()

    # 2 Concept
    c.setFillColor(HexColor(CREAM)); c.rect(0, 0, W, H, fill=1, stroke=0)
    pdf_header(c, "Brand direction", 2)
    pdf_title(c, "A box is structure. A leaf is motion.", "The system balances usefulness with a softer environmental signal.")
    c.setFillColor(HexColor(MINT)); c.roundRect(48, 90, 400, 275, 24, fill=1, stroke=0)
    c.setFillColor(HexColor(GREEN)); c.setLineWidth(8)
    for i in range(3):
        x = 105 + i * 105
        c.roundRect(x, 175, 78, 78, 20, fill=0, stroke=1)
        c.line(x + 18, 195, x + 60, 237)
    c.setFillColor(HexColor(INK)); c.setFont("DV-Bold", 16); c.drawString(78, 125, "MODULAR / CALM / RECOGNIZABLE")
    wrapped(c, "The identity extends the mark's rounded box geometry into frames and modules, while a diagonal leaf rhythm adds movement. Cream and sage create breathing room; Leaf Green remains the recognisable signal.", 510, 345, 365, 13, 20)
    wrapped(c, "Emotional impression: useful optimism. Leaf Box should feel considered rather than preachy, modern rather than clinical, and easy to recognise at a glance.", 510, 220, 365, 13, 20)
    c.showPage()

    # 3 Logo stewardship
    c.setFillColor(white); c.rect(0, 0, W, H, fill=1, stroke=0)
    pdf_header(c, "Logo stewardship", 3)
    pdf_title(c, "One logo. No reinterpretation.", "The supplied JPG is the only logo source used in this kit.")
    draw_logo_tile(c, 48, 188, 430, 205)
    draw_logo_tile(c, 508, 188, 404, 205, dark_stage=True)
    c.setFont("DV-Bold", 11); c.setFillColor(HexColor(GREEN)); c.drawString(55, 158, "LIGHT BACKGROUND")
    c.drawString(515, 158, "DARK BACKGROUND / WHITE HOLDING TILE")
    wrapped(c, "Minimum clear space: the width of the logo's leaf stem on every side. Minimum digital width: 120 px. Keep the original proportions. Never redraw, recolour, outline, crop through, rotate, stretch, add shadows, or place directly on busy imagery.", 50, 120, 850, 11, 16)
    c.showPage()

    # 4 Colour
    c.setFillColor(HexColor(CREAM)); c.rect(0, 0, W, H, fill=1, stroke=0)
    pdf_header(c, "Colour system", 4)
    pdf_title(c, "Recognisable green, quieter company.", "Leaf Green leads; Forest carries text; Sage, Mint and Cream build range.")
    colours = [(GREEN, "LEAF", "73 174 61"), (FOREST, "FOREST", "23 58 42"), (SAGE, "SAGE", "168 185 154"), (MINT, "MINT", "232 242 227"), (CREAM, "CREAM", "247 243 232"), (KRAFT, "KRAFT", "201 154 97")]
    for i, (colour, name, rgb) in enumerate(colours):
        x = 48 + (i % 3) * 300; y = 250 - (i // 3) * 145
        c.setFillColor(HexColor(colour)); c.roundRect(x, y, 260, 100, 16, fill=1, stroke=0)
        text_colour = white if colour in (GREEN, FOREST) else HexColor(INK)
        c.setFillColor(text_colour); c.setFont("DV-Bold", 14); c.drawString(x + 18, y + 58, name)
        c.setFont("DV-Mono", 9); c.drawString(x + 18, y + 35, colour); c.drawString(x + 18, y + 18, f"RGB {rgb}")
    wrapped(c, "Usage ratio: 50% Cream/white, 20% Forest, 15% Mint/Sage, 10% Leaf Green, 5% Kraft. Use Forest on Mint or Cream for long text. Reserve Leaf Green for recognition, actions and selected emphasis.", 50, 72, 860, 11, 16)
    c.showPage()

    # 5 Typography
    c.setFillColor(white); c.rect(0, 0, W, H, fill=1, stroke=0)
    pdf_header(c, "Typography", 5)
    pdf_title(c, "Friendly geometry. Practical reading.", "Recommended family: Manrope, SIL Open Font License 1.1.")
    c.setFillColor(HexColor(INK)); c.setFont("DV-Bold", 61); c.drawString(52, 330, "Manrope")
    c.setFont("DV", 18); c.drawString(55, 292, "Primary family / 400, 600, 700")
    c.setFillColor(HexColor(GREEN)); c.setFont("DV-Bold", 16); c.drawString(55, 230, "DISPLAY / 56 / 0.96 LINE HEIGHT")
    c.setFillColor(HexColor(INK)); c.setFont("DV-Bold", 36); c.drawString(55, 175, "PACK WHAT MATTERS.")
    c.setFillColor(HexColor(GREEN)); c.setFont("DV-Bold", 16); c.drawString(530, 330, "BODY / 18 / 1.5 LINE HEIGHT")
    wrapped(c, "Short sentences. Useful labels. Generous spacing. Headlines can be assertive, but supporting language should stay calm and direct.", 530, 288, 340, 16, 24)
    wrapped(c, "Fallback: Arial, Helvetica, sans-serif. This presentation uses DejaVu Sans for portable embedding; production applications should load Manrope from the official Google Fonts distribution.", 530, 165, 340, 10, 15, FOREST)
    c.showPage()

    # 6 Patterns
    c.setFillColor(HexColor(MINT)); c.rect(0, 0, W, H, fill=1, stroke=0)
    pdf_header(c, "Pattern system", 6)
    pdf_title(c, "A modular rhythm derived from the mark.", "Primary: box-and-stem tiles. Secondary: leaf-path waves.")
    c.setStrokeColor(HexColor(GREEN)); c.setLineWidth(5)
    for row in range(3):
        for col in range(7):
            x = 62 + col * 74; y = 200 + row * 70
            c.roundRect(x, y, 48, 48, 12, fill=0, stroke=1)
            c.line(x + 12, y + 12, x + 38, y + 38)
    c.setFillColor(HexColor(FOREST)); c.roundRect(620, 135, 285, 255, 24, fill=1, stroke=0)
    c.setStrokeColor(HexColor(SAGE)); c.setLineWidth(7)
    for i in range(4):
        y = 180 + i * 55
        path = c.beginPath(); path.moveTo(645, y); path.curveTo(700, y + 45, 760, y - 45, 880, y); c.drawPath(path)
    wrapped(c, "Do: crop patterns boldly, vary scale, and use one system per surface. Don't: place a dense pattern behind the official logo or combine both pattern families at equal strength.", 55, 110, 850, 11, 16)
    c.showPage()

    # 7 Digital
    c.setFillColor(HexColor(CREAM)); c.rect(0, 0, W, H, fill=1, stroke=0)
    pdf_header(c, "Digital application", 7)
    pdf_title(c, "A high-clarity digital storefront.", "Editorial headline, useful navigation, modular product frame.")
    c.drawImage(ImageReader(str(EXPORTS / "leaf-box-digital-mockup.png")), 48, 55, 864, 360, preserveAspectRatio=True, anchor="c")
    c.showPage()

    # 8 Social
    c.setFillColor(white); c.rect(0, 0, W, H, fill=1, stroke=0)
    pdf_header(c, "Social media", 8)
    pdf_title(c, "Three formats. One visual grammar.", "Announcement, principle and promotion templates scale from feed to story.")
    c.drawImage(ImageReader(str(EXPORTS / "leaf-box-social-kit.png")), 55, 42, 850, 380, preserveAspectRatio=True, anchor="c")
    c.showPage()

    # 9 Packaging
    c.setFillColor(HexColor(CREAM)); c.rect(0, 0, W, H, fill=1, stroke=0)
    pdf_header(c, "Packaging", 9)
    pdf_title(c, "Recognition on a real surface.", "The exact logo is composited onto a blank recyclable-box scene.")
    c.drawImage(ImageReader(str(PACKAGING_BRANDED)), 70, 50, 820, 365, preserveAspectRatio=True, anchor="c")
    c.setFillColor(HexColor(FOREST)); c.setFont("DV-Mono", 8)
    c.drawString(72, 34, "AI-GENERATED BLANK MOCKUP / ORIGINAL LOGO OVERLAID PROGRAMMATICALLY / NO STOCK ASSET")
    c.showPage()

    # 10 Applications
    c.setFillColor(HexColor(FOREST)); c.rect(0, 0, W, H, fill=1, stroke=0)
    pdf_header(c, "Application system", 10, dark=True)
    pdf_title(c, "Useful pieces, not random products.", "Stationery and campaign layouts share the same frame, type and colour rules.", dark=True)
    # Business card
    c.setFillColor(white); c.roundRect(55, 225, 390, 205, 20, fill=1, stroke=0)
    c.drawImage(ImageReader(str(LOGO_TRANSPARENT)), 90, 308, 280, 90, preserveAspectRatio=True, anchor="c", mask="auto")
    c.setFillColor(HexColor(FOREST)); c.setFont("DV-Bold", 12); c.drawString(90, 270, "MAYA GREEN / PARTNERSHIPS")
    c.setFont("DV", 10); c.drawString(90, 248, "hello@leafbox.example")
    # Poster
    c.setFillColor(HexColor(MINT)); c.roundRect(520, 115, 380, 315, 20, fill=1, stroke=0)
    c.setFillColor(HexColor(GREEN)); c.setFont("DV-Bold", 35); c.drawString(555, 344, "SMALL BOX.")
    c.setFillColor(HexColor(INK)); c.setFont("DV-Bold", 32); c.drawString(555, 302, "LIGHT")
    c.drawString(555, 264, "FOOTPRINT.")
    c.setStrokeColor(HexColor(SAGE)); c.setLineWidth(5)
    for i in range(3):
        c.roundRect(560 + i * 92, 165, 66, 66, 17, fill=0, stroke=1); c.line(575 + i * 92, 182, 610 + i * 92, 216)
    c.setFillColor(white); c.setFont("DV-Mono", 9); c.drawString(56, 92, "APPLICATION RULE: ONE DOMINANT MESSAGE / ONE SUPPORTING PATTERN / ONE CLEAR ACTION")
    c.showPage()

    # 11 Handoff
    c.setFillColor(HexColor(CREAM)); c.rect(0, 0, W, H, fill=1, stroke=0)
    pdf_header(c, "Handoff", 11)
    pdf_title(c, "A system ready to use.", "Editable SVG sources, transparent PNGs, mockups and this presentation are included.")
    left = [
        "Official requester-supplied logo JPG",
        "Transparent logo PNG (background removed only)",
        "Primary and secondary editable SVG patterns",
        "Editable brand sheet, social, landing and packaging SVGs",
        "High-resolution brand sheet and application PNGs",
        "Presentation PDF and SHA-256 manifest",
    ]
    c.setFont("DV-Bold", 12); c.setFillColor(HexColor(GREEN)); c.drawString(55, 355, "DELIVERY CONTENTS")
    y = 320
    for item in left:
        c.setFillColor(HexColor(GREEN)); c.circle(64, y + 4, 4, fill=1, stroke=0)
        wrapped(c, item, 82, y, 360, 12, 18)
        y -= 42
    c.setFont("DV-Bold", 12); c.setFillColor(HexColor(GREEN)); c.drawString(525, 355, "FINAL CHECK")
    checks = ["Logo source unchanged", "No undisclosed stock assets", "No watermarks", "Light and dark placement shown", "Small-size rule documented", "Patterns connect to the mark", "Font licence disclosed"]
    y = 320
    for item in checks:
        c.setFillColor(HexColor(FOREST)); c.roundRect(525, y - 3, 18, 18, 4, fill=0, stroke=1)
        c.setFont("DV-Bold", 11); c.drawString(530, y + 1, "✓")
        c.setFont("DV", 11); c.drawString(555, y, item)
        y -= 35
    wrapped(c, "Source logo: cdn.dribbble.com/userupload/23285501/file/original-edb38b86ce3afc72d28b6e3d2257d4f4.jpg", 55, 58, 850, 8, 12, FOREST)
    c.save()


def write_readme() -> None:
    text = f"""# Leaf Box Brand Kit

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
| Leaf Green | `{GREEN}` | 73, 174, 61 |
| Forest | `{FOREST}` | 23, 58, 42 |
| Sage | `{SAGE}` | 168, 185, 154 |
| Mint | `{MINT}` | 232, 242, 227 |
| Cream | `{CREAM}` | 247, 243, 232 |
| Kraft | `{KRAFT}` | 201, 154, 97 |

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
"""
    (KIT / "README.md").write_text(text, encoding="utf-8")


def write_manifest() -> None:
    files = []
    for path in sorted(KIT.rglob("*")):
        if not path.is_file() or path == ZIP_PATH or path.name == "manifest.json":
            continue
        data = path.read_bytes()
        files.append(
            {
                "path": str(path.relative_to(KIT)),
                "bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
            }
        )
    manifest = {
        "brand": "Leaf Box",
        "logoPolicy": "Requester-supplied logo preserved; background removal and clear-space crop only.",
        "fileCount": len(files),
        "files": files,
    }
    (KIT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def make_zip() -> None:
    if ZIP_PATH.exists():
        ZIP_PATH.unlink()
    with zipfile.ZipFile(ZIP_PATH, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(KIT.rglob("*")):
            if path.is_file() and path != ZIP_PATH:
                archive.write(path, path.relative_to(KIT))


def copy_pdf_into_delivery() -> None:
    shutil.copy2(PDF_PATH, KIT / "leaf-box-brand-presentation.pdf")


def main() -> None:
    ensure_dirs()
    logo = prepare_logo()
    make_packaging_mockup(logo)
    make_brand_sheet_png(logo)
    make_social_kit_png(logo)
    make_digital_mockup_png(logo)
    write_svg_sources()
    write_readme()
    build_pdf()
    copy_pdf_into_delivery()
    write_manifest()
    make_zip()
    print(json.dumps({
        "pdf": str(PDF_PATH),
        "deliveryPdf": str(KIT / "leaf-box-brand-presentation.pdf"),
        "zip": str(ZIP_PATH),
        "manifest": str(KIT / "manifest.json"),
    }, indent=2))


if __name__ == "__main__":
    main()
