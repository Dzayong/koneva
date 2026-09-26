#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

NAMESPACE="${NAMESPACE:-wa-gateway}"
KIND_CLUSTER="${KIND_CLUSTER:-wa-gateway}"
API_LOCAL_PORT="${API_LOCAL_PORT:-18000}"
MANAGER_LOCAL_PORT="${MANAGER_LOCAL_PORT:-18001}"
RECREATE=false

usage() {
  echo "Usage: $0 [--recreate]"
  echo "  --recreate  delete and recreate the namespace before applying manifests"
}

case "${1:-}" in
  "") ;;
  --recreate) RECREATE=true ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

for command in kubectl kind docker curl; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done

context="$(kubectl config current-context)"
if [[ "$context" != "kind-$KIND_CLUSTER" ]]; then
  echo "Refusing to deploy to context '$context'; expected 'kind-$KIND_CLUSTER'." >&2
  exit 1
fi

for image in wa-gateway-api:latest wa-bot:latest; do
  docker image inspect "$image" >/dev/null 2>&1 || {
    echo "Local image '$image' is missing. Build it before verification." >&2
    exit 1
  }
done

echo "Loading local images into Kind cluster '$KIND_CLUSTER'..."
kind load docker-image --name "$KIND_CLUSTER" wa-gateway-api:latest wa-bot:latest

if $RECREATE && kubectl get namespace "$NAMESPACE" >/dev/null 2>&1; then
  echo "Deleting namespace '$NAMESPACE'..."
  kubectl delete namespace "$NAMESPACE" --wait=true
fi

apply_log="$(mktemp)"
pf_api_log="$(mktemp)"
pf_manager_log="$(mktemp)"
api_health_file="$(mktemp)"
manager_health_file="$(mktemp)"
api_pid=""
manager_pid=""
cleanup() {
  [[ -z "$api_pid" ]] || kill "$api_pid" 2>/dev/null || true
  [[ -z "$manager_pid" ]] || kill "$manager_pid" 2>/dev/null || true
  rm -f "$apply_log" "$pf_api_log" "$pf_manager_log" "$api_health_file" "$manager_health_file"
}
trap cleanup EXIT

apply() {
  kubectl apply -f "$1" 2>&1 | tee -a "$apply_log"
}

apply k8s/namespace.yaml
apply k8s/secrets.yaml
apply k8s/configmap.yaml
apply k8s/postgres/statefulset.yaml
apply k8s/redis/statefulset.yaml
apply k8s/bot-template/statefulset.yaml

kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=postgres \
  -n "$NAMESPACE" --timeout=120s
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=redis \
  -n "$NAMESPACE" --timeout=120s

apply k8s/api-gateway/deployment.yaml
apply k8s/device-manager/deployment.yaml

# Local Kind images intentionally use mutable :latest tags with pull policy
# Never. Restart so an already-running Deployment cannot keep an older image.
kubectl rollout restart deployment/api-gateway deployment/device-manager -n "$NAMESPACE"

if grep -q "would violate PodSecurity\|violates PodSecurity" "$apply_log"; then
  echo "PodSecurity warning/rejection detected during apply." >&2
  exit 1
fi

kubectl rollout status deployment/api-gateway -n "$NAMESPACE" --timeout=120s
kubectl rollout status deployment/device-manager -n "$NAMESPACE" --timeout=120s

kubectl get pods -n "$NAMESPACE" -o wide

api_pod="$(kubectl get pod -n "$NAMESPACE" -l app=api-gateway --field-selector=status.phase=Running \
  --sort-by=.metadata.creationTimestamp -o name | tail -n 1)"
manager_pod="$(kubectl get pod -n "$NAMESPACE" -l app=device-manager --field-selector=status.phase=Running \
  --sort-by=.metadata.creationTimestamp -o name | tail -n 1)"
[[ -n "$api_pod" && -n "$manager_pod" ]] || { echo "Ready application pods not found." >&2; exit 1; }

# Forward the newest concrete pods. Forwarding a Service during a rollout can
# remain pinned to an older terminating pod and report stale health metadata.
kubectl port-forward -n "$NAMESPACE" "$api_pod" "$API_LOCAL_PORT":8000 >"$pf_api_log" 2>&1 &
api_pid=$!
kubectl port-forward -n "$NAMESPACE" "$manager_pod" "$MANAGER_LOCAL_PORT":8001 >"$pf_manager_log" 2>&1 &
manager_pid=$!
sleep 1
kill -0 "$api_pid" 2>/dev/null || { echo "API port-forward failed:" >&2; cat "$pf_api_log" >&2; exit 1; }
kill -0 "$manager_pid" 2>/dev/null || { echo "Manager port-forward failed:" >&2; cat "$pf_manager_log" >&2; exit 1; }

for _ in {1..30}; do
  if curl --fail --silent "http://127.0.0.1:$API_LOCAL_PORT/health" >"$api_health_file" \
    && curl --fail --silent "http://127.0.0.1:$MANAGER_LOCAL_PORT/health" >"$manager_health_file" \
    && grep -q '"status":"ok"' "$api_health_file" \
    && grep -q '"status":"ok"' "$manager_health_file" \
    && grep -q '"mode":"kubernetes"' "$manager_health_file"; then
    break
  fi
  sleep 1
done

api_health="$(cat "$api_health_file")"
manager_health="$(cat "$manager_health_file")"

[[ "$api_health" == *'"status":"ok"'* ]] || {
  echo "API Gateway health check failed: $api_health" >&2
  cat "$pf_api_log" >&2
  exit 1
}
[[ "$manager_health" == *'"status":"ok"'* ]] || {
  echo "Device Manager health check failed: $manager_health" >&2
  cat "$pf_manager_log" >&2
  exit 1
}
[[ "$manager_health" == *'"mode":"kubernetes"'* ]] || {
  echo "Device Manager started in the wrong orchestration mode: $manager_health" >&2
  exit 1
}

echo "API Gateway: $api_health"
echo "Device Manager: $manager_health"
echo "Kind verification passed with no PodSecurity warnings."
