# Docker image pruning — host install

Infrastructure work outside git/Docker, same as `custom-domain-agent` in this
directory — nothing here runs automatically from a `git push`; installing and
enabling it on the real EC2 host is a manual step.

## What ships in this feature

- `infra/systemd/docker-image-prune.service`, `.timer` — systemd units (timer + oneshot)

## Why

Every deploy (`docker compose pull` + `up -d --force-recreate`) leaves the
previous `dallascaley/breakroom-backend:latest` image behind, untagged. On
2026-07-18 about a dozen deploys in one session piled up ~2.3GB of these and
filled the 8GB root volume to 98%, breaking the next deploy outright with "no
space left on device". Fixed in the moment with a one-off `docker image
prune -f`; this timer makes that automatic instead of relying on remembering
to run it by hand.

## Install steps (run on the EC2 host, not from a dev machine)

```bash
sudo cp infra/systemd/docker-image-prune.service infra/systemd/docker-image-prune.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now docker-image-prune.timer
```

Verify it's scheduled and watch a manual run:
```bash
systemctl list-timers docker-image-prune.timer
sudo systemctl start docker-image-prune.service
sudo journalctl -u docker-image-prune.service -f
```

## Status

Installed and enabled live on 2026-07-18, running every 2 hours.
