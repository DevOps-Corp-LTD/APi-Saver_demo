#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:-${1:-}}"
EMAIL="${EMAIL:-${2:-}}"

if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "Usage: DOMAIN=apisaver.example.com EMAIL=admin@example.com ./scripts/init-ssl.sh"
  exit 1
fi

mkdir -p certbot/conf certbot/www nginx/conf.d

docker-compose run --rm certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN"

docker-compose restart nginx

