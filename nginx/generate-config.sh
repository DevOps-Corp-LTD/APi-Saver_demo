#!/bin/sh
DOMAIN="${DOMAIN:-localhost}"
export DOMAIN
SSL_CERT_PATH="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
SSL_KEY_PATH="/etc/letsencrypt/live/${DOMAIN}/privkey.pem"
if [ -f "$SSL_CERT_PATH" ] && [ -f "$SSL_KEY_PATH" ]; then
  echo "SSL certificates found - enabling HTTPS"
  if command -v envsubst >/dev/null 2>&1; then
    envsubst '${DOMAIN}' < /etc/nginx/templates/default-https.conf.template > /etc/nginx/conf.d/default.conf
  else
    sed "s|\${DOMAIN}|${DOMAIN}|g" /etc/nginx/templates/default-https.conf.template > /etc/nginx/conf.d/default.conf
  fi
else
  echo "SSL certificates not found - HTTP only"
  if command -v envsubst >/dev/null 2>&1; then
    envsubst '${DOMAIN}' < /etc/nginx/templates/default-http.conf.template > /etc/nginx/conf.d/default.conf
  else
    sed "s|\${DOMAIN}|${DOMAIN}|g" /etc/nginx/templates/default-http.conf.template > /etc/nginx/conf.d/default.conf
  fi
fi
echo "Nginx configuration generated successfully"
