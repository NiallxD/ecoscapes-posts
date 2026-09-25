#!/usr/bin/env python3
"""
One layer's *values*, not its colours, as a PMTiles file the decision-support
page (/ecoscapes-dst/) can score in the browser.

  tools/prepare-value-layer.py <input.tif> <id> [--classes] [--lo N --hi N] [--valid MIN MAX]

  tools/prepare-value-layer.py ~/Drive/.../cumulative-impacts_2022.tif cumulative-impacts
  tools/prepare-value-layer.py ~/Drive/.../wildfire-hazardr.tif wildfire-hazard --classes

Writes public/tiles/dst/<id>.pmtiles, with its range and histogram in the
file's metadata (`dst`) and printed as one JSON line, and <id>.sample.webp:
the study area's full-detail values at every SAMPLE-th z12 pixel, one
greyscale lossless image on a grid every layer shares, which the page counts
areas from. tools/build-dst.py runs
this for every layer in tools/dst-catalogue.json.

Each pixel holds one byte: 0 is no data, 1..255 is the value scaled linearly
between lo and hi (the layer's own minimum and maximum unless given), so the
page reads a value back as lo + (byte - 1) / 254 * (hi - lo). 254 steps is far
finer than any threshold anyone sets on these layers, and a byte per pixel is
what keeps the files small. Greyscale, lossless WebP: a value must come back
exactly as written, so nothing lossy anywhere.

The deepest zoom is z12 (TerrAdapt's ~24 m grid at this latitude). Shallower
zooms are made here, not by GDAL's overviews, since they have to be made from
values: a mean of each 2x2 block for a continuous surface, or with --classes
the block's top-left value, which never invents a class that is not there.

Input can be the Drive originals as they are: any CRS, any numeric type, its
own NoData. Needs GDAL and the pmtiles CLI (brew install gdal pmtiles), numpy
and Pillow.
"""
import argparse, io, json, math, os, sqlite3, subprocess, sys, tempfile, warnings
import numpy as np
from PIL import Image

MAXZ, MINZ, TILE = 12, 6, 256
# The study area (src/content/ecoscapes/sea-to-sky.md `limit`).
LIMIT = (-124.69, 48.94, -121.43, 51.26)
HALF = 20037508.342789244
# The area sample: one z12 pixel in every SAMPLE along each axis -- about
# every 100 m here, some six million real 24 m values across the study area.
# Taken, not averaged, so an area counted from it is the area at full detail.
SAMPLE = 4


def tile_x(lon, z):
    return int((lon + 180) / 360 * 2**z)


def tile_y(lat, z):
    r = math.radians(lat)
    return int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * 2**z)


