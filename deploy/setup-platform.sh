#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# Platform edge — provisioner.
#
# Run this ONCE on the server to stand up the Caddy edge + homepage. It will:
#   - install Docker + the compose plugin (if missing)
#   - create the shared external Docker network `web` (idempotent)
#   - clone/sync the platform repo into /srv/platform
#   - write /srv/platform/.env (DOMAIN + ACME_EMAIL)
#   - let the deploy user run docker/git without sudo (for GitHub Actions)
#   - mark /srv/platform a safe git directory for the deploy user AND root
#   - start the Caddy edge (binds host :80/:443; serves the homepage; proxies
#     each project subdomain by container name over `web`)
#
# IMPORTANT — ordering: Caddy needs host :80/:443. If the roadtrip container is
# still publishing host :80, this script's `docker compose up` will fail to bind
# it. Migrate roadtrip to network-only FIRST (see SETUP.md "Migration runbook").
#
# Usage:
#   sudo ./setup-platform.sh <github_repo_url> <domain> <acme_email>
# Example:
#   sudo ./setup-platform.sh https://github.com/gKhazaradze/my_home_page.git \
#        george.example.com you@example.com
#
# Re-running is safe (idempotent).
# ─────────────────────────────────────────────────────────────────────────

set -euo pipefail

REPO_URL="${1:-}"
DOMAIN="${2:-}"
ACME_EMAIL="${3:-}"
INSTALL_DIR="/srv/platform"
NETWORK="web"

if [[ -z "$REPO_URL" || -z "$DOMAIN" || -z "$ACME_EMAIL" ]]; then
    echo "Usage: sudo $0 <github_repo_url> <domain> <acme_email>"
    exit 1
fi
if [[ $EUID -ne 0 ]]; then
    echo "This script must be run as root (sudo)."
    exit 1
fi

# ─── Who will run deploys (GitHub Actions SSHes in as this user) ──────────
DEPLOY_USER="${SUDO_USER:-}"
if [[ -z "$DEPLOY_USER" || "$DEPLOY_USER" == "root" ]]; then
    if id ec2-user &>/dev/null; then DEPLOY_USER="ec2-user"
    elif id ubuntu &>/dev/null; then DEPLOY_USER="ubuntu"
    else DEPLOY_USER="root"; fi
fi
echo "==> Deploy user: $DEPLOY_USER"

# ─── Install Docker (+ compose plugin) if missing ─────────────────────────
if ! command -v docker &>/dev/null; then
    echo "==> Installing Docker via get.docker.com ..."
    curl -fsSL https://get.docker.com | sh
else
    echo "==> Docker already installed: $(docker --version)"
fi
systemctl enable --now docker

if ! docker compose version &>/dev/null; then
    echo "ERROR: the Docker Compose plugin isn't available."
    echo "Install it for your distro, then re-run this script."
    exit 1
fi

# ─── Shared external network (the contract every project joins) ───────────
if ! docker network inspect "$NETWORK" >/dev/null 2>&1; then
    echo "==> Creating shared network '$NETWORK' ..."
    docker network create "$NETWORK" >/dev/null
else
    echo "==> Shared network '$NETWORK' already exists."
fi

# ─── Let the deploy user drive docker/git; grant passwordless sudo for CI ──
if [[ "$DEPLOY_USER" != "root" ]]; then
    usermod -aG docker "$DEPLOY_USER"

    GIT_BIN="$(command -v git || echo /usr/bin/git)"
    DOCKER_BIN="$(command -v docker || echo /usr/bin/docker)"
    cat > /etc/sudoers.d/platform-deploy <<EOF
$DEPLOY_USER ALL=(root) NOPASSWD: $GIT_BIN, $DOCKER_BIN
EOF
    chmod 440 /etc/sudoers.d/platform-deploy
    visudo -c -f /etc/sudoers.d/platform-deploy >/dev/null
fi

# ─── Clone or sync the repo ───────────────────────────────────────────────
echo "==> Fetching repository into $INSTALL_DIR ..."
mkdir -p "$INSTALL_DIR"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$INSTALL_DIR"

