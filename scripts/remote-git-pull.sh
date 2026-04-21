#!/usr/bin/env bash
# 원격 서버에서 git pull 만 실행 (저장소가 이미 클론되어 있을 때).
#
#   export DEPLOY_HOST='ubuntu@sikdorak.org'
#   export DEPLOY_PATH='/home/ubuntu/passio'
#   optional: export DEPLOY_KEY="$HOME/.ssh/id_ed25519"
#   optional: export GIT_REMOTE_BRANCH='main'
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "${ROOT_DIR}/scripts/_deploy_ssh.sh"

if ! deploy_validate_env; then
  exit 1
fi

BR="${GIT_REMOTE_BRANCH:-main}"
echo "[git-pull] $DEPLOY_HOST:$DEPLOY_PATH ($BR)"

deploy_ssh "$DEPLOY_HOST" "set -e; cd '${DEPLOY_PATH}'; git fetch origin; git checkout '${BR}'; git pull origin '${BR}'"

if [[ -n "${REMOTE_NGINX_RELOAD:-}" ]]; then
  deploy_ssh "$DEPLOY_HOST" "cd '${DEPLOY_PATH}' && ${REMOTE_NGINX_RELOAD}"
fi

echo "[git-pull] 완료"
