#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/personal-common.sh"
personal_load
domain="${DOMAIN:-localhost}"
[[ $domain =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || die 'DOMAIN must be a DNS hostname.'
https_port="${HTTPS_PORT:-443}"
[[ $https_port =~ ^[0-9]{1,5}$ ]] && ((https_port > 0 && https_port < 65536)) || die 'HTTPS_PORT must be between 1 and 65535.'
config_dir="$PERSONAL_ROOT/docker/nginx/generated"
mkdir -p "$config_dir"
tls=false
if [[ -f $PERSONAL_ROOT/docker/nginx/ssl/live/$domain/fullchain.pem && -f $PERSONAL_ROOT/docker/nginx/ssl/live/$domain/privkey.pem ]]; then tls=true; fi
{
  cat <<EOF
server {
    listen 80;
    server_name $domain;
    location = /nginx-health { access_log off; return 200 'ok'; }
    location ^~ /.well-known/acme-challenge/ { root /var/www/certbot; }
EOF
  if $tls; then
    redirect_target="https://$domain\$request_uri"
    if [[ $https_port != 443 ]]; then redirect_target="https://$domain:$https_port\$request_uri"; fi
    cat <<EOF
    location / { return 301 $redirect_target; }
}
server {
    listen 443 ssl;
    http2 on;
    server_name $domain;
    ssl_certificate /etc/letsencrypt/live/$domain/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$domain/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
EOF
  fi
  cat <<'EOF'
    location /admin { return 404; }
    # DOKU posts signed notifications outside the tenant API prefix. Route this exact endpoint
    # to the gateway (not the dashboard) so verified top-ups reach the personal database.
    location = /billing/doku/notify {
        set $api http://api-gateway:8000;
        proxy_pass $api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 90s;
    }
    location /api/v1/ {
        set $api http://api-gateway:8000;
        proxy_pass $api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 90s;
    }
    location / {
        set $dashboard http://dashboard:3000;
        proxy_pass $dashboard;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 90s;
    }
}
EOF
} > "$config_dir/site.conf.tmp"
mv "$config_dir/site.conf.tmp" "$config_dir/site.conf"
echo "Rendered nginx configuration (TLS=$tls)."