# git runs as the deploy user interactively AND as root via sudo in CI, so mark
# the dir safe for both to avoid 'dubious ownership' aborts.
sudo -u "$DEPLOY_USER" git config --global --add safe.directory "$INSTALL_DIR" || true
git config --global --add safe.directory "$INSTALL_DIR" || true

if [[ -d "$INSTALL_DIR/.git" ]]; then
    sudo -u "$DEPLOY_USER" git -C "$INSTALL_DIR" fetch --prune origin master
    sudo -u "$DEPLOY_USER" git -C "$INSTALL_DIR" reset --hard origin/master
elif [[ -z "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]]; then
    sudo -u "$DEPLOY_USER" git clone "$REPO_URL" "$INSTALL_DIR"
else
    echo "ERROR: $INSTALL_DIR already exists, isn't a git repo, and isn't empty."
    echo "Move it aside and re-run:  sudo mv $INSTALL_DIR ${INSTALL_DIR}.bak"
    exit 1
fi

# ─── Write the .env Caddy reads (DOMAIN + ACME_EMAIL) ─────────────────────
cat > "$INSTALL_DIR/.env" <<EOF
DOMAIN=$DOMAIN
ACME_EMAIL=$ACME_EMAIL
EOF
chown "$DEPLOY_USER:$DEPLOY_USER" "$INSTALL_DIR/.env"
chmod 600 "$INSTALL_DIR/.env"

# ─── Pre-flight: is host :80 free for Caddy? ──────────────────────────────
if ss -ltnH '( sport = :80 )' 2>/dev/null | grep -q ':80'; then
    echo "WARNING: something is already listening on host :80."
    echo "         If that's the roadtrip container, migrate it to network-only"
    echo "         FIRST (remove its 'ports:' block, docker compose up -d), then"
    echo "         re-run this script. See SETUP.md 'Migration runbook'."
fi

# ─── Launch the edge ──────────────────────────────────────────────────────
echo "==> Starting the Caddy edge ..."
( cd "$INSTALL_DIR" && docker compose up -d --remove-orphans )

# ─── Health check (container up + local :80 responding) ───────────────────
echo "==> Waiting for the edge to respond ..."
OK=""
for _ in $(seq 1 15); do
    # Caddy answers :80 (a 308 redirect to HTTPS counts as 'up'). Public HTTPS
    # additionally needs DNS + open :443 + ACME, which may lag a few seconds.
    if curl -sS -o /dev/null --max-time 2 "http://127.0.0.1/"; then
        OK=1; break
    fi
    sleep 2
done

PUBLIC_IP=$(curl -s --max-time 3 http://169.254.169.254/latest/meta-data/public-ipv4 || echo "<your-server-ip>")

if [[ "${OK:-}" != "1" ]]; then
    echo "ERROR: the edge did not respond on :80. Logs:"
    ( cd "$INSTALL_DIR" && docker compose logs --tail=40 )
    exit 1
fi

cat <<EOF

========================================================================
 Platform edge is up (Caddy).

  Homepage:     https://$DOMAIN          (cert issues on first HTTPS hit)
  A project:    https://roadtrip.$DOMAIN
  Server IP:    $PUBLIC_IP

  Manage:       cd $INSTALL_DIR && docker compose ps
  Logs/certs:   cd $INSTALL_DIR && docker compose logs -f caddy
  Reload edge:  sudo docker exec caddy caddy reload --config /etc/caddy/Caddyfile

 Next steps:
   1. DNS: point  $DOMAIN  and  *.$DOMAIN  at $PUBLIC_IP (use an Elastic IP).
   2. Security group: allow inbound 443/TCP (and 443/UDP for HTTP/3) + 80.
   3. Configure GitHub Actions secrets (EC2_HOST/EC2_USER/EC2_SSH_KEY) — see SETUP.md.
   4. From now on, 'git push' to master redeploys the edge automatically.

 NOTE: '$DEPLOY_USER' was added to the 'docker' group. If you're still in the
 SSH session you ran this from, log out and back in before running docker
 commands without sudo. GitHub Actions sessions already pick it up.
========================================================================
EOF
