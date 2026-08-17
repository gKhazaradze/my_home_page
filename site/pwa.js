// ─── pwa.js ─────────────────────────────────────────────────────────────
// Registers the service worker (sw.js). Loaded by every page, right after
// theme.js. Kept separate from theme.js so the toggle keeps working even if
// service workers are unavailable — file:// previews, a browser with them
// switched off, or the `docker run ... file-server` local preview on http,
// where navigator.serviceWorker doesn't exist at all.
//
// Registration waits for `load` so it never competes with the page's own
// first paint for bandwidth.

(function () {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js").catch(function (err) {
      // A failed registration must never break the page — the site is fully
      // functional without it; it only loses offline support.
      console.warn("Service worker registration failed:", err);
    });
  });
})();
