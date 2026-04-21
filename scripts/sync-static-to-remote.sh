#!/usr/bin/env bash
# 원격 서버에 pages / assets / nginx 설정만 rsync 할 때 사용합니다.
# 사용 전: SSH 키로 해당 호스트에 로그인 가능해야 합니다.
#
# Nginx 가 root /var/www/sikdorak; 이면 DEPLOY_PATH 도 동일하게 두는 것이 안전합니다.
#
#   export DEPLOY_HOST='ubuntu@sikdorak.org'
#   export DEPLOY_PATH='/var/www/sikdorak'   # 또는 원격 프로젝트 루트 — nginx root 와 일치시킬 것
#   선택: export DEPLOY_KEY="$HOME/.ssh/id_ed25519"   # 없으면 ssh 기본 키·ssh-agent 사용
#   bash scripts/sync-static-to-remote.sh
#
# 선택: 동기화 후 원격에서 nginx reload
#   export REMOTE_NGINX_RELOAD='sudo nginx -s reload'
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "${ROOT_DIR}/scripts/_deploy_ssh.sh"

if ! deploy_validate_env; then
  echo ""
  echo "예시:"
  echo "  export DEPLOY_HOST='ubuntu@sikdorak.org'"
  echo "  export DEPLOY_PATH='/home/ubuntu/sikdorak'"
  echo "  unset DEPLOY_KEY    # 또는: export DEPLOY_KEY=\"\$HOME/.ssh/id_ed25519\""
  echo "  npm run sync:web"
  exit 1
fi

RSYNC_SHELL="$(deploy_rsync_shell)"

echo "[sync] $ROOT_DIR -> ${DEPLOY_HOST}:${DEPLOY_PATH}"

rsync -avz --delete \
  -e "$RSYNC_SHELL" \
  "$ROOT_DIR/pages/" "${DEPLOY_HOST}:${DEPLOY_PATH}/pages/"

rsync -avz --delete \
  -e "$RSYNC_SHELL" \
  "$ROOT_DIR/assets/" "${DEPLOY_HOST}:${DEPLOY_PATH}/assets/"

rsync -avz \
  -e "$RSYNC_SHELL" \
  "$ROOT_DIR/nginx/nginx.conf" \
  "$ROOT_DIR/nginx/nginx-standalone.conf" \
  "$ROOT_DIR/nginx/security-headers.conf" \
  "${DEPLOY_HOST}:${DEPLOY_PATH}/nginx/"

if [[ -n "${REMOTE_NGINX_RELOAD:-}" ]]; then
  echo "[sync] remote nginx reload: $REMOTE_NGINX_RELOAD"
  deploy_ssh "$DEPLOY_HOST" "cd ${DEPLOY_PATH} && ${REMOTE_NGINX_RELOAD}"
fi

echo "[sync] 완료. 예: curl -sS https://sikdorak.org/api/health | head -c 400"
