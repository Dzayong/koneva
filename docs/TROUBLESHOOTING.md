# WA Gateway Troubleshooting Guide

Verified against a real Kind cluster (`kind-wa-gateway`) and a real Docker
Compose stack in this repo — every command below was actually run during
this pass, not copied from a generic template. Where a fix is still open at
the time of writing, it's marked **OPEN** with the live evidence that proves
it, not just a hypothesis.

## Kind / Kubernetes

### 1. api-gateway pod stuck 0/1 Running, restart count climbing (OPEN as of 2026-09-25)

**Symptom:**

```
kubectl get pods -n wa-gateway
NAME                          READY   STATUS    RESTARTS   AGE
api-gateway-76d969cb5c-xxxxx  0/1     Running   3          3m
device-manager-yyyyyyyyy-zzz  1/1     Running   0          3m
```

`kubectl describe pod <api-gateway-pod> -n wa-gateway` shows:

```
Warning  Unhealthy  Liveness probe failed: Get "http://<ip>:8000/health": dial tcp <ip>:8000: connect: connection refused
Warning  Unhealthy  Readiness probe failed: Get "http://<ip>:8000/ready": dial tcp <ip>:8000: connect: connection refused
```

Pod status says `Running`, not `CrashLoopBackOff`, which is misleading — the
container process itself isn't crashing, it's just not listening on the port
Kubernetes expects.

**Diagnosis — confirm before doing anything else:**

```bash
kubectl logs -n wa-gateway <api-gateway-pod-name>
```

If the log line reads `"Device Manager listening" ... "port":8001` instead
of `"API Gateway listening on port 8000"`, the api-gateway Deployment is
running **device-manager's** code.

**Cause:** `docker/app.Dockerfile` is multi-stage with named targets
`api-gateway` and `device-manager`. Without `--target`, Docker builds the
*last* stage in the file by default — which is `device-manager`. If
`wa-gateway-api:latest` was ever built with a plain
`docker build -f docker/app.Dockerfile -t wa-gateway-api:latest .` (no
`--target`), that tag's baked-in `CMD` runs `dist/src/device-manager/index.js`
regardless of which Deployment pulls it.

`k8s/device-manager/deployment.yaml` already guards against this with an
explicit `command: ["node", "dist/src/device-manager/index.js"]` override —
so the device-manager Deployment is correct no matter which target the image
was built from. `k8s/api-gateway/deployment.yaml` has **no** command
override, so it silently inherits whatever the image's default `CMD` is.
This is why device-manager can look healthy while api-gateway fails: it's
not a coincidence, one Deployment defends against the wrong image and the
other doesn't.

**Fix:**

```bash
# Rebuild with the correct target explicitly — do not omit --target.
docker build -f docker/app.Dockerfile --target api-gateway -t wa-gateway-api:latest .
kind load docker-image wa-gateway-api:latest --name wa-gateway
kubectl rollout restart deployment/api-gateway -n wa-gateway
kubectl rollout status deployment/api-gateway -n wa-gateway
```

Then confirm the log line actually changed (don't trust `Running` status
alone):

```bash
kubectl logs -n wa-gateway -l app=api-gateway --tail=5
# expect: "API Gateway listening on port 8000"
```

**Longer-term fix to consider:** add the same defensive `command` override
to `k8s/api-gateway/deployment.yaml` that `device-manager`'s already has, so
a future rebuild without `--target` fails loud (wrong port, probe failure)
instead of silently working for one Deployment and not the other by luck of
which target happened to be built last.

### 2. PodSecurity "restricted" rejection (fixed this session, keep for reference)

**Symptom:**

```
Warning  FailedCreate  replicaset/api-gateway-xxx  Error creating: pods "api-gateway-xxx-yyy" is forbidden:
violates PodSecurity "restricted:latest": allowPrivilegeEscalation != false (container "api-gateway" must set
securityContext.allowPrivilegeEscalation=false), unrestricted capabilities (container "api-gateway" must set
securityContext.capabilities.drop=["ALL"]), runAsNonRoot != true, seccompProfile ...
```

No pod is created at all — `kubectl get pods -n wa-gateway` won't show it,
you have to check `kubectl get events` or the ReplicaSet.

**Cause:** the `wa-gateway` namespace enforces the Kubernetes
`restricted` Pod Security Standard (intentional — see
`docs/DEPLOYMENT.md`). Every container needs pod- and container-level
`securityContext` matching it; there's no way to relax this for one
Deployment without opting the whole namespace out, which is not being done
here on purpose.

