/* Hand-written service worker.
 *
 * Kept deliberately small and dependency-free. Three ideas only:
 *   1. Runtime caching, so a page you have already opened keeps working offline.
 *   2. An explicit "cache-location" message, so someone with signal in the car
 *      park can pull a whole location down before walking away from it.
 *   3. The map's tiles kept as they are fetched, so the part of the map you have
 *      looked at still draws when the signal goes.
 *
 * Nothing here is required for the site to function -- if registration fails,
 * every view still works over the network.
 */
// Stamped at build time by tools/sw-version.mjs -- VERSION from a hash of the
// media, TILES_VERSION from a hash of the map's tiles, so a new basemap does not
// throw away everyone's photographs and clips, nor a new clip their map.
// Changing them by hand is not needed and will be overwritten in the build. The
// literals here are what dev and an unstamped build fall back to.
const VERSION = 'v1';
const TILES_VERSION = 't1';
// Where the map files are when not on this site (the R2 bucket), or '' --
// stamped from PUBLIC_TILES_BASE with the versions.
const TILES_ORIGIN = '';
const SHELL = `ecoscapes-shell-${VERSION}`;
const MEDIA = `ecoscapes-media-${VERSION}`;
const TILES = `ecoscapes-tiles-${TILES_VERSION}`;
const KEEP = new Set([SHELL, MEDIA, TILES]);

// Tiles are small ranges of a few large files: kept up to this many, oldest
// dropped first. A few thousand is a good walk's worth of map at every zoom,
// tens of MB -- well inside what a phone gives a site.
const MAX_TILES = 4000;

// Derived from the worker's own location so the same file works at a domain
// root and under a GitHub Pages project path.
const BASE = new URL('./', self.location).pathname;
const OFFLINE = `${BASE}offline.html`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll([OFFLINE, BASE])).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Build hashes make these immutable, so a hit is always safe to serve. */
const isImmutable = (url) => url.pathname.startsWith(`${BASE}_astro/`);
const isMedia = (url) => url.pathname.startsWith(`${BASE}media/`);
const isTiles = (url) => url.pathname.startsWith(`${BASE}tiles/`);

// Servers vary these responses on Origin, and a module-script request carries an
// Origin header while the plain Request that filled the cache does not -- so a
// strict match misses every time. These are content-hashed, same-origin files,
// so Origin cannot change the bytes and ignoring Vary is safe.
const MATCH = { ignoreVary: true };

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, MATCH);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

/**
 * A media file, whole, into the cache -- once. The clip's own playback and the
 * offline copy both come through here, so whichever asks first starts the one
 * download and the other waits on it: nothing is fetched twice, which matters
 * where the signal is poor.
 */
const filling = new Map();
function fillMedia(url) {
  const key = new URL(url, self.location.href).href;
  if (!filling.has(key)) {
    filling.set(
      key,
      (async () => {
        const cache = await caches.open(MEDIA);
        if (await cache.match(key, MATCH)) return;
        const res = await fetch(key);
        if (!res.ok) throw new Error(`${res.status} ${key}`);
        await cache.put(key, res);
      })().finally(() => filling.delete(key)),
    );
  }
  return filling.get(key);
}

/**
 * Answer a Range request out of the cache as a real 206.
 *
 * Always out of the cache, filling it first if need be. A clip whose first bytes
 * came from the network and the rest from here is one Chrome refuses to play
 * ("data source error"), so a clip is never split between the two: the first
 * request waits for the whole file, and every one after is sliced from it. This
 * reads the file into memory to slice it, which is fine for a short clip and is
 * why those should stay small.
 */
