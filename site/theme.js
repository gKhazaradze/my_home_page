// ─── theme.js ───────────────────────────────────────────────────────────
// Light/dark theme toggle — mirrors availability_calendar's toggle. Here light
// is the site's default and dark is opt-in, persisted in localStorage under
// "theme". The saved theme is also applied by a tiny inline <head> script on
// each page so there's no flash before this file loads. Shared by every page
// (index, contact, privacy); it no-ops gracefully where there's no toggle.

(function () {
  const THEME_KEY = "theme";

  function applyTheme(theme) {
    const dark = theme === "dark";
    if (dark) document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    const btn = document.getElementById("theme-toggle");
    if (btn) {
      btn.textContent = dark ? "☀" : "☾";   // shows the mode you'd switch to
      const label = dark ? "Switch to light mode" : "Switch to dark mode";
      btn.title = label;
      btn.setAttribute("aria-label", label);
    }
  }

  function initTheme() {
    let saved;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
    applyTheme(saved === "dark" ? "dark" : "light");
    const btn = document.getElementById("theme-toggle");
    if (btn) btn.onclick = () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
      applyTheme(next);
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initTheme);
  else initTheme();
})();
