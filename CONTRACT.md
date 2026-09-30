# How a project joins the platform

The platform (this repo) owns the **edge** (Caddy on host :80/:443) and the
**homepage**. Each project stays in its **own repo with its own CI** and plugs
in through one small, file-free contract: its own Docker network, which it
shares with Caddy and nothing else.

**Why one network per project, not one shared network.** Until 2026-09-30 every
project joined one shared `web` network, so any container could reach any other
directly — past Caddy, and past the edge password that guards the private apps.
One bug in a public app would have been a way into all of them. Now each
project's network holds exactly two containers, the project's and Caddy's, and a
compromised container cannot even resolve its neighbours' names. Keep it so:
never attach a project to another project's network, or to `web`.

## The contract (4 lines in the project's `docker-compose.yml`)

1. Join the project's own network, named `edge-<container_name>`:
   ```yaml
   services:
     myapp:
       networks: [edge]
   ```
2. Declare that network as **external** (created out-of-band; Caddy attaches to
   it from the platform side):
   ```yaml
   networks:
     edge:
       external: true
       name: edge-myapp
   ```
3. Give the service a **stable, unique** `container_name` — convention: use the
   subdomain (`container_name: myapp`). Caddy routes to it by this name.
4. Listen on a **fixed container port** and publish **no host ports**. Caddy is
   the only thing that binds the host edge. (Delete any `ports:` block.)

That's it. No shared files, no imports — the only coupling is the network name
string `edge-myapp`.

> If `edge-myapp` doesn't exist yet, `docker compose up` fails fast with
> *"network edge-myapp declared as external, but could not be found"*. Put this
> in your project's CI deploy step before `compose up`, so a first deploy
> creates it and plugs Caddy in without waiting for the platform:
> ```sh
> sudo docker network inspect edge-myapp >/dev/null 2>&1 || sudo docker network create edge-myapp
> sudo docker network connect edge-myapp caddy 2>/dev/null || true
> ```

## Then register it on the platform (4 edits in THIS repo)

0. Add the network to Caddy in [`docker-compose.yml`](docker-compose.yml): a
   `- edge-myapp` line in the `caddy` service's `networks:` list, and an
   `edge-myapp: {external: true, name: edge-myapp}` entry (same shape as the
   others) under the top-level `networks:`. CI creates it if it is missing.
   Without this, the next platform deploy recreates Caddy without your network
   and your subdomain 502s.

5. Add one block to [`caddy/Caddyfile`](caddy/Caddyfile):
   ```caddyfile
   myapp.{$DOMAIN} {
       import assetlinks
       reverse_proxy myapp:8000
   }
   ```
   Keep the block **bare** apart from that import, unless your app does *not*
   set its own gzip/security headers — Caddy passes the app's responses through,
   and duplicating `encode` or headers causes double-compression / doubled
   headers.

   `import assetlinks` is not optional. The platform ships an **Android app**
   (a Trusted Web Activity — see [`android/`](android/)) that opens the hub
   full-screen with no browser URL bar. Chrome only grants that to an origin
   that serves `/.well-known/assetlinks.json` naming the app, and **every
   subdomain is its own origin**. The import makes the edge serve that one file
   on your behalf, so your app needs no change and never has to know the
   Android app exists. Leave the import out and your project still works
   perfectly in a browser — it just opens with a URL bar inside the app.

   Everything except that single path still reaches your container untouched,
   `/.well-known/` included.
6. Add the subdomain to `additionalTrustedOrigins` in
   [`android/twa-manifest.json`](android/twa-manifest.json):
   ```json
   "additionalTrustedOrigins": ["...", "myapp.<domain>"]
   ```
   **Easy to miss, and CI fails the deploy if you do** — the *Validate app
   manifest + asset links* step diffs the Caddyfile's subdomains against this
   list and exits 1 when they disagree, so a forgotten entry blocks the edge
   from shipping at all (the symptom is a TLS error on the new subdomain,
   because Caddy never learned the route and so never got a cert).

   Two files have to agree because serving `assetlinks.json` at the edge is
   necessary but not sufficient: Chrome only opens the origin full-screen if the
   **app** also declares it trusted. Entries must be **bare hostnames** —
   a `https://myapp...` entry yields a first label of `https://myapp`, which
   won't match and fails the same check.
7. Add one entry to the `PROJECTS` array in
   [`site/projects.js`](site/projects.js):
   ```js
   { sub: "myapp", title: "My App", blurb: "...", status: "building",
     tags: ["..."], thumbnail: "assets/myapp.png" }
   ```
   Drop a thumbnail in `site/assets/`. (`PROJECTS` feeds the *projects* side of
   the landing page — the cards on `/projects.html`, plus the name preview on
   the homepage panel. The `CALENDAR` object above it is the other side and is
   not a project slot.)

Push both repos. Wildcard DNS already resolves `myapp.<domain>`; Caddy
auto-issues its cert on first request; the card appears on the projects page.
No DNS change, no roadtrip involvement.

If the new subdomain gives a TLS/connection error rather than a page, check the
platform's CI run first: a failed validation step means the edge never deployed,
so Caddy has no route and no certificate for that host. The project's own
container being green tells you nothing about that half.

## Why subdomains (not paths)

A subdomain keeps your app at the **site root**, so absolute `/api/*` calls,
root-relative assets, and same-origin assumptions all keep working with **zero
app-code changes**. Path-based routing (`/myapp/`) would force per-project base
rewrites.
