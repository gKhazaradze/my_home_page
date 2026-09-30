#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────
# Install (or refresh) the CI deploy gate on the box. Run as root, from this
# directory:  sudo bash install-deploy-gate.sh
#
#   - user `deploy`: no password, no docker group, no sudo beyond one command
#   - /usr/local/bin/deploy-gate  (what each CI key is pinned to)
#   - /usr/local/sbin/deploy-app  (the root-owned deploy, the one sudo target)
#   - /etc/sudoers.d/60-deploy-gate: deploy may run deploy-app, nothing else
#   - ~deploy/.ssh/authorized_keys owned by ROOT, so `deploy` cannot add a key
#     of its own; keys are added with add-deploy-key.sh
#
# Idempotent: re-running updates the two scripts and leaves the keys alone.
# Security fix plan 5.4.
# ─────────────────────────────────────────────────────────────────────────
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "run as root (sudo)" >&2; exit 1; }
here="$(cd "$(dirname "$0")" && pwd)"

if ! id deploy >/dev/null 2>&1; then
  useradd --create-home --shell /bin/sh --comment "CI deploy gate (see deploy-gate)" deploy
fi
passwd -l deploy >/dev/null
for g in sudo docker adm lxd; do gpasswd -d deploy "$g" >/dev/null 2>&1 || true; done

install -o root -g root -m 755 "$here/deploy-gate" /usr/local/bin/deploy-gate
install -o root -g root -m 755 "$here/deploy-app"  /usr/local/sbin/deploy-app

sudoers=$(mktemp)
cat > "$sudoers" <<'EOF'
# CI deploy gate (my_home_page/deploy/box): the `deploy` user may run the
# root-owned deploy-app — which validates its own arguments — and nothing else.
Defaults:deploy !requiretty, env_reset
deploy ALL=(root) NOPASSWD: /usr/local/sbin/deploy-app
EOF
visudo -cf "$sudoers" >/dev/null
install -o root -g root -m 440 "$sudoers" /etc/sudoers.d/60-deploy-gate
rm -f "$sudoers"

install -d -o root -g root -m 755 /home/deploy/.ssh
[[ -f /home/deploy/.ssh/authorized_keys ]] || install -o root -g root -m 644 /dev/null /home/deploy/.ssh/authorized_keys
chown root:root /home/deploy/.ssh/authorized_keys
chmod 644 /home/deploy/.ssh/authorized_keys

echo "deploy gate installed: $(grep -c . /home/deploy/.ssh/authorized_keys) key(s) in ~deploy/.ssh/authorized_keys"
