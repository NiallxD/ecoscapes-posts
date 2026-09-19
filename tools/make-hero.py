"""Render a portrait hero still out of an equirectangular panorama.

Cropping an equirect directly gives a stretched, obviously-wrong image, because
the projection compresses horizontally towards the poles. This reprojects
instead: for every output pixel it casts a ray through a pinhole camera aimed at
(yaw, pitch) and samples the sphere, which is what the panorama viewer itself
does. The result reads as an ordinary photograph.

Usage:
  tools/make-hero.py <pano.jpg> <out.jpg> [--yaw DEG] [--pitch DEG] [--vfov DEG]
                     [--size WxH] [--quality N]
"""
import argparse
import numpy as np
from PIL import Image


def render(src: Image.Image, yaw=0.0, pitch=0.0, vfov=75.0, size=(1080, 1920)):
    W, H = size
    eq = np.asarray(src.convert("RGB"), dtype=np.float32)
    EH, EW, _ = eq.shape

    # Pinhole camera: focal length in pixels from the vertical field of view.
    focal = (H / 2) / np.tan(np.radians(vfov) / 2)
    xs = np.arange(W, dtype=np.float32) - (W - 1) / 2
    ys = np.arange(H, dtype=np.float32) - (H - 1) / 2
    gx, gy = np.meshgrid(xs, ys)
    gz = np.full_like(gx, focal)

    # Rotate the ray bundle: pitch about X, then yaw about Y.
    p, y = np.radians(pitch), np.radians(yaw)
    dy = gy * np.cos(p) - gz * np.sin(p)
    dz = gy * np.sin(p) + gz * np.cos(p)
    dx, dz = gx * np.cos(y) + dz * np.sin(y), -gx * np.sin(y) + dz * np.cos(y)

    norm = np.sqrt(dx * dx + dy * dy + dz * dz)
    lon = np.arctan2(dx, dz)
    lat = np.arcsin(np.clip(dy / norm, -1.0, 1.0))

    # Sphere -> equirect pixel coordinates.
    u = (lon / (2 * np.pi) + 0.5) * EW - 0.5
    v = (lat / np.pi + 0.5) * EH - 0.5

    u0 = np.floor(u).astype(np.int32)
    v0 = np.clip(np.floor(v).astype(np.int32), 0, EH - 2)
    fu = (u - u0)[..., None]
    fv = (v - v0)[..., None]
    # Longitude wraps, so the seam samples correctly with a modulo.
    u0m, u1m = u0 % EW, (u0 + 1) % EW

    top = eq[v0, u0m] * (1 - fu) + eq[v0, u1m] * fu
    bot = eq[v0 + 1, u0m] * (1 - fu) + eq[v0 + 1, u1m] * fu
    return Image.fromarray(np.clip(top * (1 - fv) + bot * fv, 0, 255).astype(np.uint8))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--yaw", type=float, default=0.0)
    ap.add_argument("--pitch", type=float, default=0.0)
    ap.add_argument("--vfov", type=float, default=75.0)
    ap.add_argument("--size", default="1080x1920")
    ap.add_argument("--quality", type=int, default=80)
    a = ap.parse_args()

    w, h = (int(n) for n in a.size.lower().split("x"))
    img = render(Image.open(a.src), a.yaw, a.pitch, a.vfov, (w, h))
    img.save(a.out, quality=a.quality, optimize=True, progressive=True)
    print(a.out, img.size)