**Fix** (already applied to `k8s/api-gateway/deployment.yaml` and
`k8s/device-manager/deployment.yaml` — shown here as the reference pattern,
copied from `k8s/redis/statefulset.yaml`'s working config):

```yaml
spec:
  template:
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        runAsGroup: 10001
        fsGroup: 10001
        seccompProfile:
          type: RuntimeDefault
      containers:
      - name: <container-name>
        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: false   # true if the app never writes to disk
          capabilities:
            drop: [ALL]
```

If you still see this error after adding the block above, check indentation
— it must be under `spec.template.spec` (pod-level) and
`spec.template.spec.containers[].securityContext` (container-level)
separately; putting only one of the two is the most common repeat of this
mistake.

### 3. ImagePullBackOff / ErrImageNeverPull

**Symptom:**

```
kubectl get pods -n wa-gateway
NAME                          READY   STATUS             RESTARTS   AGE
api-gateway-xxx               0/1     ErrImageNeverPull  0          2m
```

**Cause:** every Deployment here uses `imagePullPolicy: Never` (correct for
local Kind — there's no registry), which means the exact `image:` name+tag
must already exist on the Kind node. It doesn't pull automatically.

**Fix:**

```bash
# Confirm what's actually on the node first:
docker exec wa-gateway-control-plane crictl images | grep wa-gateway

# If missing or wrong, rebuild + load:
docker build -f docker/app.Dockerfile --target api-gateway -t wa-gateway-api:latest .
docker build -f docker/bot-container.Dockerfile -t wa-bot:latest .
kind load docker-image --name wa-gateway wa-gateway-api:latest wa-bot:latest
kubectl rollout restart deployment -n wa-gateway --all
```

`kind load docker-image` only pushes into the named cluster's nodes, and it
has to be re-run after every rebuild — the image ID changes even if the tag
doesn't, and Kind won't detect that on its own.

### 4. Database / cache pod "not ready" checks report success incorrectly

**Don't trust a bare exit-code check for Redis.** `k8s/redis/statefulset.yaml`
sets `--requirepass $(REDIS_PASSWORD)`. A plain
`kubectl exec redis-0 -n wa-gateway -- redis-cli ping` returns
`NOAUTH Authentication required.` **with exit code 0** — a script that only
checks `$?` will report Redis as healthy when it actually rejected the
command. Use the same pattern the StatefulSet's own probes use (the password
is already an env var inside the pod — this never prints or decodes the
secret):

```bash
kubectl exec -n wa-gateway redis-0 -- sh -c 'REDISCLI_AUTH=$REDIS_PASSWORD redis-cli ping'
# expect exactly: PONG
```

PostgreSQL's `pg_isready` doesn't have this footgun — a plain exit-code
check is fine:

```bash
kubectl exec -n wa-gateway postgres-0 -- pg_isready -U wagateway
```

**Also note the label key:** postgres/redis StatefulSets label pods with
`app.kubernetes.io/name` (e.g. `app.kubernetes.io/name=postgres`), while
api-gateway/device-manager Deployments use the plain `app` key (e.g.
`app=api-gateway`). A selector written for one style against the other
resource returns nothing — `kubectl get pod -l app=postgres` will silently
find zero pods even though `postgres-0` is running fine.

### 5. HorizontalPodAutoscaler can't read CPU metrics

**Symptom:**

```
kubectl get events -n wa-gateway
Warning  FailedGetResourceMetric  horizontalpodautoscaler/api-gateway
  failed to get cpu utilization: unable to get metrics for resource cpu:
  unable to fetch metrics from resource metrics API: the server could not find the requested resource (get pods.metrics.k8s.io)
```

**Cause:** stock `kind create cluster` doesn't install `metrics-server`.
This is expected/harmless for local dev — it doesn't block deployments or
pods from running, it just means the HPA can't scale on CPU until
metrics-server exists.

**Fix (only if you actually need HPA to work locally):**

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
# Kind's self-signed kubelet certs need this patch, or metrics-server crash-loops:
kubectl patch deployment metrics-server -n kube-system --type=json \
  -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
```

### 6. Pods not running / stuck Pending

**Diagnosis order** (cheapest signal first):

```bash
kubectl get events -n wa-gateway --sort-by='.lastTimestamp'   # what actually happened, in order
kubectl describe pod <pod-name> -n wa-gateway                  # scheduling + probe detail
kubectl logs <pod-name> -n wa-gateway                          # what the process itself said
kubectl logs <pod-name> -n wa-gateway --previous               # if it already restarted
```

Common causes in this repo specifically: PodSecurity rejection (#2 — pod
never gets created, only visible in events, not `get pods`), wrong image
target (#1), missing ConfigMap/Secret key (`kubectl get configmap
wa-gateway-config -n wa-gateway -o yaml` / same for the secret, to confirm
keys exist — don't print secret *values* into a shared terminal/log).

## Docker Compose (local dev, `docker/docker-compose.yml`)

### 7. `npm run dev` / `npm run dev:manager` connect errors to Postgres or Redis

```bash
docker compose -f docker/docker-compose.yml ps
docker compose -f docker/docker-compose.yml logs postgres redis
```

Both containers report `healthy` in `docker compose ps` once their
healthchecks pass; a plain `Up` without `(healthy)` a few seconds after
`docker compose up -d` usually means the healthcheck hasn't run yet, not
that something is broken — wait a couple seconds before assuming failure.

### 8. `DEVICE_OFFLINE` / 409 or 503 on `POST /api/v1/message/send`

This is **expected**, not a bug, whenever the target device has no live
Baileys session (no QR scanned, or the bot-container isn't running). Check
device status first:

```bash
curl -s -H "apikey: <tenant-key>" http://localhost:8000/api/v1/devices | jq '.data[] | {device_key, status}'
```

Only investigate further if `status` says `online` and sends still fail —
that would be a real bug, not the expected offline case.

## General debug commands (Kind)

```bash
kubectl get all -n wa-gateway
kubectl get events -n wa-gateway --sort-by='.lastTimestamp'
kubectl logs -f <pod-name> -n wa-gateway
kubectl exec -it <pod-name> -n wa-gateway -- /bin/sh
kubectl port-forward -n wa-gateway svc/<service-name> <local-port>:<remote-port>
kubectl top pods -n wa-gateway     # needs metrics-server, see #5
docker exec wa-gateway-control-plane crictl images   # what's actually loaded into the Kind node
```

## Getting help

1. `kubectl logs <pod> -n wa-gateway` — what the process actually said.
2. `kubectl describe <resource> <name> -n wa-gateway` — why Kubernetes
   didn't do what you expected.
3. `kubectl get events -n wa-gateway --sort-by='.lastTimestamp'` — the
   timeline, especially for pods that were never created at all (#2).
4. `docs/DEPLOYMENT.md`, `docs/ARCHITECTURE.md`, `scripts/verify-kind.sh`
   (run it — it applies manifests in dependency order, fails loudly on
   PodSecurity warnings, and checks both services' `/health` through a real
   port-forward).
