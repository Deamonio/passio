#!/usr/bin/env bash
# 원격 프로젝트 루트에 코드 대부분을 rsync (node_modules 등 제외) 후,
# 정적(pages, assets, nginx)도 맞추고 선택적으로 nginx reload / Node 재시작.
#
#   export DEPLOY_HOST='ubuntu@sikdorak.org'
#   export DEPLOY_PATH='/home/ubuntu/passio'   # 원격 저장소 루트 (예시 — 실제 경로로 바꾸세요)
#   optional: export DEPLOY_KEY="$HOME/.ssh/id_ed25519"
#   optional: export REMOTE_NGINX_RELOAD='sudo nginx -s reload'
#   optional: export REMOTE_NODE_RESTART='sudo systemctl restart sikdorak-app'   # 원격 유닛 이름에 맞게
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "${ROOT_DIR}/scripts/_deploy_ssh.sh"

if ! deploy_validate_env; then
  exit 1
fi

RSYNC_SHELL="$(deploy_rsync_shell)"
REMOTE="${DEPLOY_HOST}:${DEPLOY_PATH}/"

echo "[full] rsync 코드 트리 -> $REMOTE (대용량·민감 디렉터리 제외)"

rsync -avz \
  -e "$RSYNC_SHELL" \
  --delete \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude '.venv/' \
  --exclude '__pycache__/' \
  --exclude 'python_api/chroma_db/' \
  --exclude 'RAG/chroma_db_v18_final/' \
  --exclude '*.db' \
  --exclude 'cookies.txt' \
  --exclude '.env' \
  "$ROOT_DIR/" "$REMOTE"

if [[ -n "${REMOTE_NGINX_RELOAD:-}" ]]; then
  echo "[full] nginx reload: $REMOTE_NGINX_RELOAD"
  deploy_ssh "$DEPLOY_HOST" "cd ${DEPLOY_PATH} && ${REMOTE_NGINX_RELOAD}"
fi

if [[ -n "${REMOTE_NODE_RESTART:-}" ]]; then
  echo "[full] Node 재시작: $REMOTE_NODE_RESTART"
  deploy_ssh "$DEPLOY_HOST" "cd ${DEPLOY_PATH} && ${REMOTE_NODE_RESTART}"
fi

echo "[full] 완료."
