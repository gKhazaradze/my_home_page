# Platform — homepage hub + edge

This repo turns one box into a multi-project host. It owns two things:

- **The edge** — a single [Caddy](https://caddyserver.com) container that binds
  host `:80`/`:443`, terminates TLS (automatic Let's Encrypt), and reverse-proxies
  each project subdomain to a project container by name.
- **The homepage** — a static "what I'm up to" hub (`site/`) that Caddy serves
  directly. Project cards come from a version-controlled registry, no DB.

Everything else — the actual projects (roadtrip, …) — lives in its **own repo**
with its **own CI** and plugs in through the shared `web` network (see
[CONTRACT.md](CONTRACT.md)).

```
                Internet  →  example.com + *.example.com  (Elastic IP)
                                     │  :80 / :443
                              ┌──────▼───────┐
                              │     caddy    │  TLS + routing + homepage
                              └───┬──────┬───┘
                  apex /          │      │  roadtrip.example.com
            homepage (site/)      │      │  → roadtrip:8000
                                  │  ┌───▼────────┐   ┌────────────┐
        shared network "web"  ████┼──│  roadtrip  │   │ future proj│
                                  └──│  :8000     │   │  :PORT     │
                                     └────────────┘   └────────────┘
                                      own repo+CI       own repo+CI
```

## Layout

| Path | Purpose |
|------|---------|
| `docker-compose.yml` | The single `caddy` service; external `web` network; persistent cert volumes. |
| `Caddyfile` | The whole edge routing table (apex homepage + one block per project). |
| `.env.example` | `DOMAIN` + `ACME_EMAIL` (the real `.env` lives on the server). |
| `site/` | The homepage: `index.html`, `styles.css`, `projects.js` (the registry), `render.js`. |
| `deploy/setup-platform.sh` | One-shot server provisioner. |
| `.github/workflows/main.yml` | CI: validate → SSH deploy → `caddy reload` → health check. |
| `CONTRACT.md` | How a project joins the platform. |
| `SETUP.md` | First-time provisioning, the live-box migration runbook, CI secrets. |

## Run locally

The homepage is plain static — open `site/index.html`, or serve it:

```bash
cd site && python3 -m http.server 8080   # http://localhost:8080
```

(Card links use the page's host, so locally they point at `*.localhost` and
won't resolve to the real projects — that's expected; it's a content preview.)

To exercise the full edge locally you'd run the Caddy container with a local
`.env` and the `web` network; in practice the edge is validated in CI and on the
server.

## Add a project

Three small edits, fully decoupled — see [CONTRACT.md](CONTRACT.md):

1. In the project repo: join `web`, set a `container_name`, drop host ports.
2. Here: one `reverse_proxy` block in `Caddyfile`.
3. Here: one card in `site/projects.js` (+ a thumbnail in `site/assets/`).

Push. Wildcard DNS + auto-HTTPS handle the rest.

## Deploy

`git push` to `main` runs the workflow: it validates the Caddyfile/compose/JS,
SSHes to the box, syncs `/srv/platform`, `docker compose up -d`, reloads Caddy,
and health-checks the homepage. First-time setup and migrating the existing
roadtrip box are in [SETUP.md](SETUP.md).