async function rangeFromCache(request) {
  const cache = await caches.open(MEDIA);
  let cached = await cache.match(request, MATCH);
  if (!cached) {
    try {
      await fillMedia(request.url);
      cached = await cache.match(request, MATCH);
    } catch {
      /* could not fetch it whole: let the network answer as it would have */
    }
    if (!cached) return fetch(request);
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
  if (!match) return cached;

  const body = await cached.arrayBuffer();
  const total = body.byteLength;
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;

  if (!(start >= 0 && start <= end && end < total)) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${total}` },
    });
  }

  return new Response(body.slice(start, end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': cached.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

/**
 * The map's tiles. PMTiles asks for byte ranges of a few big files, and the
 * Cache API keys on the URL alone, so each range is kept under its own key --
 * the URL with the range added. The same range always asks for the same bytes
 * while the file is unchanged, and TILES_VERSION changes when it does.
 */
let sinceTrim = 0;
async function tile(request) {
  const cache = await caches.open(TILES);
  const range = request.headers.get('range');
  const key = range ? `${request.url.split('?')[0]}?range=${encodeURIComponent(range)}` : request;
  const hit = await cache.match(key, MATCH);
  // Kept as a 200 -- the Cache API refuses to store a 206 -- and handed back
  // as the 206 it was, headers and all, so PMTiles cannot tell the difference.
  if (hit) return new Response(hit.body, { status: range ? 206 : 200, headers: hit.headers });
  const res = await fetch(request);
  if (res.ok) {
    const body = await res.clone().arrayBuffer();
    await cache.put(key, new Response(body, { status: 200, headers: res.headers }));
    if (++sinceTrim >= 100) {
      sinceTrim = 0;
      trimTiles(cache);
    }
  }
  return res;
}
async function trimTiles(cache) {
  const keys = await cache.keys();
  // Oldest first: the Cache API returns keys in the order they were added.
  const over = keys.length - MAX_TILES * 0.9;
  if (keys.length > MAX_TILES) await Promise.all(keys.slice(0, over).map((k) => cache.delete(k)));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // The map files from the tile host: kept like the site's own.
  if (TILES_ORIGIN && url.origin === TILES_ORIGIN) {
    event.respondWith(tile(request));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Pages: fresh when there is signal, cached when there is not. Fresh means
  // asking the server every time: GitHub Pages sends max-age=600, and a plain
  // fetch would take the browser's copy for ten minutes after a deploy. With
  // no-cache an unchanged page is a small 304, not a download.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' })
        .then((res) => {
          // An address missing its trailing slash is redirected by the host. A
          // followed redirect cannot be handed back for a navigation -- the
          // browser fails it -- so it is sent the redirect to follow itself.
          if (res.redirected) return Response.redirect(res.url, 302);
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(request, copy));
          return res;
        })
        .catch(async () => (await caches.match(request, MATCH)) || (await caches.match(OFFLINE, MATCH))),
    );
    return;
  }

  if (isMedia(url)) {
    // Video elements ask for byte ranges. The Cache API only ever stores and
    // returns whole responses, so handing a 200 back to a Range request leaves
    // Safari unable to play or seek. Serve the slice ourselves instead.
    if (request.headers.has('range')) {
      event.respondWith(rangeFromCache(request));
      return;
    }
    event.respondWith(cacheFirst(request, MEDIA));
    return;
  }
  if (isTiles(url)) {
    event.respondWith(tile(request));
    return;
  }
  if (isImmutable(url)) {
    event.respondWith(cacheFirst(request, SHELL));
  }
});

/**
 * Tolerant of individual failures: one dead URL must not lose the whole set.
 *
 * Anything already held is skipped rather than re-fetched. The page now offers
 * its whole location on every load instead of behind a button, so without this
 * a return visit would pull several MB down again for nothing.
 */
async function addAllSettled(cacheName, urls) {
  const cache = await caches.open(cacheName);
  const held = await Promise.all(urls.map((u) => cache.match(u, MATCH)));
  const missing = urls.filter((_, i) => !held[i]);
  if (!missing.length) return;
  // Media through the shared fill, so a clip already downloading for playback
  // is waited on rather than fetched a second time.
  const results = await Promise.allSettled(
    missing.map((u) => (cacheName === MEDIA ? fillMedia(u) : cache.add(u))),
  );
  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed) throw new Error(`${failed} of ${missing.length} assets could not be cached`);
}

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data) return;

  // The page telling us which of its own build assets it loaded.
  if (data.type === 'cache-page') {
    event.waitUntil(addAllSettled(SHELL, data.assets || []).catch(() => {}));
    return;
  }

  if (data.type !== 'cache-location') return;
  const reply = event.ports?.[0];

  event.waitUntil(
    (async () => {
      try {
        await addAllSettled(MEDIA, data.assets || []);
        if (data.page) await addAllSettled(SHELL, [data.page]);
        reply?.postMessage({ ok: true });
      } catch (err) {
        reply?.postMessage({ ok: false, error: String(err) });
      }
    })(),
  );
});
