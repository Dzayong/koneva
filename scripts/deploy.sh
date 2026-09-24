#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
NAMESPACE=${K8S_NAMESPACE:-wa-gateway}
REGISTRY=${REGISTRY:?Set REGISTRY, for example ghcr.io/acme}
IMAGE_TAG=${IMAGE_TAG:-$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || date -u +%Y%m%d%H%M%S)}

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }
}

for command in docker kubectl curl; do require "$command"; done

if grep -q 'CHANGE_ME' "$PROJECT_ROOT/k8s/secrets.yaml"; then
  echo "Refusing deployment: replace all CHANGE_ME placeholders in k8s/secrets.yaml or use your secret manager overlay." >&2
  exit 1
fi

api_image="$REGISTRY/wa-gateway-api:$IMAGE_TAG"
manager_image="$REGISTRY/wa-gateway-manager:$IMAGE_TAG"
bot_image="$REGISTRY/wa-bot:$IMAGE_TAG"

docker build --target api-gateway -f "$PROJECT_ROOT/docker/app.Dockerfile" -t "$api_image" "$PROJECT_ROOT"
docker build --target device-manager -f "$PROJECT_ROOT/docker/app.Dockerfile" -t "$manager_image" "$PROJECT_ROOT"
docker build -f "$PROJECT_ROOT/docker/bot-container.Dockerfile" -t "$bot_image" "$PROJECT_ROOT"
docker push "$api_image"
docker push "$manager_image"
docker push "$bot_image"

rendered=$(mktemp -d)
trap 'rm -rf "$rendered"' EXIT
cp -R "$PROJECT_ROOT/k8s/." "$rendered/"
find "$rendered" -type f -name '*.yaml' -exec sed -i \
  -e "s#your-registry/wa-gateway-api:latest#$api_image#g" \
  -e "s#your-registry/wa-gateway-manager:latest#$manager_image#g" \
  -e "s#your-registry/wa-bot:latest#$bot_image#g" {} +

kubectl apply -f "$rendered/namespace.yaml"
kubectl apply -f "$rendered/secrets.yaml" -f "$rendered/configmap.yaml"
kubectl apply -f "$rendered/postgres/statefulset.yaml" -f "$rendered/redis/statefulset.yaml"
kubectl rollout status statefulset/postgres -n "$NAMESPACE" --timeout=5m
kubectl rollout status statefulset/redis -n "$NAMESPACE" --timeout=5m

kubectl delete job database-migrate -n "$NAMESPACE" --ignore-not-found
kubectl apply -f "$rendered/migration-job.yaml"
kubectl wait --for=condition=complete job/database-migrate -n "$NAMESPACE" --timeout=5m

kubectl apply -R -f "$rendered"
kubectl rollout status deployment/api-gateway -n "$NAMESPACE" --timeout=5m
kubectl rollout status deployment/device-manager -n "$NAMESPACE" --timeout=5m
kubectl rollout status deployment/prometheus -n "$NAMESPACE" --timeout=5m

kubectl delete pod wa-gateway-healthcheck -n "$NAMESPACE" --ignore-not-found >/dev/null
kubectl run wa-gateway-healthcheck -n "$NAMESPACE" --restart=Never --rm -i \
  --image=curlimages/curl:8.12.1 --command -- \
  curl --fail --silent --show-error --retry 10 --retry-delay 3 http://api-gateway:8000/ready

if [[ -n "${HEALTHCHECK_URL:-}" ]]; then
  curl --fail --silent --show-error --retry 10 --retry-delay 5 "$HEALTHCHECK_URL"
fi

echo "Deployment complete:"
echo "  API:     $api_image"
echo "  Manager: $manager_image"
echo "  Bot:     $bot_image"
