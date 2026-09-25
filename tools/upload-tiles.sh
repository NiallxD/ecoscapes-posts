#!/usr/bin/env bash
# The map files, up to the R2 bucket behind tiles.niallbell.com: too big for
# GitHub Pages (a 1 GB site, 100 MB a file), and edge-cached near whoever is
# looking. Each file keeps its path under public/tiles/ as its key --
# public/tiles/dst/x.pmtiles is tiles.niallbell.com/dst/x.pmtiles, which is
# what tile() in src/lib/paths.ts asks for when PUBLIC_TILES_BASE is set.
#
#   tools/upload-tiles.sh                     # every map file not already up
#                                             # (.pmtiles, and the planning map's
#                                             # .sample.webp area samples)
#   tools/upload-tiles.sh dst/foo.pmtiles     # just these (paths under public/tiles)
#   FORCE=1 tools/upload-tiles.sh             # everything, changed or not
#
# Writes tools/tiles-manifest.json (path -> content hash) -- commit it: the
# service worker's tile cache is versioned from it (tools/sw-version.mjs), so
# a changed file reaches people who already have the old one cached. A file is
# skipped when its hash matches the manifest. After replacing a file, purge
# tiles.niallbell.com in the Cloudflare dashboard so the edge drops the old one.
#
# Needs wrangler, logged in (npx wrangler login). CORS: tools/r2-cors.json,
# applied once with
#   npx wrangler r2 bucket cors set ecoscapes-maps --file tools/r2-cors.json
set -euo pipefail

BUCKET="${BUCKET:-ecoscapes-maps}"
ROOT="public/tiles"
MANIFEST="tools/tiles-manifest.json"
[ -f "$MANIFEST" ] || echo '{}' > "$MANIFEST"

if [ $# -gt 0 ]; then files=("$@"); else
  files=(); while IFS= read -r f; do files+=("${f#$ROOT/}"); done < <(find "$ROOT" \( -name '*.pmtiles' -o -name '*.sample.webp' \) | sort)
fi

for rel in "${files[@]}"; do
  hash=$(shasum -a 256 "$ROOT/$rel" | cut -c1-16)
  have=$(node -e 'const m=require("./'"$MANIFEST"'");process.stdout.write(m[process.argv[1]]||"")' "$rel")
  if [ -z "${FORCE:-}" ] && [ "$hash" = "$have" ]; then echo "same   $rel"; continue; fi
  echo "upload $rel ($(du -h "$ROOT/$rel" | cut -f1))"
  case "$rel" in *.webp) type=image/webp ;; *) type=application/octet-stream ;; esac
  npx -y wrangler r2 object put "$BUCKET/$rel" --remote --file "$ROOT/$rel" \
    --content-type "$type" --cache-control 'public, max-age=86400' >/dev/null
  node -e 'const fs=require("fs"),f=process.argv[1],m=JSON.parse(fs.readFileSync(f));m[process.argv[2]]=process.argv[3];
    fs.writeFileSync(f,JSON.stringify(Object.fromEntries(Object.entries(m).sort()),null,2)+"\n")' "$MANIFEST" "$rel" "$hash"
done
echo "done: $(node -e 'console.log(Object.keys(require("./'"$MANIFEST"'")).length)') files in $MANIFEST"
