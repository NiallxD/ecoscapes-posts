# EcoScapes Field Posts

A QR code on a post in the landscape opens one page with three views of that
place: the panorama you are standing in, the same ground seen from orbit since
1984, and a way to add your own photograph to the record.

Static Astro site. No database, no server, no backend. Installable as a PWA and
works offline once a location has been opened.

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

#### Choosing the views

A one-line readout sits at the top of the panorama panel, with a crosshair at
the centre of the view marking the point it describes. It is on in dev, and on a
built site with `?aim`:

```
/p/<slug>/?aim
```

```
Y: 150.0  P: -20.0  F: 95.0
```

`Y` is the bearing, `P` the angle above (+) or below (-) the horizon, `F` the
vertical field of view -- the zoom, inverted, so smaller is tighter. Pan, tilt
and pinch to the view you want, then tap the readout: it copies every block the
frontmatter wants, filled from that one view.

```yaml
pano:
  startYaw: 150.0      # bearing the view opens facing
  startPitch: -20.0
hero:
  yaw: 150.0
  pitch: -20.0
  vfov: 75.0
marker:
  yaw: 150.0
  pitch: -20.0
```

The `pano:` values take effect on reload. The `hero:` ones do not: the hero is a
baked JPEG, so it has to be re-rendered (below). All three blocks share a frame,
which is why the readout can fill them from one view.

Leave motion off while reading it -- the gyroscope drives the position, so the
numbers will follow your hand.

#### Calibrating north

Every angle in a location file is a compass bearing, and they are all measured
from `pano.north` -- which says where true north sits on the panorama's own
scale. Until it is set, the bearings are honest but arbitrary: they are measured
from whatever direction the sphere happens to start at.

To calibrate, aim the crosshair at something whose true bearing you know -- a
peak off a map, a road you can shoot with a compass app while standing at the
post -- read the `Y` it prints, and add the difference to `north`:

```
north += Y - (the real bearing)
```

Reload and check: that landmark should now read its real bearing. **Do this
before placing markers.** Moving north afterwards moves every bearing in the
file with it, and each marker has to be re-read.

`declination` matters only for motion, and only on Android, whose absolute
orientation is measured from magnetic north rather than true north. Look the
local value up (about 16 degrees east in Squamish) and put it in; iOS reports a
true heading itself and ignores this.

Once north is set, switching motion on points the sphere at whatever the phone
is pointing at: turn to face the mountain and the mountain is on screen.

#### The hero still

The full-bleed image behind the opening panel is not a crop of the panorama --
it is reprojected out of it through the same pinhole camera the viewer uses, so
it reads as an ordinary photograph rather than a stretched band.

It is generated at build time from the location's own frontmatter, so the angles
are the source of truth and the JPEG is a derived artefact:

```yaml
hero:
  src: /media/<slug>/hero.jpg
  yaw: 155
  pitch: 2.5
  vfov: 95
```

`tools/hero-integration.mjs` runs on `astro:build:start` and, in dev, on every
save of a location's markdown. Change an angle and the still is re-rendered
before the page reloads -- nothing to run by hand.

Rendering is skipped unless something that changes the pixels changed: the
framing, the output size, or the source panorama's mtime and size. That stamp
lives in `.astro/hero/`, never beside the JPEG, because `public/` is copied
verbatim into the build. A normal reload therefore costs a stat and a hash.

`npm run hero` forces the whole set, `npm run hero -- <slug>` one of them.

It is Node throughout (sharp + js-yaml), so CI needs no Python. About 0.4s for a
4096x2048 sphere into 1080x1920.

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
- The cache name carries a version stamped at build time from a hash of the
  media's bytes (`tools/sw-version.mjs`). Media is cache-first at a fixed URL,
  so without this a re-rendered hero or a replaced panorama would never reach
  anyone who had already visited. Hashing contents rather than mtimes keeps a
  routine deploy from throwing away every visitor's cache; changing an asset
  does throw it away, all of it, which is the price of a worker this small.
- The worker does not register in dev, whatever the origin. Phone testing runs
  through an HTTPS tunnel, which is a secure context, so the localhost check is
  not enough on its own -- and cache-first media would hide every regenerated
  asset. Test offline behaviour against `npm run preview`.
- A location page pulls its own media down in full — panorama, series and wall
  — on every visit, once the page has loaded and the main thread is idle.
  Someone at a post has usually walked out of coverage to reach it, and the
  panel they need is the one they have not scrolled to yet, so this does not
  wait to be asked. Roughly 5 MB per location, paid once: the worker skips
  anything already cached, so a return visit fetches nothing.

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
