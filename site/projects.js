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
  {
    sub: "citywatch",
    title: "CityWatch",
    blurb: "A wall of live public camera feeds — city centres, zoos, beaches and landmarks — each on a map, with its own local time and sun position.",
    status: "live",
    // tags: ["video", "maps", "react"],
    thumbnail: "assets/citywatch.svg",
  },
  {
    sub: "bustracker",
    title: "Tbilisi Bus Tracker",
    blurb: "Every bus in the Tbilisi network on one live map — filter by route, and hover a bus to trace the path it runs.",
    status: "live",
    // tags: ["maps", "transit", "python"],
    thumbnail: "assets/bustracker.svg",
  },
  {
    sub: "flights",
    title: "Flight Tracker",
    blurb: "Meeting someone at the airport? Track their flight by its code — live arrival countdown, with phone reminders 3, 2 and 1 hours before landing.",
    status: "live",
    // tags: ["travel", "notifications", "python"],
    thumbnail: "assets/flights.svg",
  },
  {
    sub: "speed",
    title: "Speed Tracker",
    blurb: "One button: toggle it on and it records your speed from GPS, toggle it off and it saves the run \u2014 average, moving average, top speed and distance.",
    status: "live",
    // tags: ["gps", "pwa", "vanilla-js"],
    thumbnail: "assets/speed.svg",
  },
];