def px(lon, lat):
    """A point as z12 pixel coordinates."""
    r = math.radians(lat)
    n = 2**MAXZ * TILE
    return (lon + 180) / 360 * n, (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n


def sample_grid():
    """The shared sample grid over LIMIT: its z12 pixel origin and size."""
    gx0, gy0 = px(LIMIT[0], LIMIT[3])
    gx1, gy1 = px(LIMIT[2], LIMIT[1])
    gx0, gy0 = int(gx0) // SAMPLE * SAMPLE, int(gy0) // SAMPLE * SAMPLE
    return gx0, gy0, math.ceil((gx1 - gx0) / SAMPLE), math.ceil((gy1 - gy0) / SAMPLE)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("id")
    ap.add_argument("--classes", action="store_true", help="classed/categorical values: no averaging")
    ap.add_argument("--lo", type=float)
    ap.add_argument("--hi", type=float)
    ap.add_argument("--valid", type=float, nargs=2, metavar=("MIN", "MAX"),
                    help="values outside this range are no data (codes such as -1 for water)")
    ap.add_argument("--out", default="public/tiles/dst")
    a = ap.parse_args()

    # Only the part of the study area the layer covers.
    info = json.loads(subprocess.check_output(["gdalinfo", "-json", a.input]))
    ring = info["wgs84Extent"]["coordinates"][0]
    w = max(LIMIT[0], min(p[0] for p in ring))
    e = min(LIMIT[2], max(p[0] for p in ring))
    s = max(LIMIT[1], min(p[1] for p in ring))
    n = min(LIMIT[3], max(p[1] for p in ring))
    # Whole z12 tiles, and a multiple of 2^(MAXZ-MINZ) of them so every
    # shallower level is an exact 2x2 reduction of the one below.
    step = 2 ** (MAXZ - MINZ)
    x0 = tile_x(w, MAXZ) // step * step
    y0 = tile_y(n, MAXZ) // step * step
    x1 = (tile_x(e, MAXZ) // step + 1) * step
    y1 = (tile_y(s, MAXZ) // step + 1) * step
    size = 2 * HALF / 2**MAXZ
    te = [x0 * size - HALF, HALF - y1 * size, x1 * size - HALF, HALF - y0 * size]
    W, H = (x1 - x0) * TILE, (y1 - y0) * TILE

    with tempfile.TemporaryDirectory() as tmp:
        raw = os.path.join(tmp, "v.bin")
        print(f"{a.id}: warping to {W}x{H} at z{MAXZ}...", file=sys.stderr)
        subprocess.check_call([
            "gdalwarp", "-q", "-overwrite", "-t_srs", "EPSG:3857",
            "-te", *map(str, te), "-ts", str(W), str(H),
            "-r", "near", "-ot", "Float32", "-dstnodata", "nan",
            "-of", "ENVI", "-wo", "NUM_THREADS=ALL_CPUS", "-multi", a.input, raw,
        ])
        v = np.fromfile(raw, dtype=np.float32).reshape(H, W)
        if a.valid:
            v[(v < a.valid[0]) | (v > a.valid[1])] = np.nan

        ok = np.isfinite(v)
        if not ok.any():
            sys.exit(f"{a.id}: no data inside the study area")
        lo = a.lo if a.lo is not None else float(v[ok].min())
        hi = a.hi if a.hi is not None else float(v[ok].max())
        span = (hi - lo) or 1.0
        hist, _ = np.histogram(v[ok], bins=64, range=(lo, hi))
        stats = {"id": a.id, "lo": lo, "hi": hi, "classes": a.classes, "hist": hist.tolist()}

        def quantise(arr):
            q = np.zeros(arr.shape, dtype=np.uint8)
            f = np.isfinite(arr)
            q[f] = 1 + np.clip(np.rint((arr[f] - lo) / span * 254), 0, 254).astype(np.uint8)
            return q

        # The area sample, cut from the full-detail values onto the shared grid.
        gx0, gy0, gw, gh = sample_grid()
        cols = gx0 + SAMPLE * np.arange(gw) - x0 * TILE
        rows = gy0 + SAMPLE * np.arange(gh) - y0 * TILE
        ci = np.nonzero((cols >= 0) & (cols < W))[0]
        ri = np.nonzero((rows >= 0) & (rows < H))[0]
        sample = np.zeros((gh, gw), dtype=np.uint8)
        sample[np.ix_(ri, ci)] = quantise(v[np.ix_(rows[ri], cols[ci])])
        stats["sample"] = {"x0": gx0, "y0": gy0, "w": gw, "h": gh, "step": SAMPLE, "z": MAXZ}

        mb = os.path.join(tmp, "v.mbtiles")
        db = sqlite3.connect(mb)
        db.execute("create table metadata (name text, value text)")
        db.execute("create table tiles (zoom_level int, tile_column int, tile_row int, tile_data blob)")
        meta = {
            "name": a.id, "format": "webp", "type": "overlay", "minzoom": MINZ, "maxzoom": MAXZ,
            "bounds": f"{w},{s},{e},{n}",
            "description": f"values: lo={lo} hi={hi}; byte 0 = no data, v = lo + (b-1)/254*(hi-lo)",
            # Read back by tools/build-dst.py, so a layer already built need
            # not be built again to list it.
            "dst": json.dumps(stats),
        }
        db.executemany("insert into metadata values (?, ?)", [(k, str(x)) for k, x in meta.items()])

        count = 0
        level = v
        for z in range(MAXZ, MINZ - 1, -1):
            f = 2 ** (MAXZ - z)
            q = quantise(level)
            for ty in range(q.shape[0] // TILE):
                for tx in range(q.shape[1] // TILE):
                    t = q[ty * TILE:(ty + 1) * TILE, tx * TILE:(tx + 1) * TILE]
                    if not t.any():
                        continue
                    buf = io.BytesIO()
                    Image.fromarray(t, "L").save(buf, "WEBP", lossless=True, method=4)
                    x, y = x0 // f + tx, y0 // f + ty
                    db.execute("insert into tiles values (?, ?, ?, ?)", (z, x, 2**z - 1 - y, buf.getvalue()))
                    count += 1
            if z > MINZ:
                h2, w2 = level.shape[0] // 2, level.shape[1] // 2
                if a.classes:
                    level = level[::2, ::2]
                else:
                    blocks = level.reshape(h2, 2, w2, 2)
                    with warnings.catch_warnings():
                        warnings.simplefilter("ignore", RuntimeWarning)
                        level = np.nanmean(blocks, axis=(1, 3)).astype(np.float32)
        db.commit()
        db.close()

        os.makedirs(a.out, exist_ok=True)
        out = os.path.join(a.out, f"{a.id}.pmtiles")
        subprocess.check_call(["pmtiles", "convert", mb, out], stdout=subprocess.DEVNULL)
        Image.fromarray(sample, "L").save(os.path.join(a.out, f"{a.id}.sample.webp"), "WEBP", lossless=True, method=6)

    print(f"{a.id}: {count} tiles, {os.path.getsize(out) / 1e6:.1f} MB", file=sys.stderr)
    print(json.dumps(stats))


if __name__ == "__main__":
    main()
