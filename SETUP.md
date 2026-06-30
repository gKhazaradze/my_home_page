# Setup & migration guide

How to stand up the platform edge and migrate the **existing live roadtrip box**
from "roadtrip owns host :80" to "Caddy owns the edge; roadtrip is a subdomain."
The cutover downtime is a few seconds and the roadtrip SQLite data is preserved.

## Prerequisites

- The existing EC2 instance (Amazon Linux 2023 / Ubuntu 22.04+ / Debian 12+).
- A **domain name** you control (needed for HTTPS — Let's Encrypt won't certify
  raw `*.amazonaws.com`).
- SSH access via your key pair.
- This repo pushed to GitHub.



## Step 1 — Elastic IP + DNS

1. **Allocate an Elastic IP** in EC2 and associate it with the instance. This
   pins the public IP so a stop/start can't change it and break DNS.
2. At your DNS provider, create two `A` records pointing at the Elastic IP:

   | Name | Type | Value |
   |------|------|-------|
   | `@` (apex) | A | `<Elastic IP>` |
   | `*` (wildcard) | A | `<Elastic IP>` |

   The wildcard means **every future subdomain** (`roadtrip`, the next project,
   …) resolves with no further DNS work. Lower the TTL to ~300s a little ahead
   of the cutover. Verify: `dig +short example.com` and `dig +short roadtrip.example.com`
   both return the Elastic IP.

---

## Step 2 — Security group

Allow inbound:

| Port | Proto | Source | Purpose |
|------|-------|--------|---------|
| 22 | TCP | your-IP/32 | SSH |
| 80 | TCP | 0.0.0.0/0 | HTTP (ACME challenge + redirect to HTTPS) |
| 443 | TCP | 0.0.0.0/0 | HTTPS |
| 443 | UDP | 0.0.0.0/0 | HTTP/3 (optional; clients fall back to TCP if closed) |

Port 443 is the new one — the old roadtrip setup only needed 80. **Keep 80 open**
(Caddy needs it for cert issuance/renewal).

---

## Step 3 — Prepare the roadtrip repo (do this first, don't deploy yet)

roadtrip's **app code needs no changes**, but a few **infra** files do (its CI
health-checks host :80, which Caddy is taking over). Make these edits in the
`roadtrip-site` repo and push them — they're already prepared if you applied the
companion changes:

- `docker-compose.yml`: remove the `ports:` block, add `networks: [web]` + the
  top-level external `web` network. (Keep `container_name: roadtrip`, the
  `roadtrip-data` volume, `TRIP_KEY`, `restart`.)
- `docker-compose.dev.yml`: add `ports: ["8000:8000"]` so local dev still works.
- `.github/workflows/main.yml`: both health probes repointed off host :80, plus
  a `web`-network create-if-missing guard.
- `deploy/setup-server.sh` + its `SETUP.md` Step 3: health check + Caddy-on-host
  guidance updated for the network-only model.

> Don't trigger the roadtrip deploy of the `ports`-removed compose until the
> cutover (Step 5) — until then roadtrip should keep serving on :80.

---

## Step 4 — Stage the platform (still no cutover)

SSH to the box and run the provisioner. It installs Docker (if needed), creates
the `web` network, clones this repo to `/srv/platform`, writes `.env`, and tries
to start Caddy:

```bash
ssh -i your-key.pem ec2-user@<Elastic IP>     # or ubuntu@ on Ubuntu/Debian

curl -sSL https://raw.githubusercontent.com/gKhazaradze/my_home_page/main/deploy/setup-platform.sh > setup-platform.sh
chmod +x setup-platform.sh
sudo ./setup-platform.sh https://github.com/gKhazaradze/my_home_page.git example.com gKhazaradze@example.com
```

If roadtrip is **still publishing :80**, Caddy can't bind it and the script
prints a clear warning — that's expected. The repo + `.env` + network are now
staged; proceed to the cutover. (Re-running the script later is safe.)

> **Tip — avoid Let's Encrypt rate limits while testing.** If you expect to
> iterate on the Caddyfile, point Caddy at the LE **staging** CA first by adding
> `acme_ca https://acme-staging-v02.api.letsencrypt.org/directory` inside the
> global `{ }` block, deploy, confirm routing works, then remove it for real certs.

---

## Step 5 — Cutover (the only brief blip)

Run these back-to-back on the box:

```bash
# 1. Free host :80 by making roadtrip network-only (authoritative action =
#    removing its ports: block, which you pushed in Step 3).
cd /srv/roadtrip
sudo git fetch --prune origin main && sudo git reset --hard origin/main
sudo docker compose up -d            # recreates roadtrip with NO host ports, on `web`

# 2. Confirm nothing still holds host :80.
sudo ss -ltnp '( sport = :80 )'      # should print no LISTEN line

# 3. Start the edge immediately.
cd /srv/platform
sudo docker compose up -d
sudo docker compose logs -f caddy    # watch ACME issue certs for apex + roadtrip
```

