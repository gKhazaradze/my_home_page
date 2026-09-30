#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# Set (or rotate) one private app's edge password — run on YOUR machine, in
# your own terminal, not through a tool that records output: the password is
# shown once, here, for your password manager, and nowhere else.
#
#   deploy/set-edge-password.sh <app> [user]
#     app:  flights | speed | oktopus | liftmap_dash
#     user: the name to sign in with (default: george)
#
# It hashes the password locally (the same caddy:2-alpine image the edge runs)
# and writes EDGE_AUTH_<APP>_USER / EDGE_AUTH_<APP>_HASH into /srv/platform/.env
# on the server — SINGLE-quoted, because Compose would otherwise read the `$`s
# in a bcrypt hash as variables and cut it short. Caddy reads its environment
# only when its container is created, so the last step recreates it (a few
# seconds of downtime for every site); pass --no-apply to skip that and let the
# next platform deploy do it.
#
# Needs: docker locally, and SSH to the box (SSH_KEY / SSH_HOST override).
# ─────────────────────────────────────────────────────────────────────────
set -euo pipefail

APPLY=1
ARGS=()
for a in "$@"; do [[ "$a" == "--no-apply" ]] && APPLY=0 || ARGS+=("$a"); done
APP="${ARGS[0]:-}"
USERNAME="${ARGS[1]:-george}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/roadtrip_deploy}"
SSH_HOST="${SSH_HOST:-ubuntu@51.102.88.142}"
ENV_FILE="/srv/platform/.env"

case "$APP" in
  flights|speed|oktopus|liftmap_dash) ;;
  *) echo "usage: $0 <flights|speed|oktopus|liftmap_dash> [user] [--no-apply]" >&2; exit 2 ;;
esac
VAR=$(printf '%s' "$APP" | tr '[:lower:]' '[:upper:]')
[[ "$USERNAME" =~ ^[A-Za-z0-9_.-]+$ ]] || { echo "user must be letters, digits, _ . -" >&2; exit 2; }

read -r -s -p "New password for $APP (empty = generate one): " PASSWORD; echo
if [[ -z "$PASSWORD" ]]; then
  # Four random words from the system dictionary, or 20 random characters.
  if [[ -r /usr/share/dict/words ]]; then
    PASSWORD=$(LC_ALL=C grep -E '^[a-z]{4,8}$' /usr/share/dict/words \
      | python3 -c 'import sys,secrets; w=sys.stdin.read().split(); print("-".join(secrets.choice(w) for _ in range(4)))')
  else
    PASSWORD=$(openssl rand -base64 15 | tr -d '/+=')
  fi
  GENERATED=1
else
  read -r -s -p "Again: " AGAIN; echo
  [[ "$PASSWORD" == "$AGAIN" ]] || { echo "the two differ" >&2; exit 1; }
  [[ ${#PASSWORD} -ge 12 ]] || { echo "use at least 12 characters" >&2; exit 1; }
  GENERATED=0
fi

HASH=$(docker run --rm caddy:2-alpine caddy hash-password --plaintext "$PASSWORD")
[[ "$HASH" == \$2a\$* ]] || { echo "unexpected hash output" >&2; exit 1; }

# Replace the two lines if present, append them if not. The hash travels on
# stdin, never on a command line.
printf '%s\n%s\n' "EDGE_AUTH_${VAR}_USER='${USERNAME}'" "EDGE_AUTH_${VAR}_HASH='${HASH}'" | \
  ssh -i "$SSH_KEY" -o BatchMode=yes "$SSH_HOST" "
    set -e
    tmp=\$(mktemp)
    sudo grep -v -E '^EDGE_AUTH_${VAR}_(USER|HASH)=' '$ENV_FILE' > \"\$tmp\" || true
    cat >> \"\$tmp\"
    sudo install -m 600 -o \$(stat -c %U '$ENV_FILE') -g \$(stat -c %G '$ENV_FILE') \"\$tmp\" '$ENV_FILE'
    rm -f \"\$tmp\"
    echo 'server: .env updated'"

if [[ $APPLY -eq 1 ]]; then
  ssh -i "$SSH_KEY" -o BatchMode=yes "$SSH_HOST" "cd /srv/platform && sudo docker compose up -d caddy >/dev/null && echo 'server: caddy recreated with the new credential'"
fi

echo
echo "  $APP:  user '$USERNAME'"
[[ $GENERATED -eq 1 ]] && echo "  password: $PASSWORD      <- save it now; it is not stored anywhere"
echo "  Browsers that cached the old password will ask again."
