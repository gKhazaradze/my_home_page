// ─── THE REGISTRY ────────────────────────────────────────────────────────
// "What I'm up to." Add a project = append one object here and push. No DB,
// no backend — this file is the single source of truth for the homepage cards.
//
// Fields:
//   sub        the subdomain label → the card links to https://<sub>.<domain>
//              (the domain is taken from the page's own host at render time,
//              so nothing here is hard-coded to a specific domain)
//   title      display name
//   blurb      one-line description
//   status     "live" | "building" | "paused" | "archived"  (drives the badge)
//   tags       short keywords (rendered as chips)
//   thumbnail  path under site/ (e.g. "assets/roadtrip.png")
//
// Order here = order on the page.

const PROJECTS = [
  {
    sub: "roadtrip",
    title: "Tbilisi → Portimão",
    blurb: "A 16-day driving expedition across seven countries, with an interactive route map and a shared passenger roster.",
    status: "live",
    // tags: ["travel", "europe", "flask"],
    thumbnail: "assets/roadtrip.png",
  },
  {
    sub: "availability",
    title: "Availability",
    blurb: "When I'm around, when I'm away, and where there's a free seat — shared per friend, with seat requests.",
    status: "live",
    // tags: ["calendar", "flask"],
    thumbnail: "assets/availability.svg",
  },
];
