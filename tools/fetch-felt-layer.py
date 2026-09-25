#!/usr/bin/env python3
"""
Fetch one Felt raster layer's value tiles and mosaic them into a single-band
Float32 GeoTIFF in EPSG:3857.

Usage:
  tools/fetch-felt-layer.py --id <pipeline_dataset_id> --layers felt_layers_full.json \
    --out /path/to/output.tif --cache /path/to/cache/dir \
    [--bbox -123.9,49.28,-122.05,50.45] [--zoom N] [--max-zoom 13]

Reads the layer's `encoded` (rastertile) URL template and `bands[0]` base/
interval from the given layers JSON (see felt_layers.py / extract_full.py).
Tiles are Felt's 512x512 RGBA PNGs; value = base + (R*65536+G*256+B)*interval,
alpha 0 = nodata. Appends resampling=nearest to get stored values, not a
resampled preview.

Zoom is auto-detected unless --zoom is given: starting at z=9 and stepping up,
it fetches one sample tile per level and measures the median run length of
equal adjacent pixel values along rows (ignoring nodata). A run length near 1
means the tile is resolving real detail (at or finer than native resolution).
Once the run length jumps above ~1.5, the previous zoom was already at (or
past) native resolution, so that's what's used -- deeper zooms would just be
repeating pixels. Every tile fetched is cached on disk under --cache so
reruns don't refetch.
"""
import argparse, json, math, os, subprocess, sys, urllib.request, urllib.error
import numpy as np
from PIL import Image

R = 6378137.0  # Web Mercator sphere radius

def deg2num(lat, lon, z):
    lat_rad = math.radians(lat)
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi) / 2.0 * n
    return x, y

def num2deg_lon(x, z):
    n = 2 ** z
    return x / n * 360.0 - 180.0

def num2deg_lat(y, z):
    n = 2 ** z
    lat_rad = math.atan(math.sinh(math.pi * (1 - 2 * y / n)))
    return math.degrees(lat_rad)

def lonlat_to_merc(lon, lat):
    x = R * math.radians(lon)
    y = R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    return x, y

def fetch_tile(url_tmpl, z, x, y, cache_dir, band_param=None):
    os.makedirs(cache_dir, exist_ok=True)
    path = os.path.join(cache_dir, f"{z}_{x}_{y}.png")
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    url = url_tmpl.replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(y))
    url = url.split("{?")[0]
    qs = "resampling=nearest"
    if band_param:
        qs = f"bands={band_param}&" + qs
    url = f"{url}?{qs}"
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ecoscapes-pipeline/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = resp.read()
            if not data:
                # A 200 with an empty body -- seen at the study area's wider
                # bbox, presumably Felt's way of saying "no data" for some
                # tiles rather than a 404. Same as a 404: no image to decode.
                open(path + ".missing", "w").close()
                return None
            with open(path, "wb") as f:
                f.write(data)
            return path
        except urllib.error.HTTPError as e:
            if e.code == 404:
                # no data at this tile -- write a tiny marker so we don't refetch
                open(path + ".missing", "w").close()
                return None
            if attempt == 3:
                print(f"  ! failed {url}: {e}", file=sys.stderr)
                return None
        except Exception as e:
            if attempt == 3:
                print(f"  ! failed {url}: {e}", file=sys.stderr)
                return None
    return None

def decode(path, base, interval):
    if path is None or not os.path.exists(path) or os.path.getsize(path) == 0:
        return None
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im).astype(np.float64)
    r, g, b, alpha = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    val = base + (r * 65536 + g * 256 + b) * interval
    val = np.where(alpha > 0, val, np.nan)
    return val

def median_run_length(arr):
    """Median length of runs of (nearly) equal adjacent values along rows,
    over valid (non-nan) pixels only."""
    runs = []
    for row in arr:
        valid = row[~np.isnan(row)]
        if valid.size < 4:
            continue
        d = np.diff(valid)
        # run boundaries where value changes meaningfully
        tol = 1e-9 + 1e-6 * (np.nanmax(np.abs(valid)) if valid.size else 1)
        change = np.abs(d) > tol
        idx = np.where(change)[0]
        if idx.size == 0:
            runs.append(valid.size)
            continue
        bounds = np.concatenate(([0], idx + 1, [valid.size]))
        runs.extend(np.diff(bounds).tolist())
    if not runs:
        return 1.0
    return float(np.median(runs))

def pick_center_tile(bbox, z):
    lon_c = (bbox[0] + bbox[2]) / 2
    lat_c = (bbox[1] + bbox[3]) / 2
    x, y = deg2num(lat_c, lon_c, z)
    return int(x), int(y)

