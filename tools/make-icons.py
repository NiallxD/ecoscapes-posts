"""Render the PWA icon set. Maskable variants keep their artwork inside the
centre 80% so Android's shape mask cannot crop it."""
import pathlib
from PIL import Image, ImageDraw

OUT = pathlib.Path(__file__).resolve().parent.parent / "public/icons"
BG, FG = (13, 18, 16), (127, 209, 166)

def icon(size, maskable=False):
    img = Image.new("RGB", (size, size), BG)
    d = ImageDraw.Draw(img)
    s = size / 64
    inset = size * 0.1 if maskable else 0  # maskable safe zone
    def sc(v):
        return inset + (v * s) * (1 - 2 * inset / size)
    w = max(2, int(4 * s * (1 - 2 * inset / size)))
    d.line([(sc(8), sc(44)), (sc(17), sc(38)), (sc(26), sc(33)), (sc(35), sc(37)),
            (sc(44), sc(41)), (sc(56), sc(44))], fill=FG, width=w, joint="curve")
    r = 7 * s * (1 - 2 * inset / size)
    cx, cy = sc(32), sc(23)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=FG, width=w)
    return img

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        icon(size).save(OUT / f"icon-{size}.png", optimize=True)
    icon(512, maskable=True).save(OUT / "icon-maskable-512.png", optimize=True)
    for p in sorted(OUT.iterdir()):
        print(p.name, p.stat().st_size // 1024, "KB")
