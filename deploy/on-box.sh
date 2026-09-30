#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────
# The deploy, as it runs ON THE BOX. The gate (my_home_page/deploy/box) has
# already fetched origin, checked this is the commit CI tested, reset the
# checkout to it and cd-ed here; this runs as root with a clean environment
# (APP=platform, DEPLOY_SHA=<commit>). CI can trigger it but not change it:
# what runs is this file, as committed on the branch (security fix plan 5.4).
# ─────────────────────────────────────────────────────────────────────────
set -euo pipefail

live=$(mktemp)
trap 'rm -f "$live"' EXIT

echo "--- Ensuring the edge networks exist ---"
# `web` is Caddy's own; every app has an edge-<name> network shared
# only with Caddy (CONTRACT.md). Create whichever the compose names
# and the box lacks, so attaching Caddy to all of them cannot fail.
for n in web $(sed -n 's/^    name: \(edge-.*\)$/\1/p' /srv/platform/docker-compose.yml); do
  docker network inspect "$n" >/dev/null 2>&1 || docker network create "$n"
done

echo "--- Building & (re)starting the edge ---"
cd /srv/platform
docker compose up -d --remove-orphans

echo "--- Reloading Caddy (applies Caddyfile-only edits) ---"
# `up -d` alone won't restart Caddy for a config-file change, so
# reload explicitly against the running container's admin API.
# This only works because /etc/caddy is a DIRECTORY mount: a
# single-file mount is inode-bound, and `git reset` swaps the inode,
# so the reload would read stale content and log "config is
# unchanged" while the edge kept serving the old routing table.
# When `up -d` has just (re)created the container, Caddy is still starting:
# wait for its admin API first, or the reload races it and fails with
# "connection refused" on :2019 (the first hardened deploy, 2026-09-30).
# 127.0.0.1 for the same reason as below: the admin API is IPv4-only.
for i in $(seq 1 30); do
  docker exec caddy wget -qO- http://127.0.0.1:2019/config/ >/dev/null 2>&1 && break
  sleep 0.5
done
docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile --address 127.0.0.1:2019

echo "--- Verifying the running config matches the repo ---"
# Guard against a SILENT no-op reload. This is the failure that cost
# us a debugging session: the deploy went green, Caddy logged
# "config is unchanged", and the edge kept serving the old routing
# table. Assert that every project hostname in the repo Caddyfile is
# actually present in the config Caddy has loaded.
# NOTE: 127.0.0.1, not localhost — the admin API is IPv4-only and
# busybox wget resolves localhost to ::1 (connection refused).
docker exec caddy wget -qO- http://127.0.0.1:2019/config/ > "$live"
# The `-` matters: a hyphenated subdomain (bus-tracker.{$DOMAIN})
# would otherwise not match, and this guard would skip it silently —
# exempting the very project it exists to protect.
for host in $(grep -oE '^[a-z0-9-]+\.\{\$DOMAIN\}' /srv/platform/caddy/Caddyfile | cut -d. -f1); do
  if ! grep -q "\"$host\." "$live"; then
    echo "MISMATCH: '$host' is in the repo Caddyfile but NOT in the running config."
    echo "The edge is serving stale routing. Recreate it:"
    echo "  cd /srv/platform && docker compose up -d --force-recreate caddy"
    exit 1
  fi
done
echo "Running config contains every site block in the repo"

echo "--- Pruning dangling images ---"
docker image prune -f >/dev/null 2>&1 || true

echo "--- Waiting for the edge to answer on :80 ---"
for i in $(seq 1 15); do
  if curl -sS -o /dev/null --max-time 2 http://127.0.0.1/; then
    echo "Edge is up"; exit 0
  fi
  sleep 2
done
echo "Edge failed to come up in time"
docker compose logs --tail=40
exit 1
