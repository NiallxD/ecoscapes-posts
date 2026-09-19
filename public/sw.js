/* Hand-written service worker.
 *
 * Kept deliberately small and dependency-free. Two ideas only:
 *   1. Runtime caching, so a page you have already opened keeps working offline.
 *   2. An explicit "cache-location" message, so someone with signal in the car
 *      park can pull a whole location down before walking away from it.
 *
 * Nothing here is required for the site to function -- if registration fails,
 * every view still works over the network.
 */
const VERSION = 'v1';
const SHELL = `ecoscapes-shell-${VERSION}`;
const MEDIA = `ecoscapes-media-${VERSION}`;
const KEEP = new Set([SHELL, MEDIA]);

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
 * Answer a Range request out of the cache as a real 206.
 *
 * This reads the whole cached file into memory to slice it, which is fine for a
 * short time-series clip and is why those should stay small. Anything not
 * cached falls straight through to the network.
 */
async function rangeFromCache(request) {
  const cache = await caches.open(MEDIA);
  const cached = await cache.match(request, MATCH);
  if (!cached) return fetch(request);

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

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Pages: fresh when there is signal, cached when there is not.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
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
  if (isImmutable(url)) {
    event.respondWith(cacheFirst(request, SHELL));
  }
});

/** Tolerant of individual failures: one dead URL must not lose the whole set. */
async function addAllSettled(cacheName, urls) {
  const cache = await caches.open(cacheName);
  const results = await Promise.allSettled(urls.map((u) => cache.add(u)));
  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed) throw new Error(`${failed} of ${urls.length} assets could not be cached`);
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
