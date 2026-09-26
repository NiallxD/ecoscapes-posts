#!/usr/bin/env python3
"""
One coloured map layer, as a single PMTiles file /map/ can draw.

  map/tools/prepare-layer.py <input.tif> <id> [--resampling near|bilinear]
                         [--colours styles/x.txt] [--out DIR] [--format webp|png]

  map/tools/prepare-layer.py ~/Downloads/landcover-2024.tif landcover-2024
  map/tools/prepare-layer.py ~/Downloads/canopy.tif canopy --resampling bilinear
  map/tools/prepare-layer.py felt.tif cumulative-impacts \
    --colours map/tools/styles/ecoscapes/cumulative-impacts.txt --out public/tiles/ecoscapes

Writes <out>/<id>.pmtiles (default public/tiles/layers). map/tools/build-map.py
runs this for every portal layer.

The input has to carry its own colours -- RGB(A), or a single band with a
colour table (which is what a classed map exported from GIS usually is) -- or
be given a colour file, and it is coloured here with gdaldem color-relief (see
map/tools/styles/ecoscapes/ for the format; map/tools/gen-style.py writes them). A
bare single band of numbers with neither has nothing to draw with.

Resampling defaults to nearest, which keeps classes crisp and never invents a
colour that is not in the legend -- right for landcover. Pass bilinear for
continuous surfaces (elevation, canopy height, probabilities).

The deepest zoom is the one whose resolution best matches the input's own
pixels: z12 for TerrAdapt's 30 m Landsat grid at this latitude. GDAL works it
out as a fraction, since reprojecting to Web Mercator almost never lands a
pixel exactly on a zoom's resolution; ZOOM_LEVEL_STRATEGY=AUTO rounds it to
the nearest zoom. (UPPER, which always rounds up, bought a whole extra level
of pure upsampling -- half of every file -- for detail the data never had. The
map enlarges past the deepest zoom by itself.)

Tiles come out of GDAL as PNG -- lossless, so a class boundary stays one
colour on each side -- and are re-encoded as lossless WebP (~60% smaller,
identical pixels) unless --format png. GDAL's own WebP writer is lossy only,
so it is never used.

Needs GDAL and the pmtiles CLI (brew install gdal pmtiles), and Pillow.
"""
import argparse, io, os, sqlite3, subprocess, tempfile
from PIL import Image


def run(*cmd):
    subprocess.run(cmd, check=True)


def to_webp(mbtiles):
    """Every tile re-encoded in place as lossless WebP, and the mbtiles's own
    metadata saying so -- pmtiles convert reads that to set the file's tile
    type, which is how the map knows which codec the bytes need. method=6 is
    libwebp's slowest, smallest lossless setting."""
    db = sqlite3.connect(mbtiles)
    rows = db.execute("SELECT zoom_level, tile_column, tile_row, tile_data FROM tiles").fetchall()
    updates = []
    for z, x, y, data in rows:
        buf = io.BytesIO()
        Image.open(io.BytesIO(data)).convert("RGBA").save(buf, "WEBP", lossless=True, method=6)
        updates.append((buf.getvalue(), z, x, y))
    db.executemany("UPDATE tiles SET tile_data = ? WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?", updates)
    db.execute("UPDATE metadata SET value = 'webp' WHERE name = 'format'")
    db.commit()
    db.execute("VACUUM")
    db.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("id")
    ap.add_argument("--resampling", default="near", choices=["near", "bilinear"])
    ap.add_argument("--colours", help="gdaldem color-relief file for a bare single band of values")
    ap.add_argument("--out", default="public/tiles/layers")
    ap.add_argument("--format", default="webp", choices=["webp", "png"])
    a = ap.parse_args()
    near = a.resampling == "near"

    with tempfile.TemporaryDirectory() as tmp:
        src = a.input
        # Bare values are coloured from the colour file, NoData left clear.
        if a.colours:
            colours = os.path.join(tmp, "colours.txt")
            with open(a.colours) as f, open(colours, "w") as g:
                g.writelines(line for line in f if not line.startswith("#"))
            run("gdaldem", "color-relief", "-q", "-alpha", src, colours, f"{tmp}/coloured.tif")
            src = f"{tmp}/coloured.tif"

        # A colour table is expanded to RGBA; anything else is passed through.
        info = subprocess.check_output(["gdalinfo", src], text=True)
        expand = ["-expand", "rgba"] if "Color Table" in info else []
        run("gdal_translate", "-q", *expand, src, f"{tmp}/rgba.tif")

        # Web Mercator, the projection every tile on the map is in. The alpha
        # band warping adds is what keeps the area outside the data clear.
        run("gdalwarp", "-q", "-t_srs", "EPSG:3857", "-r", a.resampling, "-dstalpha",
            "-co", "COMPRESS=DEFLATE", f"{tmp}/rgba.tif", f"{tmp}/merc.tif")

        mb = f"{tmp}/layer.mbtiles"
        run("gdal_translate", "-q", "-of", "MBTILES", "-co", "TILE_FORMAT=PNG",
            "-co", "ZOOM_LEVEL_STRATEGY=AUTO", "-co", f"RESAMPLING={'NEAREST' if near else 'BILINEAR'}",
            f"{tmp}/merc.tif", mb)
        # Lower zooms. Mode for classes: a coarse pixel takes the commonest
        # class under it rather than an average that belongs to no class.
        run("gdaladdo", "-q", "-r", "mode" if near else "average", mb, *[str(2**i) for i in range(1, 11)])

        if a.format == "webp":
            to_webp(mb)

        os.makedirs(a.out, exist_ok=True)
        out = os.path.join(a.out, f"{a.id}.pmtiles")
        subprocess.run(["pmtiles", "convert", mb, out], check=True, stdout=subprocess.DEVNULL)

    show = subprocess.check_output(["pmtiles", "show", out], text=True)
    print("\n".join(l for l in show.splitlines() if l.startswith(("min zoom", "max zoom", "bounds"))))
    print(f"{out}: {os.path.getsize(out) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
