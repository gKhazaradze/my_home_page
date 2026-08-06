// ─── THE REGISTRY ────────────────────────────────────────────────────────
// The landing page is a door with two sides:
//
//   left  → CALENDAR   my availability calendar, on a panel of its own
//   right → PROJECTS   everything else, listed as cards on /projects.html
//
// Add a project = append one object to PROJECTS and push. No DB, no backend —
// this file is the single source of truth for both sides.
//
// Fields (the same shape for the calendar and for every project):
//   sub        the subdomain label → the entry links to https://<sub>.<domain>
//              (the domain is taken from the page's own host at render time,
//              so nothing here is hard-coded to a specific domain)
//   title      display name
//   blurb      one-line description
//   status     "live" | "building" | "paused" | "archived"  (drives the badge)
//   tags       short keywords (rendered as chips on the project cards)
//   thumbnail  path under site/ (e.g. "assets/roadtrip.png")
//
// Order in PROJECTS = order on the projects page.

// ── Left side: the calendar gets its own door, not a card in the grid ──
const CALENDAR = {
  sub: "availability",
  title: "My Calendar",
  blurb: "Where I'm going and when",
  status: "live",
  thumbnail: "assets/availability.svg",
};

// ── Right side: everything I'm building ──
const PROJECTS = [
  {
    sub: "roadtrip",
    title: "Tbilisi → Portimão Roadtrip",
    blurb: "A 16-day driving expedition across seven countries, with an interactive route map and a shared passenger roster.",
    status: "live",
    // tags: ["travel", "europe", "flask"],
    thumbnail: "assets/roadtrip.png",
  },
];
