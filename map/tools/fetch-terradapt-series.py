#!/usr/bin/env python3
"""
A TerrAdapt time series as one GeoTIFF per year, rebuilt from the
dashboard's own map tiles.

  map/tools/fetch-terradapt-series.py                       # landcover, every year
  map/tools/fetch-terradapt-series.py --years 1984 2024     # just these years
  map/tools/fetch-terradapt-series.py --zoom 11             # coarser, 4x fewer tiles
  map/tools/fetch-terradapt-series.py --layer human_footprint --theme human_footprint \
      --start 1985-07-01T00:00:00 --end 2022-07-01T00:00:00

The dashboard's API (api-hsbr.staging.dashboard.terradapt.org, no login) hands
out one Earth Engine tile URL per year for a layer. Those tiles are coloured
JPEGs, not values, so each pixel is matched back to the nearest legend colour.
0 is no data (black on TerrAdapt) either way.

- A legend of fixed colours ("blocks", landcover): written as that class's
  number, 1 = the legend's first entry ("Water"), 2 the second, and so on, in
  the order the API lists them. The numbering is TerrAdapt's own order (the
  portal's Felt files use the same).
- A colour ramp ("gradient", human footprint): the ramp's stops, evenly spaced
  from the first label's value to the last's and blended between, as Earth
  Engine draws them; each pixel written as the value its colour sits at,
  rounded. Values have to fall within 1-255.

JPEG blurs colour at class edges, so a thin edge pixel can land on the wrong
class, and a ramp's values carry a unit or two of noise; each year prints the
share of pixels whose colour sat far from every legend colour (the ones worth
doubting), no-data pixels left out.

Output is EPSG:3857 at the tile grid of --zoom (z12 is ~25 m at 50 N, a touch
finer than TerrAdapt's 30 m Landsat pixels), clipped to the study area.
Tiles are cached, so a re-run only fetches what's missing.
Needs GDAL (gdal_translate), numpy and Pillow.
"""
import argparse, io, json, math, os, subprocess, sys, tempfile, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

API = "https://api-hsbr.staging.dashboard.terradapt.org/map/select_layer"
# The study area (map/content/sea-to-sky.md `limit`), as build-map.py.
BBOX = (-124.69, 48.94, -121.43, 51.26)
R = 6378137.0
FAR = 40  # RGB distance past which a pixel's class is doubtful


