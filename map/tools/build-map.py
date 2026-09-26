#!/usr/bin/env python3
"""
Every coloured layer of the EcoScapes map (/map/), from map/tools/map-catalogue.json
to public/tiles/ecoscapes/ (and public/tiles/layers/ for this site's own).

  map/tools/build-map.py                     # build what is missing
  map/tools/build-map.py --force a b         # rebuild layers a and b
  map/tools/build-map.py --all               # rebuild every layer
  map/tools/build-map.py --restyle a         # also rewrite a's colour file from Felt

A catalogue entry names where a layer comes from:

  "source": {"felt": "<pipeline_dataset_id in shared/tools/felt-layers.json>"}
  "source": {"polygons": "<a GeoPackage/shapefile>", "colour": "r,g,b"}

A Felt layer's values are fetched (shared/tools/fetch-felt-layer.py, cached under
--work and shared with dst/tools/build-dst.py, so neither refetches), coloured
with map/tools/styles/ecoscapes/<id>.txt, and tiled by tools/prepare-layer.py. The
colour file is written by map/tools/gen-style.py from the layer's own Felt style
the first time, and kept after that -- it is committed, and can be edited by
hand -- unless --restyle.

A polygon layer is burned to a raster (map/tools/rasterize-polygons.py) and tiled
the same way.

What the page shows for each layer (name, legend, theme, description) lives
in map/content/ecoscapes-layers.json; this only makes the tile files it points to.
"""
import argparse, json, os, subprocess, sys, tempfile

# The study area (map/content/sea-to-sky.md `limit`), as build-dst.py.
BBOX = "-124.69,48.94,-121.43,51.26"
STYLES = "map/tools/styles/ecoscapes"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalogue", default="map/tools/map-catalogue.json")
    ap.add_argument("--work", default=os.path.expanduser("~/.cache/ecoscapes-dst"))
    ap.add_argument("--force", nargs="*", default=[])
    ap.add_argument("--all", action="store_true", help="rebuild every layer")
    ap.add_argument("--restyle", nargs="*", default=[], help="rewrite these layers' colour files from Felt")
    a = ap.parse_args()

    for e in json.load(open(a.catalogue)):
        out_dir = os.path.join("public/tiles", e.get("dir", "ecoscapes"))
        out = os.path.join(out_dir, f"{e['id']}.pmtiles")
        if not (a.all or e["id"] in a.force or e["id"] in a.restyle or not os.path.exists(out)):
            continue
        s = e["source"]
        if "felt" in s:
            tif = fetch_felt(s["felt"], a.work)
            style = os.path.join(STYLES, f"{e['id']}.txt")
            if e["id"] in a.restyle or not os.path.exists(style):
                subprocess.run(["python3", "map/tools/gen-style.py", "--id", s["felt"], "--tif", tif, "--out", style],
                               check=True, stdout=subprocess.DEVNULL)
            subprocess.run(["python3", "map/tools/prepare-layer.py", tif, e["id"], "--colours", style, "--out", out_dir],
                           check=True)
        elif s.get("polygons"):
            with tempfile.TemporaryDirectory() as tmp:
                tif = os.path.join(tmp, "burned.tif")
                subprocess.run(["python3", "map/tools/rasterize-polygons.py", os.path.expanduser(s["polygons"]), tif,
                                s["colour"]], check=True)
                subprocess.run(["python3", "map/tools/prepare-layer.py", tif, e["id"], "--out", out_dir], check=True)
        else:
            print(f"  - {e['id']}: no source file in {a.catalogue}, skipped", file=sys.stderr)


def fetch_felt(fid, work):
    """A Felt layer's values as a GeoTIFF, fetched once and kept (the same
    cache as dst/tools/build-dst.py)."""
    tif = os.path.join(work, "felt", f"{fid}.tif")
    if not os.path.exists(tif):
        os.makedirs(os.path.dirname(tif), exist_ok=True)
        subprocess.run(
            ["python3", "shared/tools/fetch-felt-layer.py", "--id", fid, "--out", tif,
             "--cache", os.path.join(work, "felt", "cache"), f"--bbox={BBOX}"],
            check=True, stdout=subprocess.DEVNULL,
        )
    return tif


if __name__ == "__main__":
    main()
