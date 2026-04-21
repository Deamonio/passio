# shellcheck shell=bash
# 다른 배포 스크립트에서: source "$(dirname "$0")/_deploy_ssh.sh"

# DEPLOY_HOST, DEPLOY_PATH, 선택 DEPLOY_KEY 검사
deploy_validate_env() {
  if [[ -z "${DEPLOY_HOST:-}" ]] || [[ -z "${DEPLOY_PATH:-}" ]]; then
    echo "DEPLOY_HOST 와 DEPLOY_PATH 가 필요합니다."
    return 1
  fi
  if [[ "${DEPLOY_PATH}" != /* ]]; then
    echo "DEPLOY_PATH 는 / 로 시작해야 합니다: ${DEPLOY_PATH}"
    return 1
  fi
  if [[ -n "${DEPLOY_KEY:-}" && ! -r "${DEPLOY_KEY}" ]]; then
    echo "DEPLOY_KEY 를 읽을 수 없습니다: ${DEPLOY_KEY}"
    echo "  unset DEPLOY_KEY 또는 올바른 경로(예: \$HOME/.ssh/id_ed25519)로 설정하세요."
    return 1
  fi
  case "${DEPLOY_PATH}" in
    *원격*|*여기*|*YOUR_*|*path/to*|*example*|*예시*)
      echo "DEPLOY_PATH 가 예시 문자열입니다. 서버에서 실제 경로를 확인하세요."
      return 1
      ;;
  esac
  return 0
}

deploy_rsync_shell() {
  local s="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15"
  if [[ -n "${DEPLOY_KEY:-}" && -r "${DEPLOY_KEY}" ]]; then
    s="$s -i ${DEPLOY_KEY}"
  fi
  printf "%s" "$s"
}

# 사용: deploy_ssh "$DEPLOY_HOST" '원격에서 한 줄 명령'
deploy_ssh() {
  local host="$1"
  shift
  if [[ -n "${DEPLOY_KEY:-}" && -r "${DEPLOY_KEY}" ]]; then
    ssh -i "${DEPLOY_KEY}" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 "$host" "$@"
  else
    ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 "$host" "$@"
  fi
}
