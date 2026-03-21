#!/bin/bash
# Deploy to dev.prosaurus.com
# Builds frontend (with dev env vars), pushes backend Docker image as :latest,
# copies files to EC2, and restarts the dev backend container.
#
# Usage: ./deploy-dev.sh
# Prerequisites: Docker running, SSH key at ~/.ssh/Hostgator-Key-1.pem, Docker Hub login active

set -e

EC2_HOST="ec2-user@44.225.148.34"
EC2_KEY="$HOME/.ssh/Hostgator-Key-1.pem"
EC2_FRONTEND_PATH="/var/www/dev.prosaurus.com"

echo "=== [1/5] Building frontend for dev ==="
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$(pwd -W)/frontend:/app" \
  -w /app \
  node:24.2.0-alpine \
  sh -c "npm install && npm run build -- --mode dev"

echo "=== [2/5] Building and pushing backend Docker image as :latest ==="
docker build -t dallascaley/breakroom-backend:latest ./backend
docker push dallascaley/breakroom-backend:latest

echo "=== [3/5] Copying frontend dist to EC2 ==="
ssh -i "$EC2_KEY" "$EC2_HOST" "sudo chown -R ec2-user:ec2-user $EC2_FRONTEND_PATH"
scp -i "$EC2_KEY" -r frontend/dist/* "$EC2_HOST:$EC2_FRONTEND_PATH/"

echo "=== [4/5] Copying docker-compose.dev.yml to EC2 ==="
scp -i "$EC2_KEY" docker-compose.dev.yml "$EC2_HOST:~/"

echo "=== [5/5] Restarting dev backend on EC2 ==="
ssh -i "$EC2_KEY" "$EC2_HOST" \
  "docker compose --project-name dev -f docker-compose.dev.yml --env-file .env.dev pull && \
   docker compose --project-name dev -f docker-compose.dev.yml --env-file .env.dev up -d --force-recreate"

echo ""
echo "=== Done! Dev environment updated at https://dev.prosaurus.com ==="
