"""Builds the showcase images for the README (docs/images/).

The lettering is rendered with Pillow; the distress effect comes from the same engine
as the plugin (distress/core.js via tools/distress-raw.js).
Usage: python3 tools/make-showcase.py [hero|gallery|controls|combine|bleed]
"""
import json
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "images")
TMP = tempfile.mkdtemp(prefix="msd-")
FONTS = "/System/Library/Fonts/Supplemental/"
IMPACT = FONTS + "Impact.ttf"
BLACK = FONTS + "Arial Black.ttf"
LABEL = "/System/Library/Fonts/Helvetica.ttc"
# outside macOS: fonts from the environment (MSD_IMPACT, MSD_BLACK, MSD_LABEL)
IMPACT = os.environ.get("MSD_IMPACT", IMPACT)
BLACK = os.environ.get("MSD_BLACK", BLACK)
LABEL = os.environ.get("MSD_LABEL", LABEL)

PAPER = (238, 230, 212)
INK = (28, 26, 30)
os.makedirs(OUT, exist_ok=True)
_n = 0


def text_alpha(text, font_path, size, pad=40):
    font = ImageFont.truetype(font_path, size)
    l, t, r, b = font.getbbox(text)
    img = Image.new("L", (r - l + pad * 2, b - t + pad * 2), 0)
    ImageDraw.Draw(img).text((pad - l, pad - t), text, font=font, fill=255)
    return img


def shape_alpha(kind, w, h):
    img = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(img)
    m = 14
    if kind == "rect":
        d.rounded_rectangle((m, m, w - m, h - m), radius=10, fill=255)
    else:
        d.ellipse((m, m, w - m, h - m), fill=255)
    return img


def distress(alpha_img, params, want_color=False):
    """Returns (mask, colour|None) as L images."""
    global _n
    _n += 1
    w, h = alpha_img.size
    a = os.path.join(TMP, f"a{_n}.raw")
    m = os.path.join(TMP, f"m{_n}.raw")
    c = os.path.join(TMP, f"c{_n}.raw")
    with open(a, "wb") as f:
        f.write(alpha_img.tobytes())
    args = ["node", os.path.join(ROOT, "tools", "distress-raw.js"), a, str(w), str(h), json.dumps(params), m]
    if want_color:
        args.append(c)
    subprocess.run(args, check=True)
    mask = Image.frombytes("L", (w, h), open(m, "rb").read())
    color = Image.frombytes("L", (w, h), open(c, "rb").read()) if want_color else None
    return mask, color


def paper(w, h, tone=PAPER):
    return Image.new("RGB", (w, h), tone)


def composite(base, alpha_img, mask, rgb, pos=(0, 0), color=None, color_rgb=None):
    eff = Image.new("L", alpha_img.size, 0)
    eff.paste(alpha_img, (0, 0), mask)  # alpha × mask
    solid = Image.new("RGB", alpha_img.size, rgb)
    base.paste(solid, pos, eff)
    if color is not None:
        base.paste(Image.new("RGB", alpha_img.size, color_rgb), pos, color)


def label(draw, xy, text, size=18, fill=(90, 84, 78), anchor="la"):
    draw.text(xy, text, font=ImageFont.truetype(LABEL, size), fill=fill, anchor=anchor)


