#!/usr/bin/env python3
"""
The map files, up to the R2 bucket behind tiles.niallbell.com: too big for
GitHub Pages (a 1 GB site, 100 MB a file), and edge-cached near whoever is
looking. Each file keeps its path under public/tiles/ as its key --
public/tiles/dst/x.pmtiles is tiles.niallbell.com/dst/x.pmtiles, which is what
tile() in shared/lib/paths.ts asks for when PUBLIC_TILES_BASE is set.

  shared/tools/upload-tiles.py                  # every map file not already up
                                         # (.pmtiles, and the Data Sandbox's
                                         # .sample.webp area samples)
  shared/tools/upload-tiles.py dst/foo.pmtiles  # just these (paths under public/tiles)
  shared/tools/upload-tiles.py --force          # everything, changed or not

Writes shared/tools/tiles-manifest.json (path -> content hash) -- commit it: the
service worker's tile cache is versioned from it (shared/tools/sw-version.mjs), so a
changed file reaches people who already have the old one cached. A file is
skipped when its hash matches the manifest. After replacing a file, purge
tiles.niallbell.com in the Cloudflare dashboard so the edge drops the old one.

Needs wrangler, logged in (npx wrangler login). CORS: shared/tools/r2-cors.json,
applied once with
  npx wrangler r2 bucket cors set ecoscapes-maps --file shared/tools/r2-cors.json
"""
import argparse, hashlib, json, os, subprocess
from pathlib import Path

ROOT = Path("public/tiles")
MANIFEST = Path("shared/tools/tiles-manifest.json")


def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="*", help="paths under public/tiles (default: every map file)")
    ap.add_argument("--force", action="store_true", help="upload even when unchanged")
    ap.add_argument("--bucket", default=os.environ.get("BUCKET", "ecoscapes-maps"))
    a = ap.parse_args()

    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    files = a.files or sorted(
        p.relative_to(ROOT).as_posix() for p in ROOT.rglob("*")
        if p.name.endswith((".pmtiles", ".sample.webp"))
    )
    for rel in files:
        path = ROOT / rel
        h = digest(path)
        if not a.force and manifest.get(rel) == h:
            print(f"same   {rel}")
            continue
        print(f"upload {rel} ({path.stat().st_size / 1e6:.1f} MB)")
        subprocess.run([
            "npx", "-y", "wrangler", "r2", "object", "put", f"{a.bucket}/{rel}", "--remote",
            "--file", str(path), "--content-type", "image/webp" if rel.endswith(".webp") else "application/octet-stream",
            "--cache-control", "public, max-age=86400",
        ], check=True, stdout=subprocess.DEVNULL)
        manifest[rel] = h
        # Written after every file, so a run cut short still records what went up.
        MANIFEST.write_text(json.dumps(dict(sorted(manifest.items())), indent=2) + "\n")
    print(f"done: {len(manifest)} files in {MANIFEST}")


if __name__ == "__main__":
    main()
