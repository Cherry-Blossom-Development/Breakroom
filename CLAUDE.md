# Breakroom Project - Claude Context

## Project Overview
Breakroom is a full-stack web application with:
- **Frontend**: Vue 3 + Vite (port 5173)
- **Backend**: Express.js + Node 24 (port 3000)
- **Database**: MariaDB (migrated from PostgreSQL)
- **Reverse Proxy**: Host nginx (not Docker)

## Recent Changes (Dec 28, 2025)

### Redis Socket.IO Adapter
- Added Redis as Socket.IO pub/sub adapter for cross-server socket communication
- Redis 6 installed on EC2 (44.225.148.34:6379) with password authentication
- Local development connects to EC2 Redis for seamless socket messaging between local and production
- New file: `backend/utilities/redis.js` - Redis connection utility
- Added `@socket.io/redis-adapter` and `redis` npm packages
- Environment variables: `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_KEY_PREFIX`
- **REDIS_KEY_PREFIX** isolates dev/prod socket channels on shared Redis (dev uses `dev`, prod defaults to `prod`)
- Extensible for multiple backend servers (horizontal scaling)

## Recent Changes (Dec 25, 2025)

### PostgreSQL to MariaDB Migration
- Replaced `pg` package with `mysql2` in backend
- Rewrote `backend/utilities/db.js` with a MySQL connection pool that provides a pg-compatible wrapper (auto-converts `$1, $2` placeholders to `?`, returns `rows`/`rowCount`)
- Converted `data/1-user-auth.sql` to MariaDB syntax (AUTO_INCREMENT, TIMESTAMP, InnoDB)
- Updated route files to remove `RETURNING` clauses (MariaDB doesn't support them)
- Updated `build.sh` to use `docker compose` v2 instead of `docker-compose`

### Docker Setup
- Removed reverse-proxy container from `docker-compose.local.yml` (using host nginx instead)
- Added environment variables to docker-compose: `VITE_ALLOWED_HOST`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME`, `CORS_ORIGIN`

### Host Nginx Setup
- Created `nginx-host-local.conf` for host nginx configuration
- SSL certificates at `/etc/nginx/ssl/local.prosaurus.com.*` (self-signed)
- Config installed at `/etc/nginx/sites-available/local.prosaurus.com`

## Database Configuration

**MariaDB Server**: 44.225.148.34:3306
**Database**: breakroom
**User**: DCAdminUser

Tables:
- `users` - User accounts
- `groups` - Permission groups (5 seeded)
- `permissions` - Individual permissions (20 seeded)
- `user_permissions` - User-permission assignments
- `group_permissions` - Group-permission assignments
- `user_groups` - User-group assignments

## Local Development Setup

### Prerequisites
- Docker and docker-compose-v2 installed
- Host nginx running
- `/etc/hosts` entry: `127.0.0.1 local.prosaurus.com`

### Environment File
Create `.env.local` in project root (not committed to git):
```
VITE_API_BASE_URL=https://local.prosaurus.com
VITE_ALLOWED_HOST=local.prosaurus.com
NODE_ENV=development

DB_HOST=44.225.148.34
DB_PORT=3306
DB_USER=DCAdminUser
DB_PASS=<password>
DB_NAME=breakroom

CORS_ORIGIN=https://local.prosaurus.com

# Redis (Socket.IO adapter)
REDIS_HOST=44.225.148.34
REDIS_PORT=6379
REDIS_PASSWORD=<password>
REDIS_KEY_PREFIX=dev
```

### Running Locally
```bash
# Start Docker containers
./build.sh local up

# Stop containers
docker compose -f docker-compose.local.yml down
```

### Access
- **URL**: https://local.prosaurus.com
- Browser will trust the self-signed cert (added to system CA store)

## EC2 Production Deployment

**Server**: Amazon Linux (RHEL/Fedora-based) at 44.225.148.34
**Architecture**: Host nginx serves static frontend + proxies to Docker backend container

### Step 1: Install Docker (Amazon Linux)

```bash
# Install Docker
sudo dnf install -y docker
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker ec2-user

# Log out and back in for group changes to take effect
```

### Step 2: Configure DNS

Point your domain to EC2 public IP:
- `www.prosaurus.com` → `44.225.148.34`
- `prosaurus.com` → `44.225.148.34`

### Step 3: Set Up Nginx for the Site (Amazon Linux)

Create nginx config at `/etc/nginx/conf.d/prosaurus.com.conf`:

```nginx
server {
    listen 80;
    server_name www.prosaurus.com prosaurus.com;

    root /var/www/prosaurus.com;
    index index.html;

    location /.well-known/acme-challenge/ {
        root /var/www/prosaurus.com;
    }

    location / {
        return 200 'ready for certbot';
        add_header Content-Type text/plain;
    }
}
```

```bash
sudo mkdir -p /var/www/prosaurus.com
sudo nginx -t && sudo systemctl reload nginx
```

### Step 4: Get SSL Certificate

```bash
sudo dnf install -y certbot
sudo certbot certonly --webroot -w /var/www/prosaurus.com -d www.prosaurus.com -d prosaurus.com
```

### Step 5: Update Nginx for SSL + Reverse Proxy

Replace `/etc/nginx/conf.d/prosaurus.com.conf` with:

```nginx
server {
    listen 80;
    server_name www.prosaurus.com prosaurus.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name www.prosaurus.com prosaurus.com;

    ssl_certificate /etc/letsencrypt/live/www.prosaurus.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/www.prosaurus.com/privkey.pem;

    # Serve static frontend files
    root /var/www/prosaurus.com;
    index index.html;

    # Frontend routes - serve index.html for SPA
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API proxy to backend container
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

### Step 6: Build & Deploy from Dev Machine

**On dev machine (local VM):**

```bash
cd /home/hakr49/breakroom

# Build frontend using Docker (if npm not installed locally)
docker run --rm -v $(pwd)/frontend:/app -w /app node:24.2.0-alpine sh -c "npm install && npm run build"

# Push backend image to Docker Hub
docker login
docker push dallascaley/breakroom-backend:latest

# Copy frontend dist files to EC2
scp -i ~/.ssh/Hostgator-Key-1.pem -r frontend/dist/* ec2-user@44.225.148.34:/var/www/prosaurus.com/

# Copy docker-compose and env files to EC2
scp -i ~/.ssh/Hostgator-Key-1.pem docker-compose.ec2.yml ec2-user@44.225.148.34:~/
scp -i ~/.ssh/Hostgator-Key-1.pem .env.production ec2-user@44.225.148.34:~/.env
```

### Step 7: Start Backend Container on EC2

**On EC2 server:**

```bash
docker login
docker compose -f docker-compose.ec2.yml --env-file .env up -d
```

### Step 8: Verify Deployment

```bash
# Check container is running
docker ps

# Test backend locally
curl http://127.0.0.1:3000/api/auth/me
# Expected: {"message":"Not authenticated"}

# Test in browser
# https://www.prosaurus.com
```

### EC2 Security Group Configuration

In AWS Console, ensure security group allows:
| Type  | Port | Source    | Description           |
|-------|------|-----------|----------------------|
| HTTP  | 80   | 0.0.0.0/0 | Redirect to HTTPS    |
| HTTPS | 443  | 0.0.0.0/0 | Main application     |
| MySQL | 3306 | Outbound  | Database connection  |
| Redis | 6379 | Local VM IP/32 | Socket.IO adapter (local dev only) |

### Useful Commands (on EC2)

```bash
# View backend logs
docker logs ec2-user-backend-1 -f

# Restart backend
docker compose -f docker-compose.ec2.yml --env-file .env restart

# Stop backend
docker compose -f docker-compose.ec2.yml --env-file .env down

# Reload nginx after config changes
sudo nginx -t && sudo systemctl reload nginx
```

### Redeploying Updates

**From dev machine:**
```bash
# Rebuild frontend
docker run --rm -v $(pwd)/frontend:/app -w /app node:24.2.0-alpine sh -c "npm install && npm run build"

# Copy to EC2
scp -i ~/.ssh/Hostgator-Key-1.pem -r frontend/dist/* ec2-user@44.225.148.34:/var/www/prosaurus.com/

# For backend changes: rebuild image, push, then on EC2:
# docker compose -f docker-compose.ec2.yml --env-file .env pull
# docker compose -f docker-compose.ec2.yml --env-file .env up -d --force-recreate
```

## File Structure Notes
- `backend/utilities/db.js` - Database connection wrapper (MySQL2 with pg-compatible interface)
- `backend/utilities/redis.js` - Redis connection utility for Socket.IO adapter
- `backend/routes/` - API routes (authentication, user, group, permission)
- `data/1-user-auth.sql` - MariaDB schema with seed data
- `nginx-host-local.conf` - Host nginx config template
- `.env.local` - Local environment variables (gitignored)

## Known Issues / Notes
- The db.js wrapper auto-converts PostgreSQL `$1, $2` placeholders to MySQL `?` placeholders
- `RETURNING` clause not supported in MariaDB - queries fetch data separately after INSERT/UPDATE
- `groups` table name requires backticks in SQL (reserved word in MySQL)
- Docker containers need host.docker.internal or 172.17.0.1 to reach host services

## Git
- Repository: git@github.com:Cherry-Blossom-Development/Breakroom.git
- Branch: main
- `.env.local` removed from repo and added to `.gitignore`
