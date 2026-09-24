# WA Gateway - Project Vision & Roadmap

## 🎯 Tujuan Akhir
Platform WhatsApp API Gateway **Enterprise-grade** untuk bisnis:
- Multi-tenant SaaS (seperti Wapisender/Cekat.AI)
- Kubernetes orchestration (Fase 4)
- Production-ready dengan monitoring, backup, security
- Revenue-generating dengan billing & quota system

## 🏗️ Arsitektur Target (Fase 4 - Enterprise)
┌─────────────────────────────────────────┐
│         Cloud Load Balancer             │
│         (Cloudflare / AWS ALB)          │
├─────────────────────────────────────────┤
│         Kubernetes Cluster              │
│  ┌─────────────────────────────────┐    │
│  │  Namespace: wa-gateway          │    │
│  │  ├── Deployment: api-gateway    │    │  ← 3 replicas
│  │  ├── Deployment: device-manager │    │  ← 1 replica
│  │  ├── StatefulSet: bot-pods      │    │  ← Dynamic per device
│  │  ├── Ingress: external access   │    │  ← SSL termination
│  │  └── HPA: auto-scaling          │    │
│  └─────────────────────────────────┘    │
├─────────────────────────────────────────┤
│         Managed Services                │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐  │
│  │PostgreSQL│ │ Redis   │ │ S3/     │  │
│  │(Cloud SQL│ │(Memory  │ │GCS     │  │
│  │/RDS)     │ │Store)   │ │(backup)│  │
│  └─────────┘ └─────────┘ └─────────┘  │
├─────────────────────────────────────────┤
│         Observability                   │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐  │
│  │Prometheus│ │Grafana  │ │Loki    │  │
│  │(metrics)│ │(dashboard)│ │(logs) │  │
│  └─────────┘ └─────────┘ └─────────┘  │
└─────────────────────────────────────────┘
plain

## 📋 Feature Checklist (Final)

### Core Features
- [x] Multi-tenant (API key per tenant)
- [x] Device management (CRUD)
- [x] Message queue (BullMQ)
- [x] Webhook dispatcher (HMAC signed)
- [x] Anti-ban system (warm-up, rate limit, content filter)
- [x] Health score tracking
- [x] Dashboard (Next.js)

### Enterprise Features (In Progress)
- [ ] Kubernetes manifests (StatefulSet, Deployment, Ingress)
- [ ] Horizontal Pod Autoscaler (HPA)
- [ ] Pod Disruption Budget (PDB)
- [ ] Network Policies
- [ ] Secrets management (K8s Secrets + External Secrets)
- [ ] Monitoring (Prometheus + Grafana + Loki)
- [ ] Distributed tracing (Jaeger/Tempo)
- [ ] Backup automation (PostgreSQL + Redis + Sessions)
- [ ] CI/CD pipeline (GitHub Actions/GitLab CI)
- [ ] Infrastructure as Code (Terraform/Pulumi)

### Business Features
- [ ] Billing integration (Stripe/Xendit)
- [ ] Quota management per tenant
- [ ] Usage analytics
- [ ] Tiered pricing (Starter/Pro/Enterprise)
- [ ] White-label option

## 🗂️ File Structure (Target)
wa-gateway/
├── k8s/                          # Kubernetes manifests
│   ├── namespace.yaml
│   ├── secrets.yaml
│   ├── configmap.yaml
│   ├── postgres/
│   ├── redis/
│   ├── api-gateway/
│   ├── device-manager/
│   ├── bot-template/
│   └── monitoring/
├── services/                     # Backend services
│   ├── api-gateway/              # REST API (port 8000)
│   ├── device-manager/           # K8s controller (port 8001)
│   └── bot-container/            # WhatsApp bot (port 9000)
├── dashboard/                    # Next.js frontend
├── scripts/                      # Automation
│   ├── deploy.sh
│   ├── backup.sh
│   └── migrate.sh
├── docs/                         # Documentation
│   ├── PROJECT_VISION.md         # File ini
│   ├── ARCHITECTURE.md
│   ├── API.md
│   └── RUNBOOK.md
└── .github/                      # CI/CD workflows
└── workflows/
plain

## 🔧 Port Allocation

| Service | Port | Protocol |
|---------|------|----------|
| API Gateway | 8000 | HTTP |
| Device Manager | 8001 | HTTP |
| Bot Container | 9000 | HTTP |
| PostgreSQL | 5432 | TCP |
| Redis | 6379 | TCP |
| Prometheus | 9090 | HTTP |
| Grafana | 3000 | HTTP |

## 🔄 Data Flow
Client → API Gateway (8000) → Redis Queue → Bot Container (9000) → WhatsApp
↓                    ↓              ↓
PostgreSQL          BullMQ        PostgreSQL (status)
↓                    ↓              ↓
Webhook ←────────── Webhook ←────── Webhook
plain

## 🛡️ Security Requirements

