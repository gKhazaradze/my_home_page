// ─── sw.js ──────────────────────────────────────────────────────────────
// The homepage's service worker. It exists for two reasons:
//
//   1. Installability — Chrome only offers "Install app" (and Bubblewrap only
//      accepts the site as a PWA) if a service worker with a fetch handler is
//      controlling the page.
//   2. Offline — the hub still opens and renders on a dead connection.
//
// Freshness rule for this site: THE NETWORK WINS. There is no build step and
// no content hashing here — a deploy is `git reset --hard` on the server, so
// styles.css and projects.js keep their names while their contents change. A
// cache-first worker would happily serve last week's project registry after a
// push. So HTML/CSS/JS is network-first and the cache is only ever a fallback
// for when the network isn't there.
//
// Images are the one exception: thumbnails are large (roadtrip.png is ~290 KB)
// and change rarely, so they're served from cache immediately and refreshed in
// the background — a new thumbnail shows up on the next visit, which is fine.
//
// Cross-origin requests (Google Fonts, and the project subdomains the cards
// link to) are NOT intercepted. Each project subdomain is its own origin and
// its own app; this worker has no business caching them.

const VERSION = "v1";
const CACHE = `georgelands-${VERSION}`;

// Enough to render the hub with no network at all. Everything else lands in
// the cache as it's fetched.
const PRECACHE = [
  "/",
  "/projects.html",
  "/styles.css",
  "/projects.js",
  "/landing.js",
  "/render.js",
  "/theme.js",
  "/assets/icon-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll is atomic — one 404 would fail the whole install and leave the
      // site uncontrolled, so each entry is added on its own and allowed to
      // fail. A missing precache entry costs offline coverage, not the install.
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only GET is cacheable, and only our own origin is ours to handle.
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.destination === "image") {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(networkFirst(request));
  }
});

// Network wins; the cache is the safety net. A navigation that finds neither
// falls back to the cached homepage so the app opens instead of showing
// Chrome's dinosaur.
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    if (request.mode === "navigate") {
      const home = await cache.match("/");
      if (home) return home;
    }
    throw err;
  }
}

// Serve the cached copy at once, then quietly replace it for next time.
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);

  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => hit);

  return hit || refresh;
}
