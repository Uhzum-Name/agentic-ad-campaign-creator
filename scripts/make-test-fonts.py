"""
Builds the tiny synthetic fonts used by the font tests (packages/fonts/test/fixtures).
They are drawn here, so they carry no third-party licence. Each glyph is a box;
"W" is deliberately very wide so a browser test can tell the font was applied.

    python -m venv .venv && .venv/bin/pip install fonttools brotli
    .venv/bin/python scripts/make-test-fonts.py
"""
import os
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.ttGlyphPen import TTGlyphPen

OUT = os.path.join(os.path.dirname(__file__), "..", "packages", "fonts", "test", "fixtures")
CHARS = {"space": 0x20, "W": 0x57, "i": 0x69}
WIDTHS = {".notdef": 500, "space": 250, "W": 3000, "i": 300}


def box(pen, w):
    pen.moveTo((50, 0)); pen.lineTo((50, 700)); pen.lineTo((w - 50, 700)); pen.lineTo((w - 50, 0)); pen.closePath()


def build(path, family, subfamily, weight, italic, cff, typographic=None, flavor=None):
    order = [".notdef", "space", "W", "i"]
    fb = FontBuilder(1000, isTTF=not cff)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({cp: g for g, cp in CHARS.items()})
    metrics = {g: (WIDTHS[g], 50) for g in order}
    if cff:
        charstrings = {}
        for g in order:
            pen = T2CharStringPen(WIDTHS[g], None)
            if g != "space":
                box(pen, WIDTHS[g])
            charstrings[g] = pen.getCharString()
        fb.setupCFF(family.replace(" ", "") + "-" + subfamily.replace(" ", ""), {"FullName": f"{family} {subfamily}"}, charstrings, {})
    else:
        glyphs = {}
        for g in order:
            pen = TTGlyphPen(None)
            if g != "space":
                box(pen, WIDTHS[g])
            glyphs[g] = pen.glyph()
        fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    names = {"familyName": family, "styleName": subfamily}
    if typographic:
        names["typographicFamily"], names["typographicSubfamily"] = typographic
    fb.setupNameTable(names)
    fb.setupOS2(usWeightClass=weight, fsSelection=(0x01 if italic else 0x40), sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    fb.setupPost()
    fb.updateHead(macStyle=(0x02 if italic else 0) | (0x01 if weight >= 700 else 0))
    if flavor:
        fb.font.flavor = flavor
    fb.save(os.path.join(OUT, path))


os.makedirs(OUT, exist_ok=True)
build("ProbeSans-Regular.ttf", "Probe Sans", "Regular", 400, False, cff=False)
build("ProbeSans-BoldItalic.otf", "Probe Sans", "Bold Italic", 700, True, cff=True)
# Legacy family name carries the weight; the typographic family (name 16) is the real one.
build("ProbeSans-Semibold.woff", "Probe Sans Semibold", "Regular", 600, False, cff=False, typographic=("Probe Sans", "Semibold"), flavor="woff")
build("ProbeSans-Light.woff2", "Probe Sans", "Light", 300, False, cff=False, flavor="woff2")
build("ProbeSans-BlackItalic.woff2", "Probe Sans Black", "Italic", 900, True, cff=True, typographic=("Probe Sans", "Black Italic"), flavor="woff2")
print("wrote", sorted(os.listdir(OUT)))
