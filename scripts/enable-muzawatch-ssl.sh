#!/bin/bash
# Issue the muzawatch.com certificate and switch the vhost to HTTPS.
#
# Run AFTER the Namecheap A records point at this server (95.111.232.148):
#   A  @    -> 95.111.232.148
#   A  www  -> 95.111.232.148
#   A  api  -> 95.111.232.148
#
# Safe to run repeatedly: it stops cleanly at whichever step is not ready yet.
# certbot must reload NGINX, never Apache — nginx owns 80/443 on this box.
set -euo pipefail

IP=95.111.232.148
DOMAINS=(muzawatch.com www.muzawatch.com api.muzawatch.com)

for d in "${DOMAINS[@]}"; do
  got=$(dig +short A "$d" @1.1.1.1 | head -1)
  if [ "$got" != "$IP" ]; then
    echo "DNS not ready: $d resolves to '${got:-nothing}', need $IP. Fix the A records at Namecheap first." >&2
    exit 1
  fi
done
echo "DNS OK for: ${DOMAINS[*]}"

certbot certonly --webroot -w /var/www/html \
  $(printf ' -d %s' "${DOMAINS[@]}") \
  --non-interactive --agree-tos -m shafficmuza@gmail.com \
  --deploy-hook 'systemctl reload nginx'

# Swap the HTTP-only vhost for the full one, mirroring ham's TLS settings.
cat > /etc/nginx/sites-available/muzawatch.com <<'NGINX'
# muzawatch.com — Muza Watch, the public production domain.
# Same upstreams as ham.sentepos.com: one deployment, two names. ham must stay
# on these upstreams until no installed app still hard-codes it as API base.
server {
    listen 80;
    listen [::]:80;
    server_name muzawatch.com www.muzawatch.com api.muzawatch.com;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name muzawatch.com www.muzawatch.com api.muzawatch.com;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_certificate     /etc/letsencrypt/live/muzawatch.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/muzawatch.com/privkey.pem;

    access_log /var/log/nginx/muzawatch.com.access.log;
    error_log  /var/log/nginx/muzawatch.com.error.log;

    client_max_body_size 0;
    proxy_read_timeout   3600s;
    proxy_send_timeout   3600s;
    proxy_request_buffering off;

    location /api/ {
        proxy_pass         http://127.0.0.1:4010/;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host       $host;
        proxy_set_header   X-Real-IP  $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass         http://127.0.0.1:4011;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host       $host;
        proxy_set_header   X-Real-IP  $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
NGINX

nginx -t && systemctl reload nginx
echo
echo "https://muzawatch.com is live."
