#!/usr/bin/env python3
"""Draws docs/demo.gif and docs/social-preview.png from demo/transcript.json.

Every address, status and note on screen is read from the transcript (real server output);
only the short scene captions and the closing card are authored text.

    python3 -I demo/render.py   # needs Pillow built with Raqm, plus GNU FreeMono

FreeMono is used on purpose: DejaVu Sans Mono mis-draws stacked Vietnamese diacritics
(e.g. "ố") under Raqm layout and has missing glyphs under basic layout.
"""
import json
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONT = "/usr/share/fonts/truetype/freefont/FreeMono.ttf"
BOLD = "/usr/share/fonts/truetype/freefont/FreeMonoBold.ttf"
SANS_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

BG, PANEL, FG, DIM = "#0d1117", "#161b22", "#e6edf3", "#a8b3bf"
GREEN, AMBER, BLUE, RED = "#3fb950", "#d29922", "#58a6ff", "#f85149"

W, H = 880, 500
PAD = 30
SIZE = 19
LINE = 26
COLS = 70

f_reg = ImageFont.truetype(FONT, SIZE)
f_bold = ImageFont.truetype(BOLD, SIZE)
f_cap = ImageFont.truetype(SANS_B, 19)

transcript = json.loads((ROOT / "demo/transcript.json").read_text(encoding="utf-8"))


def wrap(text, indent, first_prefix=""):
    width = COLS - len(indent) - len(first_prefix)
    lines = textwrap.wrap(text, width=width) or [""]
    return [(indent + first_prefix + lines[0])] + [indent + " " * len(first_prefix) + x for x in lines[1:]]


def scene_lines(item):
    """-> (caption, [(text, colour, bold)]) built only from the recorded response."""
    r = item["result"]
    lines = []
    addr = item["args"]["address"]
    cmd = [(f"> {item['tool']}", BLUE, True)]
    for t in wrap(f'address: "{addr}"', "  "):
        cmd.append((t, FG, False))
    body = [("", FG, False)]
    if r["status"] == "ok":
        conf = r.get("confidence", "")
        colour = AMBER if conf == "split_default" else GREEN
        body.append((f"{r['status']} · {conf}", colour, True))
        if r.get("from"):
            body += [(t, DIM, False) for t in wrap(r["from"]["formatted"], "  ", "from  ")]
        body += [(t, colour, True) for t in wrap(r["address"]["formatted"], "  ", "to    ")]
        for alt in r.get("alternatives", []):
            body += [(t, AMBER, False) for t in wrap(alt["formatted"], "  ", "or    ")]
        if r.get("street"):
            body += [(t, FG, False) for t in wrap(r["address"]["formattedWithStreet"], "  ", "full  ")]
        if conf == "split_default" and r.get("notes"):
            body.append(("", FG, False))
            body += [(t, DIM, False) for t in wrap(r["notes"][0], "  ", "note  ")]
        caption = "Old address in, current address out" if conf == "exact" else "Divided wards are flagged, never silently guessed"
    else:
        body.append((r["status"], BLUE, True))
        body += [(t, FG, False) for t in wrap(r["summary"], "  ")]
        body.append(("", FG, False))
        shown = r["candidates"][:3]
        for c in shown:
            frm = c["from"]["formatted"].split(", ")
            body += [(t, DIM, False) for t in wrap(f"{frm[0]}, {frm[1]}  →  {c['to']['ward']['fullName']}", "  ")]
        body.append((f"  … and {len(r['candidates']) - len(shown)} more", DIM, False))
        caption = "Ambiguous input is reported, not guessed"
    return caption, cmd, body


