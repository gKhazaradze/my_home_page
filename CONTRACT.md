# How a project joins the platform

The platform (this repo) owns the **edge** (Caddy on host :80/:443) and the
**homepage**. Each project stays in its **own repo with its own CI** and plugs
in through one small, file-free contract: a shared Docker network.

## The contract (4 lines in the project's `docker-compose.yml`)

1. Join the shared network:
   ```yaml
   services:
     myapp:
       networks: [web]
   ```
2. Declare that network as **external** (the platform owns its lifecycle, the
   project just attaches):
   ```yaml
   networks:
     web:
       external: true
       name: web
   ```
3. Give the service a **stable, unique** `container_name` — convention: use the
   subdomain (`container_name: myapp`). Caddy routes to it by this name.
4. Listen on a **fixed container port** and publish **no host ports**. Caddy is
   the only thing that binds the host edge. (Delete any `ports:` block.)

That's it. No shared files, no imports — the only coupling is the network name
string `web`.

> If `web` doesn't exist yet, `docker compose up` fails fast with
> *"network web declared as external, but could not be found"*. Fix:
> `docker network create web` (the platform provisioner does this for you).
> Add a `docker network inspect web >/dev/null 2>&1 || docker network create web`
> guard to your project's CI so a missing network can't red-fail a deploy.

## Then register it on the platform (2 edits in THIS repo)

5. Add one block to [`Caddyfile`](Caddyfile):
   ```caddyfile
   myapp.{$DOMAIN} {
       reverse_proxy myapp:8000
   }
   ```
   Keep the block **bare** unless your app does *not* set its own gzip/security
   headers — Caddy passes the app's responses through, and duplicating `encode`
   or headers causes double-compression / doubled headers.
6. Add one card to [`site/projects.js`](site/projects.js):
   ```js
   { sub: "myapp", title: "My App", blurb: "...", status: "building",
     tags: ["..."], thumbnail: "assets/myapp.png" }
   ```
   Drop a thumbnail in `site/assets/`.

Push both repos. Wildcard DNS already resolves `myapp.<domain>`; Caddy
auto-issues its cert on first request; the card appears on the homepage. No DNS
change, no roadtrip involvement.

## Why subdomains (not paths)

A subdomain keeps your app at the **site root**, so absolute `/api/*` calls,
root-relative assets, and same-origin assumptions all keep working with **zero
app-code changes**. Path-based routing (`/myapp/`) would force per-project base
rewrites.