# ------------------------------------------------------------------ Hero
def hero():
    W, H = 1600, 640
    img = paper(W, H)
    rows = [
        ("MS DISTRESS", {"texture": "stamp", "scale": 140, "shapeDistress": 45, "innerDistress": 28, "innerEdgeSize": 10, "edgeRoughness": 5, "seed": 3}, (196, 40, 36)),
        ("PLUGIN FOR PHOTOSHOP", {"texture": "worn", "scale": 70, "shapeDistress": 22, "innerDistress": 10, "innerEdgeSize": 6, "edgeRoughness": 1.5, "seed": 11}, INK),
    ]
    y = 70
    for i, (txt, p, rgb) in enumerate(rows):
        a = text_alpha(txt, IMPACT if i == 0 else BLACK, 230 if i == 0 else 92)
        mask, _ = distress(a, p)
        x = (W - a.size[0]) // 2
        composite(img, a, mask, rgb, (x, y))
        y += a.size[1] + 10
    d = ImageDraw.Draw(img)
    label(d, (W // 2, H - 48), "Distressed textures for Photoshop – non-destructive on text, shapes & layers",
          26, (110, 100, 90), "ma")
    img.save(os.path.join(OUT, "hero.png"), optimize=True)


# ------------------------------------------------------------------ texture gallery
def gallery():
    textures = json.loads(subprocess.run(
        ["node", "-e", "console.log(JSON.stringify(require(process.argv[1]).TEXTURES))",
         os.path.join(ROOT, "distress", "core.js")], capture_output=True, text=True, check=True).stdout)
    cols, tile, gap, cap = 6, 220, 18, 30
    rows = (len(textures) + cols - 1) // cols
    W = cols * (tile + gap) + gap
    H = rows * (tile + gap + cap) + gap
    img = paper(W, H)
    d = ImageDraw.Draw(img)
    for k, t in enumerate(textures):
        a = shape_alpha("rect", tile, tile)
        mask, _ = distress(a, {"texture": t["id"], "scale": 80, "shapeDistress": 45, "innerDistress": 35, "innerEdgeSize": 14, "edgeRoughness": 3, "seed": 5})
        x = gap + (k % cols) * (tile + gap)
        y = gap + (k // cols) * (tile + gap + cap)
        composite(img, a, mask, INK, (x, y))
        label(d, (x + tile // 2, y + tile + 4), t["name"], 17, (70, 64, 58), "ma")
    img.save(os.path.join(OUT, "textures.png"), optimize=True)


# ------------------------------------------------------------------ slider demo
def controls():
    word = "WORN"
    base = {"texture": "worn", "scale": 90, "shapeDistress": 40, "innerDistress": 20, "innerEdgeSize": 10, "edgeRoughness": 3, "seed": 21}
    demos = [
        ("Shape Distress 15 %", {"shapeDistress": 15, "innerDistress": 5}),
        ("Shape Distress 45 %", {}),
        ("Shape Distress 75 %", {"shapeDistress": 75, "innerDistress": 50}),
        ("Shape Meld 0 (hard)", {"shapeMeld": 0}),
        ("Shape Meld 100 (soft)", {"shapeMeld": 100}),
        ("Edge Roughness 14 px", {"edgeRoughness": 14}),
        ("Inner Edge Size 0", {"innerEdgeSize": 0, "innerDistress": 40}),
        ("Fade from left", {"fadeAmount": 90, "fadeStyle": "left", "shapeDistress": 70, "innerDistress": 55}),
        ("Fade on opacity", {"fadeAmount": 80, "fadeStyle": "bottom", "fadeTarget": "opacity"}),
        ("Shape Color", {"colorEnabled": True, "shapeDistress": 55, "innerDistress": 40}),
        ("Texture inverted", {"invert": True}),
        ("Size 250 %", {"scale": 250}),
    ]
    cols = 3
    a = text_alpha(word, IMPACT, 150, pad=24)
    tw, th = a.size
    gap, cap = 24, 34
    rows = (len(demos) + cols - 1) // cols
    W = cols * (tw + gap) + gap
    H = rows * (th + cap + gap) + gap
    img = paper(W, H)
    d = ImageDraw.Draw(img)
    for k, (name, over) in enumerate(demos):
        p = dict(base, **over)
        mask, color = distress(a, p, want_color=bool(p.get("colorEnabled")))
        x = gap + (k % cols) * (tw + gap)
        y = gap + (k // cols) * (th + cap + gap)
        composite(img, a, mask, (40, 70, 160), (x, y), color, (232, 180, 40))
        label(d, (x + tw // 2, y + th + 4), name, 19, (70, 64, 58), "ma")
    img.save(os.path.join(OUT, "sliders.png"), optimize=True)


# ------------------------------------------------------------------ combining texture 2
def combine():
    a = text_alpha("MIX", IMPACT, 170, pad=24)
    tw, th = a.size
    base = {"scale": 100, "shapeDistress": 45, "innerDistress": 35, "innerEdgeSize": 10, "edgeRoughness": 3, "seed": 8}
    demos = [
        ("Grunge", {"texture": "grunge"}),
        ("Cracks", {"texture": "cracks"}),
        ("Blend", {"texture": "grunge", "texture2": "cracks", "texture2Mix": 50, "texture2Mode": "blend"}),
        ("Add", {"texture": "grunge", "texture2": "cracks", "texture2Mix": 100, "texture2Mode": "add"}),
        ("Scratches", {"texture": "scratches"}),
        ("Masked with stamp", {"texture": "scratches", "texture2": "stamp", "texture2Mix": 100, "texture2Mode": "mask"}),
    ]
    cols, gap, cap = 6, 20, 34
    W = cols * (tw + gap) + gap
    H = th + cap + gap * 2
    img = paper(W, H)
    d = ImageDraw.Draw(img)
    for k, (name, over) in enumerate(demos):
        mask, _ = distress(a, dict(base, **over))
        x = gap + k * (tw + gap)
        composite(img, a, mask, (180, 40, 40), (x, gap))
        label(d, (x + tw // 2, gap + th + 4), name, 19, (70, 64, 58), "ma")
    img.save(os.path.join(OUT, "combine.png"), optimize=True)


# ------------------------------------------------------------------ ink bleed
def bleed():
    global _n
    a = text_alpha("INK", IMPACT, 170, pad=40)
    tw, th = a.size
    base = {"texture": "worn", "scale": 70, "shapeDistress": 0, "innerDistress": 0, "edgeRoughness": 0, "seed": 4,
            "bleedEnabled": True, "bleedSpread": 4, "bleedFibres": 40, "bleedOpacity": 90}
    demos = [
        ("No bleed", {"bleedEnabled": False}, INK),
        ("Spread 2 px", {"bleedSpread": 2, "bleedFibres": 20}, INK),
        ("Spread 5 px", {"bleedSpread": 5}, INK),
        ("Fibres 90 %", {"bleedSpread": 5, "bleedFibres": 90}, INK),
        ("With distress", {"shapeDistress": 30, "innerDistress": 12, "innerEdgeSize": 6, "edgeRoughness": 1.5}, INK),
        ("In colour", {"bleedSpread": 4}, (40, 70, 160)),
    ]
    cols, gap, cap = 6, 20, 34
    W = cols * (tw + gap) + gap
    H = th + cap + gap * 2
    img = paper(W, H)
    d = ImageDraw.Draw(img)
    for k, (name, over, rgb) in enumerate(demos):
        p = dict(base, **over)
        _n += 1
        af, mf, bf = (os.path.join(TMP, f"{c}{_n}.raw") for c in "amb")
        with open(af, "wb") as f:
            f.write(a.tobytes())
        out = subprocess.run(["node", os.path.join(ROOT, "tools", "bleed-raw.js"), af, str(tw), str(th), json.dumps(p), mf, bf],
                             check=True, capture_output=True, text=True).stdout
        pad = json.loads(out)["pad"]
        mask = Image.frombytes("L", (tw, th), open(mf, "rb").read())
        x = gap + k * (tw + gap)
        if p["bleedEnabled"]:
            bl = Image.frombytes("L", (tw + 2 * pad, th + 2 * pad), open(bf, "rb").read())
            bl = bl.point(lambda v: int(v * p["bleedOpacity"] / 100))
            # only inside this tile
            crop = bl.crop((pad, pad, pad + tw, pad + th))
            img.paste(Image.new("RGB", (tw, th), rgb), (x, gap), crop)
        composite(img, a, mask, rgb, (x, gap))
        label(d, (x + tw // 2, gap + th + 4), name, 19, (70, 64, 58), "ma")
    img.save(os.path.join(OUT, "ink-bleed.png"), optimize=True)


if __name__ == "__main__":
    only = sys.argv[1] if len(sys.argv) > 1 else None   # e.g. "bleed" renders just that image
    if only:
        globals()[only]()
        print("written:", only)
        sys.exit(0)
    hero()
    gallery()
    controls()
    combine()
    bleed()
    print("images written:", ", ".join(sorted(os.listdir(OUT))))
