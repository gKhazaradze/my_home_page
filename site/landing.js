// ─── landing.js ─────────────────────────────────────────────────────────
// Wires the two sides of the landing page (index.html) to the registry
// (projects.js):
//
//   left  — the calendar: link, copy, status and shot all come from CALENDAR.
//           index.html carries the same copy statically so the panel reads
//           before this file runs; everything here re-syncs it to the registry,
//           which stays the single source of truth.
//   right — a peek at PROJECTS (how many, and the first few names). The panel
//           itself is a plain link to /projects.html, where render.js draws the
//           full cards.
//
// Links are built from the page's own host, so no domain is hard-coded.

(function () {
  const PREVIEW = 3; // names shown on the right before the "+N more" line

  const calendar = (typeof CALENDAR !== "undefined") ? CALENDAR : null;
  const projects = (typeof PROJECTS !== "undefined" && Array.isArray(PROJECTS)) ? PROJECTS : [];

  const subUrl = (sub) => `${location.protocol}//${sub}.${location.host}`;
  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el && text) el.textContent = text;
  };

  // ── Left side: the calendar ──
  const side = document.getElementById("side-calendar");
  if (side && calendar) {
    side.href = subUrl(calendar.sub);
    side.setAttribute("aria-label", `Open ${calendar.title}`);
    setText("calendar-title", calendar.title);
    setText("calendar-blurb", calendar.blurb);

    const badge = document.getElementById("calendar-status");
    if (badge && calendar.status) {
      badge.className = `badge badge-${calendar.status}`;
      badge.textContent = calendar.status;
    }
    const shot = document.getElementById("calendar-shot");
    if (shot && calendar.thumbnail) shot.src = calendar.thumbnail;
  }

  // ── Right side: a peek at the rest ──
  const count = document.getElementById("project-count");
  if (count) {
    count.textContent = projects.length === 1 ? "1 project" : `${projects.length} projects`;
  }

  const list = document.getElementById("project-list");
  if (list) {
    if (!projects.length) {
      list.appendChild(note("Nothing here yet — check back soon."));
    } else {
      for (const p of projects.slice(0, PREVIEW)) list.appendChild(row(p));
      const extra = projects.length - PREVIEW;
      if (extra > 0) list.appendChild(note(`+${extra} more`));
    }
  }

  // One preview row: thumbnail, name + blurb, status badge. Built with DOM calls
  // rather than innerHTML, so registry text needs no escaping.
  function row(p) {
    const li = document.createElement("li");
    li.className = "side-item";

    li.appendChild(thumb(p));

    const body = document.createElement("div");
    body.className = "side-item-body";
    const name = document.createElement("span");
    name.className = "side-item-name";
    name.textContent = p.title;
    body.appendChild(name);
    if (p.blurb) {
      const blurb = document.createElement("span");
      blurb.className = "side-item-blurb";
      blurb.textContent = p.blurb;
      body.appendChild(blurb);
    }
    li.appendChild(body);

    if (p.status) {
      const badge = document.createElement("span");
      badge.className = `badge badge-sm badge-${p.status}`;
      badge.textContent = p.status;
      li.appendChild(badge);
    }

    return li;
  }

  // A row's leading tile: the thumbnail if there is one, otherwise (or if it
  // fails to load) the ▸ mark, so every name in the list starts at the same x.
  function thumb(p) {
    const blank = () => {
      const span = document.createElement("span");
      span.className = "side-item-thumb side-item-thumb-empty";
      span.textContent = "▸";
      span.setAttribute("aria-hidden", "true");
      return span;
    };
    if (!p.thumbnail) return blank();

    const img = document.createElement("img");
    img.className = "side-item-thumb";
    img.src = p.thumbnail;
    img.alt = "";
    img.loading = "lazy";
    img.onerror = () => img.replaceWith(blank());
    return img;
  }

  function note(text) {
    const li = document.createElement("li");
    li.className = "side-note";
    li.textContent = text;
    return li;
  }
})();