def base(caption, idx, total):
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((10, 10, W - 10, H - 10), radius=12, fill=PANEL)
    for i, c in enumerate(("#ff5f56", "#ffbd2e", "#27c93f")):
        d.ellipse((28 + i * 22, 24, 40 + i * 22, 36), fill=c)
    d.text((W // 2, 30), "vietnam-address-mcp · output of the real server", font=ImageFont.truetype(SANS, 14), fill=DIM, anchor="mm")
    d.text((PAD, 62), f"{idx}/{total}  {caption}" if idx else caption, font=f_cap, fill=FG)
    d.line((PAD, 94, W - PAD, 94), fill="#30363d", width=1)
    return im, d


def draw_lines(d, lines, y0=112, upto=None):
    y = y0
    for text, colour, bold in lines:
        shown = text if upto is None else text[:upto]
        d.text((PAD, y), shown, font=f_bold if bold else f_reg, fill=colour)
        y += LINE


frames, durations = [], []


def push(im, ms):
    frames.append(im)
    durations.append(ms)


total = len(transcript)
for i, item in enumerate(transcript, 1):
    caption, cmd, body = scene_lines(item)
    # typing the command
    typed_total = sum(len(t) for t, _, _ in cmd)
    for n in range(0, typed_total + 1, 6):
        im, d = base(caption, i, total)
        left = n
        y = 112
        for text, colour, bold in cmd:
            take = max(0, min(len(text), left))
            d.text((PAD, y), text[:take], font=f_bold if bold else f_reg, fill=colour)
            left -= len(text)
            y += LINE
        push(im, 45)
    # reveal the response line by line
    for k in range(1, len(body) + 1):
        im, d = base(caption, i, total)
        draw_lines(d, cmd)
        draw_lines(d, body[:k], y0=112 + LINE * len(cmd))
        push(im, 260 if k < len(body) else 3200)

# closing card
im, d = base("Offline · 34 provinces · 3,321 wards · MIT", None, total)
d.text((W // 2, 215), "vietnam-address-mcp", font=ImageFont.truetype(SANS_B, 40), fill=FG, anchor="mm")
d.text((W // 2, 262), "Old → new Vietnamese addresses for AI assistants", font=ImageFont.truetype(SANS, 20), fill=DIM, anchor="mm")
d.text((W // 2, 330), "github.com/amItuff/vietnam-address-mcp", font=f_bold, fill=BLUE, anchor="mm")
push(im, 3200)

out = ROOT / "docs/demo.gif"
out.parent.mkdir(exist_ok=True)
# One shared palette for every frame, so colours do not shift between scenes.
mosaic = Image.new("RGB", (W, H * len(frames[::6])))
for n, f in enumerate(frames[::6]):
    mosaic.paste(f, (0, n * H))
shared = mosaic.quantize(colors=48, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
pal = [f.quantize(palette=shared, dither=Image.Dither.NONE) for f in frames]
pal[0].save(out, save_all=True, append_images=pal[1:], duration=durations, loop=0, optimize=True, disposal=1)
print(f"{out.relative_to(ROOT)}: {len(frames)} frames, {out.stat().st_size / 1024:.0f} KiB, {sum(durations) / 1000:.1f}s")

# ---- social preview (1280x640, the size GitHub recommends) ------------------------------
SW, SH = 1280, 640
im = Image.new("RGB", (SW, SH), BG)
d = ImageDraw.Draw(im)
d.rectangle((0, 0, 12, SH), fill=BLUE)
d.text((80, 150), "vietnam-address-mcp", font=ImageFont.truetype(SANS_B, 78), fill=FG)
d.text((80, 250), "Convert old Vietnamese addresses to the new", font=ImageFont.truetype(SANS, 36), fill=DIM)
d.text((80, 298), "34-province structure — from your AI assistant.", font=ImageFont.truetype(SANS, 36), fill=DIM)
d.rounded_rectangle((80, 380, SW - 80, 520), radius=14, fill=PANEL)
first = transcript[0]["result"]
d.text((110, 410), first["from"]["formatted"].replace(", Thành phố Hồ Chí Minh", ""), font=ImageFont.truetype(FONT, 30), fill=DIM)
d.text((110, 462), "→ " + first["address"]["formatted"].replace(", Thành phố Hồ Chí Minh", ""), font=ImageFont.truetype(BOLD, 30), fill=GREEN)
d.text((SW - 80, SH - 50), "MCP server · offline · MIT", font=ImageFont.truetype(SANS, 24), fill=DIM, anchor="rm")
im.save(ROOT / "docs/social-preview.png", optimize=True)
print("docs/social-preview.png written")
