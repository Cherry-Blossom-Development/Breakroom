# Custom Domain Setup Log — carolearts.com

**Goal**: Serve Prosaurus content for user `purplebitch` at `www.carolearts.com` without redirecting to prosaurus.com. The URL bar should stay at `carolearts.com` permanently.

**Domain owner**: Carole (user handle: `purplebitch`)
**Registrar**: GoDaddy
**Target server**: EC2 at `44.225.148.34`
**Started**: 2026-06-29

---

## Background

Currently `carolearts.com` is configured in GoDaddy as a URL forward/redirect to a Prosaurus URL. Visitors are redirected and the prosaurus.com URL shows in the address bar.

The goal is "true custom domain" hosting — identical to how Shopify/Squarespace handle custom domains. The site is served by our nginx/EC2 infrastructure at the custom domain, no redirect involved.

Once this works manually for Carole, the log will serve as the basis for automating the process for future artists.

---

## Architecture Overview

What needs to be in place for a custom domain to work:

1. **DNS** (artist's registrar): A record for `carolearts.com` → `44.225.148.34`
2. **nginx** (EC2): Server block that accepts requests for `carolearts.com` and serves the frontend
3. **SSL** (EC2): Let's Encrypt cert for `carolearts.com` via certbot
4. **Backend — domain resolution**: Endpoint to map `carolearts.com` → user handle `purplebitch`
5. **Frontend — hostname detection**: Vue app detects it's not at prosaurus.com and loads the right profile
6. **Backend — CORS**: Allow API requests originating from `carolearts.com`

---

## Downtime Warning

There is an unavoidable outage window between when Carole changes her DNS and when nginx + certbot are configured on EC2. To minimize it:
- Coordinate in real time with Carole
- Check her current DNS TTL before starting (lower = faster propagation)
- Have the nginx config and certbot command ready before she makes the change
- Monitor propagation with `ping carolearts.com` — once it resolves to `44.225.148.34`, proceed immediately

---

## Step-by-Step Log

### Step 1 — Check current DNS TTL
**Status**: Pending

Log in to GoDaddy and check the TTL on `carolearts.com`'s forward/redirect record. If it's higher than 3600 (1 hour), ask Carole to lower it to 600 first, then wait for that TTL to expire before proceeding.

- Current TTL: _______
- Action taken: _______
- Result: _______

---

### Step 2 — Carole changes DNS in GoDaddy
**Status**: Pending

Carole removes the URL forward/redirect rule and adds:
- Type: `A`
- Host: `@` (bare domain)
- Points to: `44.225.148.34`
- TTL: 600 (or whatever minimum GoDaddy allows)

And optionally:
- Type: `CNAME`
- Host: `www`
- Points to: `carolearts.com`

Or a second A record for `www` → `44.225.148.34`.

- Time Carole made the change: _______
- DNS propagated to EC2 (confirmed via ping): _______
- Notes: _______

---

### Step 3 — Add nginx config on EC2
**Status**: Pending

SSH into EC2:
```bash
ssh -i ~/.ssh/Hostgator-Key-1.pem ec2-user@44.225.148.34
```

Create `/etc/nginx/conf.d/carolearts.com.conf`:
```nginx
server {
    listen 80;
    server_name carolearts.com www.carolearts.com;

    root /var/www/prosaurus.com;
    index index.html;

    location /.well-known/acme-challenge/ {
        root /var/www/prosaurus.com;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Then test and reload:
```bash
sudo nginx -t && sudo systemctl reload nginx
```

- Time completed: _______
- `nginx -t` output: _______
- Notes / errors: _______

---

### Step 4 — Issue SSL certificate via certbot
**Status**: Pending

```bash
sudo certbot certonly --nginx -d carolearts.com -d www.carolearts.com
```

If certbot auto-detects and updates nginx config:
```bash
sudo certbot --nginx -d carolearts.com -d www.carolearts.com
```

After cert is issued, update the nginx config to add SSL (certbot may do this automatically):
```nginx
server {
    listen 80;
    server_name carolearts.com www.carolearts.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name carolearts.com www.carolearts.com;

    ssl_certificate /etc/letsencrypt/live/carolearts.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/carolearts.com/privkey.pem;

    root /var/www/prosaurus.com;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

- Time completed: _______
- Cert issued successfully: Yes / No
- Cert path: _______
- Notes / errors: _______

---

### Step 5 — Backend: store custom domain in database
**Status**: Pending

Confirm that `purplebitch`'s user record has `custom_domain = 'carolearts.com'` in the database.

Check:
```sql
SELECT id, handle, custom_domain FROM users WHERE handle = 'purplebitch';
```

If not set, update:
```sql
UPDATE users SET custom_domain = 'carolearts.com' WHERE handle = 'purplebitch';
```

- Field exists on users table: Yes / No
- Value confirmed: _______
- Notes: _______

---

### Step 6 — Backend: domain resolution endpoint
**Status**: Pending

Add an endpoint so the frontend can resolve a hostname to a user:

```
GET /api/resolve-domain?host=carolearts.com
→ { handle: 'purplebitch' }
```

This queries `SELECT handle FROM users WHERE custom_domain = ?`.

- Endpoint added: Yes / No
- Tested: Yes / No
- Notes: _______

---

### Step 7 — Frontend: hostname detection
**Status**: Pending

When the Vue app loads, detect if `window.location.hostname` is not `prosaurus.com` / `local.prosaurus.com`. If it's a custom domain, call the resolve endpoint and route to that user's profile page directly (rather than the normal home/login flow).

- Code added: Yes / No
- Tested locally: Yes / No
- Notes: _______

---

### Step 8 — Backend: CORS for custom domain
**Status**: Pending

The Express backend needs to accept API requests from `https://carolearts.com` and `https://www.carolearts.com`. Currently `CORS_ORIGIN` is set to `https://www.prosaurus.com`.

Options:
- Add `carolearts.com` origins to the allowed list explicitly
- OR: query the database dynamically on each request to check if the Origin header matches any known custom domain

- Approach chosen: _______
- Tested: Yes / No
- Notes: _______

---

### Step 9 — End-to-end test
**Status**: Pending

- [ ] `https://carolearts.com` loads without redirect
- [ ] URL bar stays at `carolearts.com`
- [ ] Correct user profile / content is shown
- [ ] SSL padlock is green
- [ ] API calls work (no CORS errors in console)
- [ ] `https://www.carolearts.com` also works

Notes: _______

---

## Issues Encountered

_Append issues here as they come up during the process._

---

## Final Working Config

_Once everything is confirmed working, summarize the exact commands and configs that succeeded. This becomes the basis for automation._

---

## Automation Notes

_After completion, note which steps could be scripted and what the trigger should be (e.g., artist enters domain in settings → server auto-provisions)._
