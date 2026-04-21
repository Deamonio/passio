# Passio / Sikdorak 시스템 아키텍처 보고서

본 문서는 저장소 기준으로 **실제 운영에서 쓰이는 구성(nginx + PM2 + PostgreSQL + Ollama + Chroma + 정적 웹)**을 설명합니다.  
Docker Compose로 올리는 구성도 함께 정리합니다.

---

## 1. 한 줄 요약

- **브라우저**는 Nginx가 서빙하는 **정적 HTML/CSS/JS**로 UI를 그립니다.
- **비즈니스 API(퀴즈·인증·RAG 작업 큐·PDF 등)**는 **Node.js(Express)**가 담당합니다. (기본 `127.0.0.1:3100`)
- **RAG 추론(벡터 검색 + LLM 호출)**은 **Python(FastAPI + LangChain + Chroma)**이 담당합니다. (기본 `127.0.0.1:8001`)
- **영구 데이터**는 **PostgreSQL**에 저장됩니다.
- **LLM/임베딩**은 외부 **Ollama** 서버에 HTTP로 요청합니다.

---

## 2. 논리 아키텍처 (구성 요소)

```mermaid
flowchart TB
  subgraph Client["브라우저"]
    P["pages/*.html + assets/js/*.js"]
  end

  subgraph Edge["Nginx (TLS, 정적, 리버스 프록시)"]
    NG["nginx/sikdorak-site.conf 등"]
  end

  subgraph Node["passio-node (Express)"]
    API["src/server.js\nREST API + 세션/쿠키"]
    DBN["src/db.js\nPostgreSQL (pg)"]
    PDF["src/attemptPdf.js\nPDF 생성"]
  end

  subgraph Py["rag-api (FastAPI)"]
    RAG["python_api/app/rag/engine.py\nLangChain + Chroma"]
    CH["python_api/app/rag/chroma_store.py\nChroma 초기화 보강"]
  end

  subgraph Data["데이터 계층"]
    PG[("PostgreSQL")]
    CHDB[("Chroma SQLite\nchroma_db/")]
  end

  subgraph AI["외부 추론"]
    OL["Ollama\n(LLM + embeddings)"]
  end

  P -->|HTTPS| NG
  NG -->|/api/* (대부분)| API
  NG -->|/api/rag/* 등| Py
  NG -->|정적 파일| P
  API --> DBN --> PG
  API -->|HTTP POST\n/api/v1/rag/solve| Py
  API --> PDF
  RAG --> CHDB
  RAG -->|HTTP| OL
  CH --> CHDB
```

---

## 3. 물리 배포 (이 서버에서 흔한 형태)

### 3.1 PM2 프로세스

`ecosystem.config.js` 기준:

| 프로세스명 | 역할 | 실행 |
|------------|------|------|
| `passio-node` | Express API + RAG job 오케스트레이션 | `node src/server.js` (watch) |
| `rag-api` | FastAPI RAG 엔진 | `python_api/start.sh` → uvicorn |

`watch: true`로 **소스 변경 시 자동 재시작**합니다.  
`pages/`, `assets/`, `python_api/` 전체를 watch 대상에 넣지 않아 **정적 배포나 Chroma DB 변경으로 불필요하게 API가 재시작되는 것**을 줄입니다.

### 3.2 Nginx 정적 파일

운영에서 흔히:

- 저장소: `/home/ubuntu/sikdorak/pages`, `/home/ubuntu/sikdorak/assets`
- docroot: `/var/www/sikdorak/` (nginx `root`)

`rsync`로 동기화하는 패턴을 사용합니다.

### 3.3 Docker Compose (대안 런타임)

`docker-compose.yml`은 **로컬/스테이징용 올인원** 스택을 정의합니다.

- `web`: nginx (정적 마운트)
- `app`: Node 20
- `py-api`: Python API (예시에서는 `run.sh` + 포트 8000 등 — 실제 PM2 운영과 다를 수 있음)

운영 서버가 PM2를 쓰는 경우, Compose는 “참고용”에 가깝습니다.

---

## 4. HTTP 라우팅 (가장 중요한 규칙)

`nginx/sikdorak-site.conf`에 다음 우선순위가 있습니다.

1. **`/api/rag2/` → Node(3100)**  
   - Express가 `rag_solve_jobs`를 DB에 만들고, 백그라운드에서 Python RAG를 호출합니다.  
   - 주석에도 있듯이 **`/api/rag/`보다 위에 있어야** 합니다.

2. **`/api/rag/` → Python(8001)** (프록시)  
   - 브라우저가 직접 Python의 RAG 관련 HTTP를 치는 경로(폴링 등)에 사용됩니다.

3. **`/api/admin/` → Python(8001)** (프록시)  
   - 관리자 API 일부가 Python에 있습니다.

4. **`/api/` → Node(3100)**  
   - 퀴즈, 인증, 히스토리, PDF 등 대부분의 API.

