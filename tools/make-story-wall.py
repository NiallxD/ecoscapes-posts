"""Prepare a folder of repeat photographs for the closing panel's wall.

The wall is decoration with a job: it shows that other people have stood here
on other days. So every tile keeps the date it was taken -- read from EXIF, not
from the file's modification time, which is whenever the folder was last copied
about -- and the filename becomes that date, which is how the page labels it
without needing a manifest of its own.

Every tile is cropped to the same shape -- these are repeat photographs of one
view, and letting them vary would suggest a difference that is not there. The
page staggers the columns instead, which breaks the grid without pretending the
pictures are different sizes.

Usage:
  tools/make-story-wall.py <src-dir> <out-dir> [--width N] [--ratio R] [--quality N]
"""
import argparse
from collections import Counter
from pathlib import Path

from PIL import Image, ImageOps


def taken_on(im: Image.Image) -> str | None:
    exif = im.getexif()
    # 0x9003 DateTimeOriginal lives in the Exif sub-IFD; 0x0132 DateTime is the
    # file-level fallback and is usually the same for camera originals.
    raw = exif.get_ifd(0x8769).get(0x9003) or exif.get(0x0132)
    if not raw:
        return None
    date = str(raw).split(" ")[0].replace(":", "-")
    return date if len(date) == 10 else None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--width", type=int, default=360, help="tile width in px")
    ap.add_argument("--ratio", type=float, default=0.75, help="height as a multiple of width")
    ap.add_argument("--quality", type=int, default=72)
    args = ap.parse_args()

    src, out = Path(args.src), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    seen: dict[str, str] = {}
    dupes = Counter()
    for path in sorted(src.iterdir()):
        if path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".heic", ".webp"}:
            continue
        im = Image.open(path)
        date = taken_on(im)
        if not date:
            print(f"  skip {path.name}: no EXIF date")
            continue
        if date in seen:
            # Two photographs from one day: keep the first and say so, rather
            # than silently overwriting one with the other.
            dupes[date] += 1
            print(f"  skip {path.name}: {date} already taken by {seen[date]}")
            continue
        seen[date] = path.name

        # Phones record orientation in EXIF rather than rotating the pixels.
        im = ImageOps.exif_transpose(im).convert("RGB")
        w = args.width
        h = round(w * args.ratio)
        tile = ImageOps.fit(im, (w, h), method=Image.LANCZOS, centering=(0.5, 0.5))
        tile.save(out / f"{date}.webp", "WEBP", quality=args.quality, method=6)
        print(f"  {path.name} -> {date}.webp  {w}x{h}")

    print(f"\n{len(seen)} tiles in {out}")
    print("dates for the frontmatter:")
    for date in sorted(seen):
        print(f"      - {date}")


if __name__ == "__main__":
    main()
