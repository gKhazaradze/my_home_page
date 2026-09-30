# The CI deploy gate

How every repo's GitHub Actions deploys to the box — without a shell there
(security fix plan 5.4, 2026-09-30).

## How it works

1. A repo's deploy job signs in as `deploy@<box>` with **that repo's own** SSH
   key (its `EC2_SSH_KEY` secret) and sends one thing: the commit it tested
   (`$GITHUB_SHA`). The server's host key is pinned in the workflow.
2. `~deploy/.ssh/authorized_keys` pins each key to
   `restrict,command="/usr/local/bin/deploy-gate <app>"`. Whatever CI asks to
   run arrives as data in `SSH_ORIGINAL_COMMAND`; the gate accepts only a
   40-hex SHA (or `check <sha>`), then runs `sudo -n /usr/local/sbin/deploy-app`,
   the one command `deploy`'s sudoers entry allows.
3. `deploy-app` (root) fetches the app's branch. The SHA must be on it; if the
   branch has moved past it, a newer push's own run deploys that and this one
   does nothing. Otherwise it resets the checkout to the SHA and runs the repo's
   own `deploy/on-box.sh`, as root, with a clean environment. One deploy per
   app at a time. git runs as the checkout's owner when that user holds the git
   credentials, so `.git` never gains root-owned files.
4. `cctv` and `liftmap-api` pull prebuilt images: their jobs pipe
   `"<actor> <GITHUB_TOKEN>"` on stdin, which reaches `on-box.sh` and dies with
   the job.

So a stolen CI key, or a hijacked GitHub Action holding one, can only trigger a
redeploy of what is already on the repo's main branch. Changing what runs as
root means pushing to the repo on GitHub.

`deploy` has no password, no `docker`/`sudo` group, and cannot edit its own
`authorized_keys` (root-owned). Your own admin access (`ubuntu`, full sudo) is
separate and unchanged.

## Install / update

```sh
# from this directory on your machine
tar czf - deploy-gate deploy-app install-deploy-gate.sh add-deploy-key.sh | \
  ssh ubuntu@<box> 'd=$(mktemp -d); tar xzf - -C "$d"; sudo bash "$d/install-deploy-gate.sh"; \
    sudo install -D -m 755 "$d/add-deploy-key.sh" /usr/local/share/deploy-gate/add-deploy-key.sh; rm -rf "$d"'
```

Idempotent; keeps the keys.

## Add an app / rotate a key

1. Add the app to the `case` in `deploy-app` (name, checkout dir, branch) and
   reinstall as above.
2. Give the repo a `deploy/on-box.sh` (copy flight_tracker's — the template)
   and the "Deploy over SSH" step from its workflow.
3. Make a key, pin it, hand it to the repo — the private half never printed:
   ```sh
   ssh-keygen -q -t ed25519 -N '' -C ci-<app> -f /tmp/ci-<app>
   ssh ubuntu@<box> 'sudo bash /usr/local/share/deploy-gate/add-deploy-key.sh <app>' < /tmp/ci-<app>.pub
   gh secret set EC2_SSH_KEY -R gKhazaradze/<repo> < /tmp/ci-<app>
   rm -P /tmp/ci-<app> /tmp/ci-<app>.pub
   ```
   `add-deploy-key.sh` replaces the app's previous key, so the same steps rotate
   one.
4. Try it without deploying: `ssh -i /tmp/ci-<app> deploy@<box> "check <sha>"`.

If the box's SSH host key ever changes (a rebuilt instance), every workflow's
pinned `known_hosts` line must be updated, or deploys refuse to connect.