- [ ] TLS everywhere (Let's Encrypt)
- [ ] Network Policies (deny by default)
- [ ] Pod Security Standards (restricted)
- [ ] Secrets encryption at rest
- [ ] RBAC (least privilege)
- [ ] Image vulnerability scanning
- [ ] Runtime security (Falco)

## 📊 Monitoring Requirements

- [ ] Metrics: Prometheus + Grafana
- [ ] Logs: Loki + Promtail
- [ ] Tracing: Jaeger/Tempo
- [ ] Alerting: Alertmanager → Slack/PagerDuty
- [ ] Uptime: Blackbox exporter
- [ ] SLO/SLA tracking

## 🚀 Deployment Strategy

1. **Development**: Docker Compose (local)
2. **Staging**: K8s single node (minikube/k3d)
3. **Production**: K8s multi-node (GKE/EKS/AKS)

## 💰 Cost Estimation (Production)

| Component | Monthly Cost |
|-----------|-------------|
| GKE Cluster (3 nodes) | $400-600 |
| Cloud SQL (PostgreSQL) | $200-400 |
| MemoryStore (Redis) | $100-200 |
| Load Balancer | $20-50 |
| Storage (100GB) | $20-50 |
| Monitoring | $50-150 |
| **Total** | **$790-1,450** |

## 📅 Timeline (12 Weeks)

| Week | Milestone |
|------|-----------|
| 1-2 | Core services (API, Bot, Device Manager) |
| 3-4 | Dashboard + Anti-ban system |
| 5-6 | K8s manifests + Local testing |
| 7-8 | Monitoring + Security |
| 9-10 | Staging deployment + Testing |
| 11-12 | Production deployment + Documentation |

## 🤝 Team Coordination

### Codex Responsibilities
- Backend services (API Gateway, Device Manager)
- Database schema & migrations
- Kubernetes manifests
- Deployment scripts
- Infrastructure as Code

### Claude Responsibilities
- Bot Container (Baileys integration)
- Anti-ban system
- Dashboard (Next.js)
- Documentation
- Testing

### Shared Understanding
- Baca `PROJECT_VISION.md` sebelum coding
- Update `docs/ARCHITECTURE.md` untuk perubahan besar
- Commit message: `feat(scope): description`
- PR review wajib sebelum merge

## 📝 API Specification

### Tenant API (apikey auth)
POST   /api/v1/message/send
GET    /api/v1/messages
GET    /api/v1/messages/:id
GET    /api/v1/devices
GET    /api/v1/devices/:deviceKey
GET    /api/v1/devices/:deviceKey/qr
POST   /api/v1/devices/:deviceKey/pause
POST   /api/v1/devices/:deviceKey/resume
plain

### Admin API (admin key auth)
POST   /admin/tenant/create
GET    /admin/tenants
POST   /admin/device/create
POST   /admin/device/:key/delete
GET    /admin/devices
GET    /admin/stats
plain

## 🗄️ Database Schema

### tenants
- id (UUID, PK)
- name, email, api_key (unique)
- webhook_url, webhook_secret
- max_devices, quota_messages, used_messages
- status (active/suspended/deleted)
- created_at, updated_at

### devices
- id (UUID, PK)
- tenant_id (FK)
- device_key (unique), phone_number, label
- container_id, container_port
- status (offline/starting/pending_qr/online/paused/banned/error)
- qr_code, health_score
- last_connected, created_at, updated_at

### messages
- id (UUID, PK)
- tenant_id, device_id, device_key
- to_number, content, type
- status (queued/sending/sent/delivered/read/failed/blocked)
- external_id, whatsapp_message_id, error_message
- created_at, sent_at, delivered_at, read_at

### webhook_logs
- id (UUID, PK)
- tenant_id, event_type, payload (JSONB)
- response_status, response_body, retry_count
- created_at

## 🔐 Environment Variables

### Required
- DATABASE_URL: PostgreSQL connection string
- REDIS_URL: Redis connection string
- JWT_SECRET: JWT signing secret
- ADMIN_API_KEY: Admin API authentication

### Optional
- NODE_ENV: development/staging/production
- LOG_LEVEL: debug/info/warn/error
- MAX_DEVICES_PER_TENANT: Default 3
- DEFAULT_QUOTA: Default 10000
- RATE_LIMIT_PER_MINUTE: Default 60
- BOT_IMAGE: Docker image for bot containers

## 🧪 Testing Strategy

### Unit Tests
- Services: business logic
- Utils: helper functions
- Middleware: auth, validation

### Integration Tests
- API endpoints
- Database operations
- Queue processing
- Webhook delivery

### E2E Tests
- Complete message flow
- Device lifecycle
- Error handling

### Load Tests
- k6 scripts
- 1000 messages/minute
- Measure latency, throughput

## 📚 Documentation

- `PROJECT_VISION.md`: This file
- `ARCHITECTURE.md`: System design
- `API.md`: API reference
- `RUNBOOK.md`: Operations guide
- `DEPLOYMENT.md`: Deployment steps

---

**Versi**: 1.0  
**Terakhir Update**: 2026-09-24  
**Owner**: Dzaki