def auto_zoom(url_tmpl, band, bbox, cache_dir, zmin=9, zmax=13):
    """Pragmatic native-resolution probe. z11 at Felt's 512px tiles is
    ~25 m/px here, matching most of these datasets' native (often 30 m
    Landsat-derived) resolution -- see the task brief. We test a couple of
    zoom levels' median run length of exactly-equal adjacent pixels (a
    signature of oversampling past native resolution) and nudge off the
    z11 default only when the evidence is fairly clear, to avoid chasing
    quantization ties in smooth continuous data. Capped to [zmin, zmax]."""
    default = min(max(11, zmin), zmax)

    def run_at(z):
        cx, cy = pick_center_tile(bbox, z)
        p = fetch_tile(url_tmpl, z, cx, cy, cache_dir)
        arr = decode(p, band["base"], band["interval"]) if p else None
        if arr is None or np.all(np.isnan(arr)):
            return None
        r = median_run_length(arr)
        print(f"  zoom {z}: median run length {r:.2f}", file=sys.stderr)
        return r

    run_coarse = run_at(min(10, zmax))
    if run_coarse is not None and run_coarse >= 4:
        # very coarse native data (e.g. ~1km rasters) -- back off further
        return max(zmin, min(10, zmax) - 2)

    run_fine = run_at(min(12, zmax)) if zmax >= 12 else None
    if run_fine is not None and run_fine <= 1.3:
        return min(12, zmax)

    return default

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", required=True)
    ap.add_argument("--layers", default="archive/felt_layers_full.json")
    ap.add_argument("--out", required=True)
    ap.add_argument("--cache", required=True)
    ap.add_argument("--bbox", default="-123.9,49.28,-122.05,50.45")
    ap.add_argument("--zoom", type=int, default=None)
    ap.add_argument("--zmin", type=int, default=9)
    ap.add_argument("--zmax", type=int, default=13)
    args = ap.parse_args()

    layers = json.load(open(args.layers))
    L = layers[args.id]
    band = L["bands"][0]
    url_tmpl = L["encoded"]
    bbox = [float(v) for v in args.bbox.split(",")]
    cache_dir = os.path.join(args.cache, args.id)

    z = args.zoom
    if z is None:
        z = auto_zoom(url_tmpl, band, bbox, cache_dir, args.zmin, args.zmax)
    print(f"[{L['name']}] using zoom {z}", file=sys.stderr)

    x0f, y0f = deg2num(bbox[3], bbox[0], z)  # top-left (max lat, min lon)
    x1f, y1f = deg2num(bbox[1], bbox[2], z)  # bottom-right (min lat, max lon)
    x0, x1 = int(math.floor(x0f)), int(math.floor(x1f))
    y0, y1 = int(math.floor(y0f)), int(math.floor(y1f))

    ntx = x1 - x0 + 1
    nty = y1 - y0 + 1
    tile_px = 512
    mosaic = np.full((nty * tile_px, ntx * tile_px), np.nan, dtype=np.float32)

    print(f"  fetching {ntx}x{nty} = {ntx*nty} tiles at z{z}", file=sys.stderr)
    import concurrent.futures as cf
    jobs = [(tx, ty) for ty in range(y0, y1 + 1) for tx in range(x0, x1 + 1)]

    def work(job):
        tx, ty = job
        p = fetch_tile(url_tmpl, z, tx, ty, cache_dir)
        return tx, ty, p

    results = {}
    with cf.ThreadPoolExecutor(max_workers=6) as ex:
        for tx, ty, p in ex.map(work, jobs):
            results[(tx, ty)] = p

    for (tx, ty), p in results.items():
        arr = decode(p, band["base"], band["interval"])
        if arr is None:
            continue
        px = (tx - x0) * tile_px
        py = (ty - y0) * tile_px
        mosaic[py:py + tile_px, px:px + tile_px] = arr

    # Georeference: tile (x0,y0) top-left corner in lon/lat -> Web Mercator
    ulx, uly = lonlat_to_merc(num2deg_lon(x0, z), num2deg_lat(y0, z))
    lrx, lry = lonlat_to_merc(num2deg_lon(x1 + 1, z), num2deg_lat(y1 + 1, z))

    nodata_val = -9999.0
    filled = np.where(np.isnan(mosaic), nodata_val, mosaic).astype(np.float32)
    h, w = filled.shape

    # Write via a raw binary + a VRT header (no python gdal bindings here,
    # but the raw driver via VRT is reliable across GDAL CLI builds).
    bin_path = args.out + ".raw.bin"
    filled.tofile(bin_path)
    vrt_path = args.out + ".vrt"
    vrt = f'''<VRTDataset rasterXSize="{w}" rasterYSize="{h}">
  <SRS>EPSG:3857</SRS>
  <GeoTransform>{ulx}, {(lrx-ulx)/w}, 0, {uly}, 0, {(lry-uly)/h}</GeoTransform>
  <VRTRasterBand dataType="Float32" band="1" subClass="VRTRawRasterBand">
    <NoDataValue>{nodata_val}</NoDataValue>
    <SourceFilename relativeToVRT="1">{os.path.basename(bin_path)}</SourceFilename>
    <ImageOffset>0</ImageOffset>
    <PixelOffset>4</PixelOffset>
    <LineOffset>{4*w}</LineOffset>
    <ByteOrder>LSB</ByteOrder>
  </VRTRasterBand>
</VRTDataset>'''
    open(vrt_path, "w").write(vrt)
    subprocess.run(["gdal_translate", "-q", "-of", "GTiff", "-co", "COMPRESS=DEFLATE", vrt_path, args.out], check=True)

    for p in (bin_path, vrt_path):
        try: os.remove(p)
        except OSError: pass

    print(f"  wrote {args.out} ({w}x{h}) zoom={z}", file=sys.stderr)
    print(json.dumps({"id": args.id, "zoom": z, "width": w, "height": h, "out": args.out}))

if __name__ == "__main__":
    main()
