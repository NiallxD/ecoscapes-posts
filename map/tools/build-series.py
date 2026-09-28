#!/usr/bin/env python3
"""
A time series' yearly rasters to map layers: one PMTiles file a year.

  map/tools/build-series.py landcover
  map/tools/build-series.py landcover --years 1984 2024
  map/tools/build-series.py human-footprint

Reads what map/tools/fetch-terradapt-series.py wrote (<cache>/<layer>/<layer>_<year>.tif),
colours each year with its colour file in map/tools/styles/ecoscapes/, and writes
public/tiles/ecoscapes/<id>/<year>.pmtiles through prepare-layer.py. Skips a
year already built. Upload them with shared/tools/upload-tiles.py as any other.
"""
import argparse, glob, json, os, re, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

SERIES = {
    # id: the TerrAdapt layer fetch-terradapt-series.py saved it under, and its colours.
    "landcover": ("landcover_class", "landcover-series.txt"),
    # The same 1-100 values as the map's Cumulative human impacts, so its classes.
    "human-footprint": ("human_footprint", "cumulative-impacts.txt"),
    # No colours of the map's own to match: TerrAdapt's, from the range.json or
    # classes.json the fetch left beside the years (terradapt_colours).
    "ecosystem-resilience-series": ("ecosystem_resilience", None),
    "ecosystem-services-series": ("ecosystem_services_value", None),
    "ecosystem-change": ("ecosystem_change", None),
    "forest-habitat": ("forest_ecosystem_habitat", None),
    "forest-permeability": ("forest_ecosystem_permeability", None),
    "mean-annual-temperature": ("mat_30yr_normal", None),
    "forest-disturbance": ("disturbance_class", None),
}
# Series drawn only on land: TerrAdapt gives them values over the sea and
# lakes too, where the map's own layer is clear. Water is taken from that
# year's land cover (class 1), which is on the same grid.
LAND_ONLY = {"human-footprint"}


def hex_rgb(c):
    if len(c) == 4:
        c = "#" + "".join(ch * 2 for ch in c[1:])
    return " ".join(str(int(c[i:i + 2], 16)) for i in (1, 3, 5))


def terradapt_colours(folder, path):
    """A gdaldem colour file drawing a layer in TerrAdapt's colours, 0 left clear.
    Classes are one colour each. A ramp is cut into one flat band per stop,
    as the map's other ramps are: drawn smooth, the fetch's JPEG noise makes
    every pixel a colour of its own, and a year came to 36 MB, not 6."""
    lines = ["nv 0 0 0 0", "0 0 0 0 0"]
    if os.path.exists(os.path.join(folder, "classes.json")):
        for c in json.load(open(os.path.join(folder, "classes.json"))):
            lines += [f"{c['value']} {hex_rgb(c['color'])} 255", f"{c['value']}.000001 {hex_rgb(c['color'])} 255"]
    else:
        r = json.load(open(os.path.join(folder, "range.json")))
        lo, hi = r.get("stored_as", [r["min"], r["max"]])
        n = len(r["stops"])
        for k, c in enumerate(r["stops"]):
            a, b = lo + (hi - lo) * k / n, lo + (hi - lo) * (k + 1) / n
            lines += [f"{a + 1e-4 if k else lo - 0.5:.4f} {hex_rgb(c)} 255", f"{b:.4f} {hex_rgb(c)} 255"]
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")


def land_only(tif, year, cache, tmp):
    water = os.path.join(cache, "landcover_class", f"landcover_class_{year}.tif")
    if not os.path.exists(water):
        sys.exit(f"{year}: no land cover to take the water from ({water})")
    im = Image.open(tif)
    v = np.asarray(im).copy()
    v[np.asarray(Image.open(water)) == 1] = 0
    out = Image.fromarray(v, mode="P")
    out.putpalette(im.getpalette())
    png = os.path.join(tmp, f"{year}.png")
    out.save(png)
    info = json.loads(subprocess.check_output(["gdalinfo", "-json", tif]))
    (w, n), (e, s) = info["cornerCoordinates"]["upperLeft"], info["cornerCoordinates"]["lowerRight"]
    masked = os.path.join(tmp, f"{year}.tif")
    subprocess.run(["gdal_translate", "-q", "-a_srs", "EPSG:3857", "-a_ullr", str(w), str(n), str(e), str(s),
                    "-a_nodata", "0", png, masked], check=True)
    return masked


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("id", choices=SERIES)
    ap.add_argument("--years", nargs="*", type=int)
    ap.add_argument("--cache", default=os.path.expanduser("~/.cache/ecoscapes-terradapt"))
    ap.add_argument("--jobs", type=int, default=3)
    a = ap.parse_args()

    layer, colours = SERIES[a.id]
    if colours:
        colours = f"map/tools/styles/ecoscapes/{colours}"
    else:
        colours = os.path.join(tempfile.mkdtemp(), f"{a.id}.txt")
        terradapt_colours(os.path.join(a.cache, layer), colours)
    out = f"public/tiles/ecoscapes/{a.id}"
    todo = []
    for tif in sorted(glob.glob(os.path.join(a.cache, layer, f"{layer}_*.tif"))):
        year = int(re.search(r"_(\d{4})\.tif$", tif).group(1))
        if (a.years and year not in a.years) or os.path.exists(os.path.join(out, f"{year}.pmtiles")):
            continue
        todo.append((year, tif))
    if not todo:
        sys.exit("nothing to build")

    def build(job):
        year, tif = job
        with tempfile.TemporaryDirectory() as tmp:
            if a.id in LAND_ONLY:
                tif = land_only(tif, year, a.cache, tmp)
            subprocess.run([sys.executable, "map/tools/prepare-layer.py", tif, str(year), "--colours", colours, "--out", out],
                           check=True, stdout=subprocess.DEVNULL)
        return year

    with ThreadPoolExecutor(a.jobs) as pool:
        for year in pool.map(build, todo):
            print(year, os.path.join(out, f"{year}.pmtiles"), flush=True)


if __name__ == "__main__":
    main()