def tile_xy(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return int(x), int(y)


def merc(x, y, z):
    """Web Mercator metres of tile corner (x, y) at zoom z."""
    size = 2 * math.pi * R / 2 ** z
    return -math.pi * R + x * size, math.pi * R - y * size


def get(url, tries=8):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return r.read()
        except Exception as e:
            if i == tries - 1:
                raise
            # Earth Engine answers "too many requests" when pushed: waited out,
            # longer each time (up to about two minutes all told).
            time.sleep(min(2 ** i, 30) * (3 if getattr(e, "code", None) == 429 else 1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--layer", default="landcover_class")
    ap.add_argument("--theme", default="landcover")
    ap.add_argument("--start", default="1984-07-01T00:00:00")
    ap.add_argument("--end", default="2024-07-01T00:00:00")
    ap.add_argument("--years", nargs="*", type=int, help="only these years (default all)")
    ap.add_argument("--zoom", type=int, default=12)
    ap.add_argument("--bbox", type=float, nargs=4, default=BBOX, metavar=("W", "S", "E", "N"))
    ap.add_argument("--cache", default=os.path.expanduser("~/.cache/ecoscapes-terradapt"))
    ap.add_argument("--out", help="default <cache>/<layer>")
    ap.add_argument("--workers", type=int, default=12)
    a = ap.parse_args()

    q = f"layer={a.layer}&view=status&theme={a.theme}&scope=monitor&visualisation=pixel&start={a.start}&end={a.end}"
    layer = json.loads(get(f"{API}?{q}"))["layer"]
    legend = layer["legend"]
    steps = legend["steps"]
    stops = np.array([[int(s["color"][i:i + 2], 16) for i in (1, 3, 5)] for s in steps], dtype=np.float64)
    out = a.out or os.path.join(a.cache, a.layer)
    os.makedirs(out, exist_ok=True)
    # What each value is drawn as (`targets`), and the value it stands for.
    if legend.get("type") == "blocks":
        targets, values = stops, np.arange(1, len(steps) + 1)
        with open(os.path.join(out, "classes.json"), "w") as f:
            json.dump([{"value": i + 1, "label": s["label"].strip(), "color": s["color"]} for i, s in enumerate(steps)], f, indent=2)
    elif legend.get("type") == "gradient":
        lo, hi = float(steps[0]["label"]), float(steps[-1]["label"])
        if lo < 1 or hi > 255:
            sys.exit(f"{a.layer}: values {lo}-{hi} don't fit 1-255")
        t = np.linspace(0, len(stops) - 1, 100 * (len(stops) - 1) + 1)
        i = np.minimum(t.astype(int), len(stops) - 2)
        f_ = (t - i)[:, None]
        targets = stops[i] * (1 - f_) + stops[i + 1] * f_
        values = np.rint(lo + (hi - lo) * t / (len(stops) - 1)).astype(int)
        with open(os.path.join(out, "range.json"), "w") as f:
            json.dump({"min": lo, "max": hi, "units": legend.get("units"), "stops": [s["color"] for s in steps]}, f, indent=2)
    else:
        sys.exit(f"{a.layer}: legend is {legend.get('type')!r}, neither blocks nor a gradient")

    # Every colour a pixel can be, to 6 bits a channel, looked up once: the
    # value nearest it and how far off it is. A tile's pixels are then just
    # looked up in that.
    q = (np.arange(64) * 4 + 2).astype(np.float64)
    cube = np.stack(np.meshgrid(q, q, q, indexing="ij"), -1).reshape(-1, 3)
    near = np.empty(len(cube), dtype=np.uint8)
    off = np.empty(len(cube), dtype=np.float32)
    for k in range(0, len(cube), 4096):
        d = ((cube[k:k + 4096, None] - targets[None]) ** 2).sum(-1)
        j = d.argmin(1)
        near[k:k + 4096] = values[j]
        off[k:k + 4096] = np.sqrt(d[np.arange(len(j)), j])

    w, s_, e, n = a.bbox
    x0, y0 = tile_xy(w, n, a.zoom)
    x1, y1 = tile_xy(e, s_, a.zoom)
    xs, ys = range(x0, x1 + 1), range(y0, y1 + 1)
    print(f"{a.layer}: {len(layer['tiles'])} years, {len(xs)}x{len(ys)} tiles at z{a.zoom}", flush=True)

    # Palette PNG -> GeoTIFF keeps a colour table, so the values draw in GIS as on TerrAdapt.
    pal = [0, 0, 0] * 256
    for v, rgb in zip(values, targets):
        pal[3 * v:3 * v + 3] = [int(c) for c in rgb]
    for t in layer["tiles"]:
        year = int(t["date"][:4])
        if a.years and year not in a.years:
            continue
        tif = os.path.join(out, f"{a.layer}_{year}.tif")
        if os.path.exists(tif):
            print(year, "done already")
            continue
        url = t["url"].replace("%7B", "{").replace("%7D", "}")
        tdir = os.path.join(a.cache, "tiles", a.layer, str(year), str(a.zoom))

        def fetch(xy):
            x, y = xy
            p = os.path.join(tdir, f"{x}_{y}.jpg")
            if not os.path.exists(p):
                data = get(url.format(z=a.zoom, x=x, y=y))
                os.makedirs(tdir, exist_ok=True)
                with open(p + ".part", "wb") as f:
                    f.write(data)
                os.replace(p + ".part", p)
            return xy, p

        mosaic = np.zeros((len(ys) * 256, len(xs) * 256, 3), dtype=np.uint8)
        with ThreadPoolExecutor(a.workers) as pool:
            for (x, y), p in pool.map(fetch, [(x, y) for y in ys for x in xs]):
                im = Image.open(p).convert("RGB")
                r, c = (y - y0) * 256, (x - x0) * 256
                mosaic[r:r + 256, c:c + 256] = np.asarray(im)

        cls = np.zeros(mosaic.shape[:2], dtype=np.uint8)
        far = filled = 0
        for r in range(0, mosaic.shape[0], 256):  # in strips, to keep memory down
            px = mosaic[r:r + 256]
            c = px.astype(np.int32) >> 2
            k = c[..., 0] * 4096 + c[..., 1] * 64 + c[..., 2]
            dist = off[k]
            # Black is where TerrAdapt has no data (Water, the darkest class, is 0/33/57).
            empty = px.max(-1) < 20
            cls[r:r + 256] = np.where(empty, 0, near[k])
            far += int(((dist > FAR) & ~empty).sum())
            filled += int((~empty).sum())

        img = Image.fromarray(cls, mode="P")
        img.putpalette(pal)
        ulx, uly = merc(x0, y0, a.zoom)
        lrx, lry = merc(x1 + 1, y1 + 1, a.zoom)
        with tempfile.TemporaryDirectory() as tmp:
            png = os.path.join(tmp, "c.png")
            img.save(png)
            full = os.path.join(tmp, "full.tif")
            subprocess.run(["gdal_translate", "-q", "-a_srs", "EPSG:3857", "-a_ullr", str(ulx), str(uly), str(lrx), str(lry),
                            "-a_nodata", "0", png, full], check=True)
            # Trim the whole-tile margin back to the study area.
            wx, ny = w * math.pi * R / 180, R * math.asinh(math.tan(math.radians(n)))
            ex, sy = e * math.pi * R / 180, R * math.asinh(math.tan(math.radians(s_)))
            subprocess.run(["gdal_translate", "-q", "-projwin", str(wx), str(ny), str(ex), str(sy),
                            "-co", "COMPRESS=DEFLATE", "-co", "TILED=YES", full, tif], check=True)
        print(year, f"{far / max(filled, 1):.1%} doubtful", tif, flush=True)


if __name__ == "__main__":
    main()
