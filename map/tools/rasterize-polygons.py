#!/usr/bin/env python3
"""
Polygons (a GeoPackage, shapefile, GeoJSON...) burned into a single-colour
raster the map can take as a layer, via tools/prepare-layer.py.

  map/tools/rasterize-polygons.py <input> <output.tif> <r,g,b> [--zoom 13]

  map/tools/rasterize-polygons.py habitat.gpkg /tmp/habitat.tif 112,168,0
  map/tools/prepare-layer.py /tmp/habitat.tif habitat-cores

Burned straight onto the web map's own pixel grid at --zoom (default 13, about
19 m a pixel), so tiling it afterwards is a copy rather than a resample and
the edges stay as crisp as the zoom allows. Every polygon in the first layer
is burned; outside them is transparent.

Needs GDAL (brew install gdal).
"""
import argparse, subprocess, tempfile

# Web Mercator's equator, in metres.
EQUATOR = 40075016.68557849


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("rgb", help="the colour, as r,g,b")
    ap.add_argument("--zoom", type=int, default=13)
    a = ap.parse_args()
    r, g, b = a.rgb.split(",")
    res = str(EQUATOR / 256 / 2**a.zoom)  # metres a pixel at this zoom

    with tempfile.TemporaryDirectory() as tmp:
        merc = f"{tmp}/merc.gpkg"
        subprocess.run(["ogr2ogr", "-q", "-t_srs", "EPSG:3857", "-nlt", "PROMOTE_TO_MULTI", merc, a.input], check=True)
        # ogrinfo -q lists layers as "1: name (Multi Polygon)".
        first = subprocess.check_output(["ogrinfo", "-q", merc], text=True).splitlines()[0]
        layer = first.split(": ", 1)[1].split(" ")[0]
        subprocess.run([
            "gdal_rasterize", "-q", "-l", layer, "-tr", res, res, "-tap", "-ot", "Byte", "-a_nodata", "none",
            "-init", "0", "-burn", r, "-burn", g, "-burn", b, "-burn", "255", "-co", "COMPRESS=DEFLATE",
            "-co", "PHOTOMETRIC=RGB", "-co", "ALPHA=YES", merc, a.output,
        ], check=True)
    size = next(l for l in subprocess.check_output(["gdalinfo", a.output], text=True).splitlines() if l.startswith("Size is"))
    print(f"{a.output}: {size}")


if __name__ == "__main__":
    main()
