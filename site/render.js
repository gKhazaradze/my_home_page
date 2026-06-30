// Renders the PROJECTS registry (projects.js) into cards. Pure DOM, no deps,
// no build step. The project URL is derived from the page's own host, so the
// domain is never hard-coded: served at example.com, a card with sub:"roadtrip"
// links to https://roadtrip.example.com.

(function () {
  const grid = document.getElementById("projects");
  const empty = document.getElementById("empty");
  const projects = (typeof PROJECTS !== "undefined" && Array.isArray(PROJECTS)) ? PROJECTS : [];

  if (!projects.length) {
    if (empty) empty.hidden = false;
    return;
  }

  // Escape text before putting it in markup (the registry is trusted, but this
  // keeps an stray "<" or "&" in a blurb from breaking the card).
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  for (const p of projects) {
    const href = `${location.protocol}//${p.sub}.${location.host}`;
    const a = document.createElement("a");
    a.className = "card";
    a.href = href;

    const tags = (p.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
    const thumb = p.thumbnail
      ? `<img class="card-thumb" src="${esc(p.thumbnail)}" alt="" loading="lazy" onerror="this.remove()">`
      : "";

    a.innerHTML = `
      ${thumb}
      <div class="card-body">
        <div class="card-head">
          <h3>${esc(p.title)}</h3>
          <span class="badge badge-${esc(p.status)}">${esc(p.status)}</span>
        </div>
        <p class="card-blurb">${esc(p.blurb)}</p>
        <div class="card-tags">${tags}</div>
      </div>`;

    grid.appendChild(a);
  }
})();
