# EcoScapes Field Posts

A QR code on a post in the landscape opens one page with three views of that
place: the panorama you are standing in, the same ground seen from orbit since
1984, and a way to add your own photograph to the record.

Static Astro site. No database, no server, no backend. Installable as a PWA and
works offline once a location has been opened or explicitly saved.

## Running it

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # -> dist/
npm run preview  # serves dist/ (use this to test the service worker)
```

The service worker only registers over HTTPS or on localhost, so offline
behaviour must be tested against `npm run preview`, not `npm run dev`.

## Adding a location

One markdown file plus one media folder. No admin UI needed.

```
src/content/locations/<slug>.md      # the content
public/media/<slug>/pano.jpg         # 4096x2048 equirectangular
public/media/<slug>/pano-card.jpg    # 1200x600 crop for the index
public/media/<slug>/frames/<year>.webp
```

The page is then at `/p/<slug>/`, which is what the QR code encodes. The schema
in `src/content.config.ts` is the contract; the build fails loudly if a file
does not match it.

### Preparing the panorama

Source 360s come off the stitcher around 7500x3750 and 4-7 MB, which is far too
heavy for a trailhead. This resizes and strips them:

```bash
tools/prepare-pano.sh path/to/source_pano.jpg <slug>
```

4096x2048 is the practical ceiling for a phone sphere and stays inside the max
texture size of older GPUs. Expect roughly 1.2 MB out.

### Preparing the time series

Export the years you want from the TerrAdapt dashboard and drop them in as
`frames/<year>.webp`, then list those years in the location's frontmatter.

They are an image sequence rather than a video on purpose: ~40 frames at ~80 KB
scrub frame-perfectly with no codec, autoplay or seek-precision problems, and
the service worker can cache them like any other file.

`tools/make-demo-assets.py` generates the synthetic stand-in frames currently in
the repo. Delete it once real exports land.

## The three views

- **Panorama** — Photo Sphere Viewer, dynamically imported only when the panel
  approaches the viewport, so three.js is not in the initial payload. Touch pan
  always; gyroscope behind a button, because iOS will not grant motion access
  outside a user gesture.
- **Time series** — every frame is in the DOM, scrubbing is an opacity swap.
- **Capture** — `<input capture="environment">` opens the OS camera, then hands
  the file to `navigator.share()`. See below.

## What is not built yet

**Photo submissions do not upload anywhere.** Sharing hands the file to the
phone's share sheet so it can go to email or Instagram. A static host cannot
accept uploads; the seam for a real endpoint is the share handler in
`src/components/Capture.astro`.

The obvious next step is a Cloudflare Worker issuing presigned R2 uploads, at
which point the ghost-overlay alignment feature (showing the previous
submission while framing the next) becomes worth building — that, rather than
the capture itself, is what makes repeat photography work.

## Offline

`public/sw.js` is hand-written, ~120 lines, no Workbox. Two behaviours:

- Pages are network-first and fall back to cache, then to `offline.html`.
  Media and build-hashed assets are cache-first.
- **Save for offline** on a location page tells the worker to pull that
  location's panorama and frames down in one go — for tapping in the car park
  before walking out of signal.

On a first visit the CSS and JS are already in flight before the worker controls
the page, so its fetch handler never sees them. The page therefore reports what
it actually loaded (via `PerformanceObserver`) and the worker caches that. Cache
lookups pass `ignoreVary: true`, because a `Vary: Origin` response will
otherwise never match the request that filled the cache.

Everything degrades: if registration fails, every view still works online.

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` builds and deploys on push to `main`. Enable
Pages with source "GitHub Actions". `PUBLIC_BASE_PATH` and `PUBLIC_SITE_URL`
come from `actions/configure-pages`, so it works at a project path or a custom
domain without edits.

Two things to know before committing to Pages:

- **Git LFS does not work on Pages** — it serves the pointer file, not the
  asset. Do not LFS the panoramas.
- **Binaries in git history are permanent.** At ~1.5 MB per location this is
  fine for a while; re-exports accumulate. When it starts to hurt, move
  `public/media/` to R2 or a separate assets repo rather than rewriting history.

**Use a custom domain.** QR codes are printed on physical posts and outlive
every hosting decision, so they should point at a domain you control the DNS
for, never at `username.github.io`.
