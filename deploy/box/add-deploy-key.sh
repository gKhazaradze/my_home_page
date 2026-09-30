#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────
# Pin one app's CI public key to the deploy gate (replacing its previous key).
# Run as root on the box:  sudo bash add-deploy-key.sh <app> < key.pub
#
#   <app>: platform roadtrip availability bustracker citywatch flights speed
#          oktopus liftmap-api  (deploy-app's list)
#
# Writes:  restrict,command="/usr/local/bin/deploy-gate <app>" <key> ci-<app>
# `restrict` turns off forwarding, the pty and agent/X11; `command=` means the
# key can do nothing but ask the gate to deploy that one app.
# ─────────────────────────────────────────────────────────────────────────
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "run as root (sudo)" >&2; exit 1; }
app="${1:-}"
case "$app" in
  platform|roadtrip|availability|bustracker|citywatch|flights|speed|oktopus|liftmap-api) ;;
  *) echo "usage: $0 <app> < key.pub" >&2; exit 2 ;;
esac
read -r type key _ || true
[[ "$type" == ssh-ed25519 && "$key" =~ ^[A-Za-z0-9+/=]+$ ]] || { echo "expected one ssh-ed25519 public key on stdin" >&2; exit 2; }

f=/home/deploy/.ssh/authorized_keys
tmp=$(mktemp)
grep -v " ci-$app\$" "$f" > "$tmp" || true
printf 'restrict,command="/usr/local/bin/deploy-gate %s" %s %s ci-%s\n' "$app" "$type" "$key" "$app" >> "$tmp"
install -o root -g root -m 644 "$tmp" "$f"
rm -f "$tmp"
echo "ci-$app pinned to deploy-gate ($(grep -c . "$f") key(s) total)"