**Rollback** (if Caddy fails to bind / misbehaves): re-add roadtrip's `ports:`
block and `sudo docker compose up -d` in `/srv/roadtrip` to restore :80, then
fix the platform config and retry.

The `roadtrip-data` volume is mounted unchanged throughout, so passenger data
survives.

---

## Step 6 — Verify

Run each on its own line — don't paste trailing `#` notes into an interactive
shell that doesn't treat `#` as a comment (e.g. zsh without `interactive_comments`),
or curl will receive the note words as bogus URLs:

```bash
curl -I https://georgelands.com
curl -sI https://www.georgelands.com | grep -i location
curl -sf https://roadtrip.georgelands.com/api/health
sudo docker exec caddy caddy list-certificates
```

Expected: the apex returns `HTTP/2 200` with `server: Caddy` and a valid cert;
`www` returns a `301` redirect to `https://georgelands.com`; the roadtrip health
check returns `{"ok":true,"version":"2.0.0"}`; and `list-certificates` shows
certs for the apex, `www`, and `roadtrip.` subdomain.

Open `https://roadtrip.georgelands.com` in a browser: the Leaflet map + assets load
and the passenger-edit feature unlocks with the trip key — proving the root
origin is preserved and the DB survived.

---

## Step 7 — GitHub Actions auto-deploy (platform)

The workflow ([.github/workflows/main.yml](.github/workflows/main.yml)) SSHes in
and runs `git` + `docker` via `sudo` (the provisioner installs the NOPASSWD
sudoers rule and the `safe.directory` entries).

Add repo secrets (Settings → Secrets and variables → Actions):

| Name | Value |
|------|-------|
| `EC2_HOST` | Elastic IP or hostname |
| `EC2_USER` | `ec2-user` (Amazon Linux) or `ubuntu` |
| `EC2_SSH_KEY` | Contents of your deploy **private** key |
| `PLATFORM_DOMAIN` | `georgelands.com` (used by the post-deploy HTTPS health check) |

Reuse the same deploy SSH key you made for roadtrip (its public half is already
in the box's `~/.ssh/authorized_keys`). From now on, **push to `master`
redeploys the edge** — and roadtrip keeps deploying itself independently.

---

## Adding HTTPS for a new project later

Nothing extra: add the `reverse_proxy` block to the Caddyfile + the card to
`site/projects.js`, push. Wildcard DNS already resolves the subdomain and Caddy
auto-issues its cert on first request. See [CONTRACT.md](CONTRACT.md).

---

## Troubleshooting

**Caddy won't start — `address already in use :80`.** roadtrip (or the old nginx)
still binds :80. Confirm with `sudo ss -ltnp '( sport = :80 )'`; make roadtrip
network-only (remove its `ports:` block) or stop the old service.

**HTTPS fails / cert not issued.** Check `sudo docker compose logs caddy`. Common
causes: DNS not yet pointing at the box, :80 or :443 blocked in the security
group, or LE rate-limited (you iterated without staging — wait, or use staging).

**Cert errors like `lookup acme-v02.api.letsencrypt.org on 127.0.0.53:53 ...
connection refused`.** The container can't resolve external DNS — the host uses
**systemd-resolved**, whose `127.0.0.53` stub isn't reachable from inside a
container. The compose file already sets `dns: [8.8.8.8, 1.1.1.1]` on Caddy to
handle this; for a host-wide fix (covers every container) add
`{ "dns": ["8.8.8.8", "1.1.1.1"] }` to `/etc/docker/daemon.json` and
`sudo systemctl restart docker`. Service discovery (`roadtrip:8000`) is
unaffected — that uses Docker's `127.0.0.11` resolver.

**Homepage 200 but a project subdomain 502s.** That project's container isn't up
or isn't on `web`. `docker ps`, `docker network inspect web`, and check the
project's `container_name` matches its Caddyfile block.

**`dubious ownership` on first deploy.** The `safe.directory /srv/platform` entry
is missing for the account running `sudo git`. Re-run the provisioner, or
`sudo git config --global --add safe.directory /srv/platform`.

**A Caddyfile edit didn't take effect.** `docker compose up -d` doesn't recreate
Caddy for a bind-mounted file change — the deploy runs
`sudo docker exec caddy caddy reload --config /etc/caddy/Caddyfile` for that. Run
it by hand if needed.

**Never delete the `caddy_data` volume.** It holds the ACME account + all certs;
losing it forces re-issuance and can hit Let's Encrypt rate limits. Exclude it
from any `docker volume prune`.
