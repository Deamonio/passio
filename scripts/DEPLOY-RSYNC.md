# rsync 배포 및 서버 반영

로컬(Mac 등)에서 이 저장소 루트로 이동한 뒤, 아래 환경 변수를 쓰는 스크립트로 동기화합니다. **원격 Nginx `root`와 `DEPLOY_PATH`가 같아야** HTML/JS/CSS가 즉시 서빙됩니다. (예: `root /var/www/sikdorak;` 이면 `DEPLOY_PATH=/var/www/sikdorak`)

## 1. 한 번만 설정하면 되는 것

- SSH로 `DEPLOY_HOST`에 비밀번호 없이 접속 가능해야 합니다.
- 키를 쓸 때: `export DEPLOY_KEY="$HOME/.ssh/deamon.pem"` 처럼 **읽기 가능한 절대 경로**.

## 2. 환경 변수

| 변수 | 필수 | 설명 |
|------|------|------|
| `DEPLOY_HOST` | 예 | 예: `ubuntu@3.38.232.17` 또는 `ubuntu@deamon` |
| `DEPLOY_PATH` | 예 | 원격에서 `pages/`, `assets/`가 바로 아래에 오는 디렉터리 (Nginx `root`와 동일 권장) |
| `DEPLOY_KEY` | 선택 | 지정 시 `rsync`/`ssh`에 `-i`로 사용. 미지정 시 ssh 기본 키·agent |
| `REMOTE_NGINX_RELOAD` | 선택 | 설정 시 동기화 후 원격에서 실행. 예: `sudo nginx -s reload` |
| `REMOTE_NODE_RESTART` | 선택 | **`deploy-remote-full.sh`만**. 예: `pm2 restart sikdorak` 또는 `sudo systemctl restart sikdorak-app` |

## 3. 정적만 반영 (HTML/CSS/JS, nginx 설정 파일)

가장 자주 쓰는 경로입니다. `pages/`, `assets/`를 rsync하고, 선택적으로 nginx reload.

```bash
cd /path/to/sikdorak

export DEPLOY_HOST='ubuntu@YOUR_HOST'
export DEPLOY_PATH='/var/www/sikdorak'   # 서버에서 실제 docroot에 맞출 것
export DEPLOY_KEY="$HOME/.ssh/deamon.pem"   # 필요할 때만

export REMOTE_NGINX_RELOAD='sudo nginx -s reload'

npm run sync:web
# 동일: npm run deploy:remote:static
```

- 스크립트: `scripts/sync-static-to-remote.sh`
- 브라우저는 캐시 때문에 안 바뀌면 **강력 새로고침** 또는 HTML/JS에 붙인 `?v=` 버전을 올린 뒤 다시 배포.

## 4. Node/API·서버 코드까지 반영

`src/`, `package.json` 등 전체 트리를 rsync (`node_modules` 등은 제외)하고, nginx reload와 **Node 프로세스 재시작**을 할 수 있습니다.

```bash
export DEPLOY_HOST='ubuntu@YOUR_HOST'
export DEPLOY_PATH='/home/ubuntu/sikdorak'   # 코드가 있는 경로 (서비스가 여기서 뜨는 경우)
export DEPLOY_KEY="$HOME/.ssh/deamon.pem"

export REMOTE_NGINX_RELOAD='sudo nginx -s reload'
export REMOTE_NODE_RESTART='pm2 restart all'   # 실제 프로세스 이름에 맞게 수정

npm run deploy:remote:full
```

- 스크립트: `scripts/deploy-remote-full.sh`
- **Nginx docroot**와 **Node가 읽는 코드 경로**가 다르면, 정적은 3번, API는 4번처럼 **경로를 나눠서** 두 번 배포할 수 있습니다.

## 5. Python RAG API만 반영

rsync 대상에 `python_api/`가 포함되므로 `deploy:remote:full` 후 원격에서 한 번 더:

```bash
ssh -i "$HOME/.ssh/deamon.pem" ubuntu@YOUR_HOST 'pm2 restart rag-api'
```

(실제 PM2 앱 이름은 서버에서 `pm2 list`로 확인.)

## 6. Git pull만 쓰는 방식 (대안)

서버가 저장소를 직접 두고 `git pull`로 받는 경우:

```bash
npm run deploy:remote:pull
```

원격에서 `git pull` 후 `REMOTE_NGINX_RELOAD`만 실행하는 스크립트입니다. (`scripts/remote-git-pull.sh`)

## 7. 배포 확인

```bash
# API (호스트에 맞게)
curl -sS "https://YOUR_DOMAIN/api/health" | head

# 정적 파일이 새 경로인지 (예)
curl -sSI "https://YOUR_DOMAIN/pages/history.html" | head -5
```

## 8. 자주 나는 문제

| 증상 | 점검 |
|------|------|
| 화면이 안 바뀜 | `DEPLOY_PATH`가 Nginx `root`와 다른지, `REMOTE_NGINX_RELOAD`를 했는지, 브라우저 캐시 |
| Permission denied (publickey) | `DEPLOY_HOST`, `DEPLOY_KEY`, `ssh ubuntu@host` 수동 로그인 |
| 404 on pages | 원격에 `pages/`가 `DEPLOY_PATH/pages/` 아래에 있는지 |

GitHub Actions로 정적만 올리는 워크플로는 `.github/workflows/deploy-web.yml`을 참고하면 됩니다.
