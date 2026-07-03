# Custom Domain Agent — host install (Phase C)

This is infrastructure work outside git/Docker — none of it runs automatically
from a `git push`. It's written here as reviewable artifacts; installing and
enabling it on the real EC2 host is a manual, guided step (see the plan's
"Pre-flight checks" and "Rollout phasing" sections).

## What ships in this feature

- `backend/scripts/custom-domain-agent.js` + `backend/scripts/package.json` — the agent itself
- `infra/nginx-custom-domain-http.template.conf`, `infra/nginx-custom-domain-ssl.template.conf` — nginx templates it renders
- `infra/systemd/custom-domain-agent.service`, `.timer` — systemd units (timer + oneshot)
- `infra/systemd/custom-domain-agent.sudoers` — narrow sudoers allowlist
- `infra/systemd/custom-domain-agent.env.example` — env template

## Install steps (run on the EC2 host, not from a dev machine)

1. **Pre-flight**: confirm `44.225.148.34` is an Elastic IP (AWS console), not
   the instance's ephemeral default. If it's ephemeral, stop here and fix
   that first — every provisioned domain would silently break on any
   instance stop/start otherwise.

2. Create the low-privilege user:
   ```bash
   sudo useradd --system --no-create-home --shell /usr/sbin/nologin customdomain
   ```

3. Deploy the code:
   ```bash
   sudo mkdir -p /opt/custom-domain-agent
   # copy backend/scripts/*.js, backend/scripts/package.json, and both
   # infra/*.template.conf files flat into /opt/custom-domain-agent (same
   # directory as the script, not a nested infra/ subfolder). The code's
   # built-in default template path won't resolve for this flat layout, so
   # CUSTOM_DOMAIN_TEMPLATE_DIR=/opt/custom-domain-agent must be set
   # explicitly in the env file below — it's not actually optional.
   cd /opt/custom-domain-agent && sudo -u customdomain npm install --production
   sudo chown -R customdomain:customdomain /opt/custom-domain-agent
   ```

4. Env file:
   ```bash
   sudo cp custom-domain-agent.env.example /etc/custom-domain-agent.env
   sudo vi /etc/custom-domain-agent.env   # fill in real DB_PASS etc; leave CERTBOT_STAGING=true for now
   sudo chown customdomain:customdomain /etc/custom-domain-agent.env
   sudo chmod 600 /etc/custom-domain-agent.env
   ```

5. Sudoers — validate before installing:
   ```bash
   visudo -cf infra/systemd/custom-domain-agent.sudoers
   sudo cp infra/systemd/custom-domain-agent.sudoers /etc/sudoers.d/custom-domain-agent
   sudo chmod 440 /etc/sudoers.d/custom-domain-agent
   ```

6. systemd units:
   ```bash
   sudo cp infra/systemd/custom-domain-agent.service infra/systemd/custom-domain-agent.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now custom-domain-agent.timer
   ```

7. **Confirm the renewal timer is enabled** — on this host it's named
   `certbot-renew.timer` (not the generic `certbot.timer`), and it was
   already active from the original prosaurus.com setup:
   ```bash
   systemctl list-timers certbot-renew.timer
   ```

8. Test end-to-end against **staging** first (`CERTBOT_STAGING=true` in the
   env file) using `carolearts.com` — pick up where
   `docs/custom-domain-carolearts.md` left off. Watch a cycle run manually:
   ```bash
   sudo systemctl start custom-domain-agent.service
   sudo journalctl -u custom-domain-agent.service -f
   ```

9. Once a staging run succeeds end-to-end, flip `CERTBOT_STAGING` off (remove
   or set to `false` in `/etc/custom-domain-agent.env`) and re-run for real.

10. Run through the checklist in `docs/custom-domain-carolearts.md` Step 9
    (no redirect, URL bar stays, green padlock, no CORS errors, `www` works).

---

**Status**: steps 1–10 completed live for `carolearts.com` on 2026-07-03 —
staging cert issued and verified first, then flipped to a real trusted
Let's Encrypt certificate (`C=US, O=Let's Encrypt, CN=YE1`, valid through
Oct 1 2026), covering both `carolearts.com` and `www.carolearts.com`.
The timer is enabled and running every 5 minutes. Three real bugs were
found and fixed during this first run (see git history for
`backend/scripts/custom-domain-agent.js` and
`infra/systemd/custom-domain-agent.service` around 2026-07-03) — a
false-positive `default_server` check tripped by the template's own
explanatory comment, and two rounds of `ProtectSystem=strict` sandboxing
blocking `nginx -t` and `certbot` from writing their own logs/pidfile/
lockfile. Both are fixed in the versions of those files now in this repo,
so a fresh install following this README should not hit either again.
