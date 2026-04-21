#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT_DIR"

echo "[pre] Starting backend application"
"$ROOT_DIR/scripts/run-app.sh"

deploy_with_docker() {
  echo "[1/3] Validating compose file"
  docker compose config >/dev/null

  echo "[2/3] Starting web container"
  docker compose up -d --remove-orphans
}

deploy_with_standalone_nginx() {
  echo "[1/3] Docker unavailable, switching to standalone Nginx"
  if [[ -f /tmp/sikdorak-nginx.pid ]]; then
    old_pid="$(cat /tmp/sikdorak-nginx.pid || true)"
    if [[ -n "${old_pid}" ]] && kill -0 "$old_pid" 2>/dev/null; then
      kill "$old_pid" || true
    fi
    rm -f /tmp/sikdorak-nginx.pid
  fi

  echo "[2/3] Testing Nginx config"
  nginx -t -c "$ROOT_DIR/nginx/nginx-standalone.conf"

  echo "[3/3] Starting standalone Nginx"
  nginx -c "$ROOT_DIR/nginx/nginx-standalone.conf"
}

chmod +x "$ROOT_DIR/scripts/run-app.sh"

if docker info >/dev/null 2>&1; then
  deploy_with_docker
else
  deploy_with_standalone_nginx
fi

echo "[verify] Verifying health endpoint"
for i in {1..20}; do
  if curl -fsS http://127.0.0.1:8080/healthz >/dev/null && curl -fsS http://127.0.0.1:8080/api/health >/dev/null; then
    echo "Deployment successful: http://127.0.0.1:8080"
    echo "[hint] 원격(sikdorak.org 등)은 이 스크립트만으로 반영되지 않습니다. DEPLOY_HOST·DEPLOY_PATH 설정 후: npm run sync:web"
    exit 0
  fi
  sleep 1
done

echo "Deployment failed: health check timeout"
exit 1
