#!/usr/bin/env python3
"""
The Earth at night, as a globe seen from space: the top slice of it, for the
map's Through time view (the curve along the foot of the screen, satellites
over it).

  map/tools/night-globe.py
  map/tools/night-globe.py --lat -5 --lon -123 --width 3000 --cap 0.45

Projects NASA's Black Marble 2016 (public domain; the 3 km image, fetched
once to ~/.cache/ecoscapes-globe) orthographically round a point, darkens
it towards the rim as a lit sphere would be, and keeps the top `cap` of the
disc -- the part the screen shows -- with the sky round it clear.

--lat/--lon is the point straight below the viewer. It sits well below the
slice, so it is set far south of what should show: 5S, 123W puts British
Columbia (the Sea-to-Sky) near the middle of the curve, the Arctic along
its top edge.

Writes public/img/night-globe.webp.
"""
import argparse, os, urllib.request

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
SRC = "https://eoimages.gsfc.nasa.gov/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lat", type=float, default=-5)
    ap.add_argument("--lon", type=float, default=-123)
    ap.add_argument("--width", type=int, default=3000, help="the whole disc's width, px")
    ap.add_argument("--cap", type=float, default=0.45, help="how much of the disc, from the top, to keep (of its radius)")
    ap.add_argument("--gain", type=float, default=1.8, help="how much to brighten the night image")
    ap.add_argument("--out", default="public/img/night-globe.webp")
    a = ap.parse_args()

    cache = os.path.expanduser("~/.cache/ecoscapes-globe/bm3km.jpg")
    if not os.path.exists(cache):
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        urllib.request.urlretrieve(SRC, cache)
    src = np.asarray(Image.open(cache).convert("RGB"), dtype=np.float32)
    sh, sw = src.shape[:2]

    R = a.width / 2
    h = int(round(R * a.cap))
    ys, xs = np.mgrid[0:h, 0:a.width].astype(np.float64)
    nx = (xs + 0.5 - R) / R
    ny = (R - (ys + 0.5)) / R
    rho = np.hypot(nx, ny)
    inside = rho <= 1
    rho_c = np.clip(rho, 1e-9, 1)
    c = np.arcsin(rho_c)
    p0 = np.radians(a.lat)
    l0 = np.radians(a.lon)
    # Inverse orthographic: the lat/lon under each pixel of the disc.
    lat = np.arcsin(np.clip(np.cos(c) * np.sin(p0) + ny * np.sin(c) * np.cos(p0) / rho_c, -1, 1))
    lon = l0 + np.arctan2(nx * np.sin(c), rho_c * np.cos(c) * np.cos(p0) - ny * np.sin(c) * np.sin(p0))
    lon = (lon + np.pi) % (2 * np.pi) - np.pi
    u = ((lon + np.pi) / (2 * np.pi) * sw).astype(int).clip(0, sw - 1)
    v = ((np.pi / 2 - lat) / np.pi * sh).astype(int).clip(0, sh - 1)
    rgb = src[v, u]
    # Towards the rim the ground is seen edge on: darker, as a lit sphere.
    shade = (0.35 + 0.65 * np.cos(c)) ** 0.8
    # Black Marble is dark: lifted to the grey-blue of a night photograph.
    rgb *= shade[..., None] * a.gain
    # The rim itself softened over a pixel or two, not stepped.
    alpha = np.clip((1 - rho) * R / 1.5, 0, 1) * inside
    out = np.dstack([rgb.clip(0, 255), alpha * 255]).astype(np.uint8)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    Image.fromarray(out, "RGBA").save(a.out, "WEBP", quality=82, method=6)
    print(a.out, f"{a.width}x{h}", f"{os.path.getsize(a.out) / 1e3:.0f} kB")


if __name__ == "__main__":
    main()
