# WA Gateway Production Deployment

This guide deploys PostgreSQL, Redis, three API Gateway replicas behind Nginx,
one Device Manager, dynamic bot containers, TLS renewal, monitoring, and backup.

## Prerequisites

- Ubuntu/Debian server with at least 4 CPU cores, 8 GB RAM, and 50 GB free disk.
- Docker Engine 24+ with Compose v2.
- A domain whose A/AAAA record points to the server.
- Ports 22, 80, and 443 open. Keep 3000, 9090, 9093, 3100, 5432, and 6379 private.
- SSH key access for the deployment user and permission to use Docker.
- Local `docker`, `ssh`, `rsync`, `curl`, and `openssl` commands.
- Optional: a container registry and AWS CLI credentials for S3 backups.

## 1. Configure production values

`.env.production` contains locally generated random credentials and is ignored by
Git. Before deployment, replace the example domain and email:

```bash
sed -i 's/wa.example.com/wa.your-domain.com/' .env.production
sed -i 's/admin@example.com/ops@your-domain.com/' .env.production
```

Review `SESSION_HOST_PATH` and ensure it is on persistent storage. Never commit,
paste into tickets, or send `.env.production`. To make a new file, copy
`.env.production.example` and generate each secret with `openssl rand -hex 32`
or stronger.

Deployment connection values are supplied in the shell, not committed:

```bash
export DEPLOY_HOST=203.0.113.10
export DEPLOY_USER=deploy
export DEPLOY_PATH=/opt/wa-gateway
export REGISTRY_PREFIX=
```

## 2. Prepare the server

```bash
sudo install -d -m 0750 -o "$USER" -g docker /opt/wa-gateway
sudo install -d -m 0770 -o "$USER" -g docker /opt/wa-gateway/sessions
docker version
docker compose version
```

The deployment user must be in the `docker` group. Log out and back in after
adding it. DNS must resolve before requesting the first Let's Encrypt certificate.

## 3. Deploy

```bash
./scripts/deploy.sh deploy
```

The script builds the three images, pushes or transfers them, preserves remote
certificates and sessions, obtains the initial TLS certificate, runs migrations,
starts both stacks, and checks `https://$DOMAIN/health`. A failed health check
automatically rolls back.

Verify manually:

```bash
curl --fail https://wa.your-domain.com/health
ssh "$DEPLOY_USER@$DEPLOY_HOST" \
  "cd /opt/wa-gateway && docker compose --env-file .env.production --env-file .deployment.env -f docker/docker-compose.prod.yml ps"
```

API replicas are private and discoverable as `api-gateway`; only Nginx publishes
ports 80/443. Device Manager mounts `/var/run/docker.sock` and launches bot
containers on `wa-gateway-backend`. Treat it as a privileged service.

## 4. Monitoring

The monitoring stack includes Prometheus, Alertmanager, Grafana, Loki, Promtail,
node-exporter, cAdvisor, and database exporters. Its UIs bind to localhost only.

```bash
ssh -L 3000:127.0.0.1:3000 -L 9090:127.0.0.1:9090 \
  "$DEPLOY_USER@$DEPLOY_HOST"
```

Open Grafana at `http://localhost:3000` and Prometheus at
`http://localhost:9090`. Configure a real Alertmanager receiver in
`docker/monitoring/alertmanager.yml`; the default receiver stores alerts without
sending them externally.

## 5. Backups

```bash
./scripts/backup.sh
```

The script archives PostgreSQL, Redis, and WhatsApp sessions, writes a SHA-256
checksum, removes local backups older than `BACKUP_RETENTION_DAYS` (default 7),
and uploads to S3 when `S3_BUCKET` is set. Example server cron:

```cron
15 2 * * * cd /opt/wa-gateway && ./scripts/backup.sh >> /var/log/wa-gateway-backup.log 2>&1
```

Test restoration quarterly. A backup that has never been restored is unverified.

## 6. Rollback

```bash
./scripts/deploy.sh rollback
./scripts/deploy.sh rollback 20260924153000
```

The first command uses `.previous-release`; the second selects an explicit tag.
Database migrations are forward-only. Rollback changes application images but
does not reverse schema migrations.

## Troubleshooting

### Nginx fails because the certificate is missing

Confirm DNS and ports 80/443, then request the certificate manually:

```bash
docker run --rm -p 80:80 \
  -v "$PWD/docker/certbot/conf:/etc/letsencrypt" \
  certbot/certbot:v3.1.0 certonly --standalone --agree-tos \
  --non-interactive -m ops@your-domain.com -d wa.your-domain.com
```

### API Gateway is unhealthy

```bash
docker compose --env-file .env.production --env-file .deployment.env \
  -f docker/docker-compose.prod.yml logs --tail=200 api-gateway
docker compose --env-file .env.production --env-file .deployment.env \
  -f docker/docker-compose.prod.yml run --rm migrate
```

### Bot cannot reach PostgreSQL or Redis

```bash
docker inspect wa-bot-wapi-example --format '{{json .NetworkSettings.Networks}}'
docker network inspect wa-gateway-backend
```

### Device Manager cannot access Docker

```bash
stat -c '%g %A' /var/run/docker.sock
docker compose --env-file .env.production --env-file .deployment.env \
  -f docker/docker-compose.prod.yml logs device-manager
```

### PostgreSQL or Redis is unhealthy

```bash
docker compose --env-file .env.production --env-file .deployment.env \
  -f docker/docker-compose.prod.yml logs postgres redis
df -h
```

Do not delete named volumes unless a verified backup exists and data loss is
explicitly intended.
