#!/bin/sh
DOMAIN="${DOMAIN:-localhost}"
SSL_CERT_PATH="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
SSL_KEY_PATH="/etc/letsencrypt/live/${DOMAIN}/privkey.pem"
if [ -f "$SSL_CERT_PATH" ] && [ -f "$SSL_KEY_PATH" ]; then
  echo "SSL certificates found - enabling HTTPS"
  envsubst '${DOMAIN}' < /etc/nginx/templates/default-https.conf.template > /etc/nginx/conf.d/default.conf
else
  echo "SSL certificates not found - HTTP only"
  envsubst '${DOMAIN}' < /etc/nginx/templates/default-http.conf.template > /etc/nginx/conf.d/default.conf
fi
echo "Nginx configuration generated successfully"
