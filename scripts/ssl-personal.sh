#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/personal-common.sh"
personal_load
personal_lock
[[ ${DOMAIN:-localhost} != localhost && -n ${EMAIL:-} ]] || die 'Set a real DOMAIN and EMAIL in .env.personal.'
"$PERSONAL_ROOT/scripts/render-personal-nginx.sh"
"${COMPOSE[@]}" --profile with-nginx up -d --wait nginx
case "${1:-issue}" in
  issue)
    "${COMPOSE[@]}" run --rm certbot certonly --webroot -w /var/www/certbot \
      --non-interactive --agree-tos --email "$EMAIL" -d "$DOMAIN"
    ;;
  renew)
    "${COMPOSE[@]}" run --rm certbot renew --webroot -w /var/www/certbot --non-interactive
    ;;
  *) die 'Usage: ssl-personal.sh issue|renew' ;;
esac
"$PERSONAL_ROOT/scripts/render-personal-nginx.sh"
"${COMPOSE[@]}" exec -T nginx nginx -t
"${COMPOSE[@]}" exec -T nginx nginx -s reload