### 4.1 왜 rag와 rag2가 나뉘었나?

- **rag2**: “작업 생성 + DB linkage + Node가 오케스트레이션”이 필요한 제품 요구(웹 UX/권한/레이트리밋/재시도)를 Node에 두기 쉽습니다.
- **rag**: “장시간 RAG 처리/관리자/직접 폴링” 등을 Python에 두는 흐름이 있습니다.

---

## 5. 데이터 모델(요약)

PostgreSQL은 `src/db.js`의 `initDatabase()`에서 스키마를 보강합니다. 핵심 테이블:

- `users`, `refresh_tokens`, `user_api_tokens`
- `questions` (문제은행)
- `quiz_attempts`, `quiz_attempt_answers` (사용자 풀이 세션)
- `rag_solve_jobs` (AI 해설 작업 큐/결과)
- `api_request_logs` (선택적 로깅)

퀴즈 상세 화면은 `getQuizAttemptDetail()`에서 `rag_solve_jobs`를 **문항 인덱스(`quiz_attempt_answer_index`)**로 조인하여 `aiExplanation`을 구성합니다.

---

## 6. RAG 파이프라인 (추론 경로)

### 6.1 웹에서 “AI 해설 요청”

1. 브라우저: `POST /api/rag2/jobs` (Nginx → Node)
2. Node: `rag_solve_jobs` row 생성 → `setImmediate`로 백그라운드 처리
3. Node: 내부 동시성 제한(`createConcurrencyLimit`)으로 Python 호출 폭주 방지
4. Node: `POST http://127.0.0.1:8001/api/v1/rag/solve` (또는 동등 경로)
5. Python: `solve_items()`에서 Chroma 검색 + Ollama LLM 호출
6. Node: 성공 시 `rag_solve_jobs.result_payload` 업데이트

### 6.2 Python 쪽 안정화 포인트

- **Chroma(SQLite) 동시 접근** 이슈를 줄이기 위해 FastAPI의 동기 RAG 엔드포인트는 `_rag_solve_lock`으로 **직렬화**할 수 있습니다.
- `chroma_store.py`는 **기본 tenant/db 행 보강 + 재시도** 등 로컬 영속 Chroma 초기화를 보강합니다.

### 6.3 LLM/임베딩 모델

환경변수 `OLLAMA_MODEL`, `OLLAMA_EMBED_MODEL`로 지정합니다.  
기본값은 `python_api/app/settings.py` 및 `python_api/start.sh`에 있습니다.

---

## 7. PDF 생성

- 엔드포인트: `GET /api/quiz/history/:attemptId/pdf` (Node)
- 구현: `src/attemptPdf.js` (pdfkit + 한글 폰트)
- 정책(현재): **오답 문항의 AI 해설이 모두 있어야** 생성 가능(409로 누락 문항 안내)
- PDF는 “웹과 동일한 DOM 스냅샷”은 아니지만, **UI 톤을 흉내 낸 카드형 레이아웃**으로 렌더링합니다.

---

## 8. 보안/운영

- **Helmet**, **rate limit**, **CORS**, **cookie 기반 refresh/access JWT** 흐름(Express).
- Nginx는 TLS 종단 및 `proxy_set_header`로 원 IP/프로토 전달.
- PM2 watch 운영 시 **포트 충돌**(다른 프로세스가 3100 점유)에 주의 — 과거에 `EADDRINUSE`로 `passio-node`가 실패한 사례가 있었습니다.

---

## 9. 디렉터리 가이드

| 경로 | 설명 |
|------|------|
| `pages/` | 정적 HTML (Passio UI) |
| `assets/` | CSS/JS 정적 자산 |
| `src/` | Express 서버 + PDF + DB 접근 |
| `python_api/app/` | FastAPI 앱 + RAG |
| `python_api/chroma_db/` | Chroma 영속 데이터(대용량/민감) |
| `nginx/` | Nginx 설정 샘플 |
| `scripts/` | 배포/동기화 스크립트 |
| `RAG/` | 오프라인 인제스트/실험 스크립트(운영 경로와 별개일 수 있음) |

---

## 10. “전 코드에 주석을 전부”에 대해

요청하신 “주석도 다”는 **전 파일/전 라인** 기준으로는 유지보수 비용이 매우 커서 권장되지 않습니다.  
대신 본 문서를 **단일 소스(SSoT)**로 두고, 코드에는 **진입점 파일 상단에 아키텍처 블록 주석**을 추가하는 방식이 가장 안전합니다.

원하시면 다음 단계로:

- `src/db.js`의 큰 섹션별(인증/퀴즈/RAG) 목차 주석
- `python_api/app/rag/engine.py`의 파이프라인 단계 주석

처럼 **특정 파일만** 더 촘촘히 확장할 수 있습니다(원하는 파일 목록을 주시면 됩니다).
