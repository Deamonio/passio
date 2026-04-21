"""
sikdorak-python-api (FastAPI) — RAG 및 일부 관리 API

- 동기 RAG 엔드포인트: Ollama + Chroma 기반 `solve_items()` (무거운 CPU/IO)
- asyncpg 기반 관리/조회 API 일부
- 운영에서 PM2 `rag-api`가 uvicorn으로 이 앱을 구동

Express(passio-node)와의 관계
- 웹 UX용 “job 큐”는 Node가 담당하고, 실제 추론은 Node가 이 서비스의 `/api/v1/rag/solve`를 호출하는 패턴이 일반적

상세 문서: 저장소 루트 `docs/SYSTEM-ARCHITECTURE.md`
"""
import json
import os
import asyncio
import threading
import time
import urllib.request
import urllib.error
import bcrypt
import asyncpg
from datetime import datetime
from typing import Any, Callable, Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import Response

from .rag.engine import solve_items
from .rag.models import ExamItem, SolveRequest, SolveResponse
from .schemas import HealthResponse

# RAG는 Chroma(SQLite)+Ollama 등 무거운 동기 작업이라, 스레드풀에서 동시에 여러 요청이
# 들어오면 같은 chroma.sqlite3에 동시 쓰기가 겹쳐 잠금/오류·연결 끊김이 날 수 있음 → 직렬화.
_rag_solve_lock = threading.Lock()

# ─────────────────────────────────────────────
# 로깅 설정
# ─────────────────────────────────────────────
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://sikdorak_app:sikdorak_password@127.0.0.1:5432/sikdorak"
)

async def log_api_request(
    endpoint: str,
    method: str,
    request_payload: Any = None,
    response_payload: Any = None,
    status_code: int = None,
    error_message: str = None,
    response_time_ms: float = None,
    user_id: int = None
):
    """API 요청/응답을 데이터베이스에 로깅"""
    try:
        # 민감한 정보 마스킹
        def mask_sensitive(obj):
            if not isinstance(obj, dict):
                return obj
            masked = dict(obj)
            sensitive_keys = {'password', 'password_hash', 'token', 'api_key', 'secret', 'authorization'}
            for key in list(masked.keys()):
                if any(k in key.lower() for k in sensitive_keys):
                    masked[key] = '***REDACTED***'
                elif isinstance(masked[key], dict):
                    masked[key] = mask_sensitive(masked[key])
            return masked
        
        sanitized_request = mask_sensitive(request_payload) if request_payload else None
        sanitized_response = mask_sensitive(response_payload) if response_payload else None
        
        conn = await asyncpg.connect(DATABASE_URL)
        try:
            await conn.execute(
                """
                INSERT INTO api_request_logs 
                (endpoint, method, user_id, request_payload, response_payload, status_code, error_message, response_time_ms)
                VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8)
                """,
                endpoint,
                method,
                user_id,
                json.dumps(sanitized_request) if sanitized_request else None,
                json.dumps(sanitized_response) if sanitized_response else None,
                status_code,
                error_message,
                int(response_time_ms) if response_time_ms else None
            )
        finally:
            await conn.close()
    except Exception as e:
        print(f"[API Log Error] {str(e)}")
        # 로깅 실패가 API 응답을 방해하지 않도록 에러를 무시

app = FastAPI(title="sikdorak-python-api", version="1.0.0")

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 모든 origin 허용 (개발 환경용)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def logging_middleware(request: Request, call_next: Callable) -> Response:
    """모든 요청/응답을 DB에 로깅 (health 체크 제외)"""
    path = request.url.path
    if path in ["/health", "/healthz"] or path.startswith("/api/admin/"):
        return await call_next(request)

    import asyncio
    start_time = time.time()
    endpoint = request.url.path
    method = request.method
    request_payload = None
    user_id = None

    # POST/PUT 요청 본문 캡처 (body는 한 번만 읽을 수 있으므로 재구성)
    if method in ["POST", "PUT"]:
        try:
            raw_body = await request.body()
            if raw_body:
                request_payload = json.loads(raw_body)
            # body를 다시 읽을 수 있도록 receive 재설정
            async def _replay_receive():
                return {"type": "http.request", "body": raw_body, "more_body": False}
            request = Request(request.scope, receive=_replay_receive)
        except Exception:
            pass

    try:
        response = await call_next(request)
        status_code = response.status_code
        response_payload = None

        # JSON 응답 본문 캡처
        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type:
            try:
                chunks = []
                async for chunk in response.body_iterator:
                    chunks.append(chunk)
                body_bytes = b"".join(chunks)
                if body_bytes:
                    response_payload = json.loads(body_bytes)
                # 소비된 body를 복원
                response = Response(
                    content=body_bytes,
                    status_code=status_code,
                    headers=dict(response.headers),
                    media_type=response.media_type,
                )
            except Exception:
                pass

        response_time_ms = (time.time() - start_time) * 1000
        asyncio.create_task(log_api_request(
            endpoint=endpoint, method=method, user_id=user_id,
            request_payload=request_payload, response_payload=response_payload,
            status_code=status_code, response_time_ms=response_time_ms,
        ))
        return response

    except Exception as exc:
        response_time_ms = (time.time() - start_time) * 1000
        asyncio.create_task(log_api_request(
            endpoint=endpoint, method=method, user_id=user_id,
            request_payload=request_payload, status_code=500,
            error_message=str(exc), response_time_ms=response_time_ms,
        ))
        raise

@app.get("/health", response_model=HealthResponse)
@app.get("/healthz", response_model=HealthResponse)
async def health() -> HealthResponse:
    """async: 동기 RAG가 스레드풀을 다 써도 헬스는 즉시 응답 (모니터링/로드밸런서용)."""
    return HealthResponse(status="ok", service="sikdorak-python-api")


@app.post("/api/rag/solve", response_model=SolveResponse)
@app.post("/api/v1/rag/solve", response_model=SolveResponse)
def rag_solve(payload: SolveRequest) -> SolveResponse:
    """
    시험 문제 목록을 받아 RAG 기반 해설 JSON을 반환합니다.

    요청 예시:
    {
      "items": [
        {
          "q": "리눅스에서 파일을 이동할 때 사용하는 명령어는?",
          "opts": "1) cp, 2) mv, 3) rm, 4) grep",
          "wrong": "1) cp",
          "ans": "2) mv"
        }
      ],
      "rebuild_db": false
    }
    """
    try:
        with _rag_solve_lock:
            results = solve_items(payload.items, force_rebuild=payload.rebuild_db)
        return SolveResponse(ok=True, total=len(results), results=results)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


async def _run_rag_job_bg(job_id: int, exam_item: ExamItem, rebuild_db: bool) -> None:
    """백그라운드에서 RAG 해설 생성 후 DB 업데이트. 클라이언트 연결 해제와 무관하게 실행됨."""
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        try:
            # solve_items는 무거운 동기 함수 → 스레드풀에서 실행해야 이벤트 루프를 블록하지 않음
            loop = asyncio.get_event_loop()
            results = await loop.run_in_executor(None, lambda: solve_items([exam_item], force_rebuild=rebuild_db))
            result_payload = {
                "ok": True,
                "total": len(results),
                "results": jsonable_encoder(results),
            }
            await conn.execute(
                """
                UPDATE rag_solve_jobs
                SET status = 'completed',
                    result_payload = $2::jsonb,
                    completed_at = NOW()
                WHERE id = $1
                """,
                job_id,
                json.dumps(result_payload, ensure_ascii=False),
            )
        except Exception as solve_exc:
            await conn.execute(
                """
                UPDATE rag_solve_jobs
                SET status = 'failed',
                    error_message = $2,
                    completed_at = NOW()
                WHERE id = $1
                """,
                job_id,
                str(solve_exc),
            )
    finally:
        await conn.close()


@app.post("/api/rag/jobs")
async def create_rag_job(request: Request, background_tasks: BackgroundTasks):
    """
    프론트엔드 AI 해설 생성 요청을 받아 jobId를 즉시 반환합니다.
    해설 생성은 백그라운드에서 진행되므로 사용자가 페이지를 떠나도 처리가 완료됩니다.
    """
    try:
        session_user = await _get_session_user_from_request(request)
        if not session_user or not session_user.get("id"):
            raise HTTPException(status_code=401, detail="로그인이 필요합니다.")

        body = await request.json()
        question = str(body.get("question") or "").strip()
        options = body.get("options") or []
        wrong_choice = str(body.get("wrongChoice") or "").strip()
        answer_choice = str(body.get("answerChoice") or "").strip()
        rebuild_db = bool(body.get("rebuild_db", False))
        raw_attempt_id = body.get("attemptId")
        raw_answer_idx = body.get("answerIndex")
        quiz_attempt_id = None
        quiz_attempt_answer_index = None
        try:
            if raw_attempt_id is not None and str(raw_attempt_id).strip() != "":
                quiz_attempt_id = int(raw_attempt_id)
        except (TypeError, ValueError):
            quiz_attempt_id = None
        try:
            if raw_answer_idx is not None and str(raw_answer_idx).strip() != "":
                quiz_attempt_answer_index = int(raw_answer_idx)
        except (TypeError, ValueError):
            quiz_attempt_answer_index = None

        if not question:
            raise HTTPException(status_code=400, detail="문제를 입력해주세요.")
        if not isinstance(options, list) or len(options) != 4:
            raise HTTPException(status_code=400, detail="보기 4개를 모두 입력해주세요.")

        opt_values = [str(x or "").strip() for x in options]
        if any(not x for x in opt_values):
            raise HTTPException(status_code=400, detail="보기 4개를 모두 입력해주세요.")

        opts_text = ", ".join([f"{idx + 1}) {text}" for idx, text in enumerate(opt_values)])
        exam_item = ExamItem(
            q=question,
            opts=opts_text,
            wrong=wrong_choice,
            ans=answer_choice,
        )

        # 1) processing 상태로 job 즉시 생성 후 jobId 반환
        user_id = int(session_user["id"])

        conn = await asyncpg.connect(DATABASE_URL)
        try:
            req_payload = {
                "question": question,
                "options": opt_values,
                "wrongChoice": wrong_choice,
                "answerChoice": answer_choice,
                "rebuild_db": rebuild_db,
            }
            if quiz_attempt_id is not None:
                req_payload["attemptId"] = quiz_attempt_id
            if quiz_attempt_answer_index is not None:
                req_payload["answerIndex"] = quiz_attempt_answer_index

            # quiz_attempt_* 컬럼이 없는 구 DB에서도 동작하도록 최소 컬럼만 INSERT
            row = await conn.fetchrow(
                """
                INSERT INTO rag_solve_jobs
                (user_id, status, question_text, option_1, option_2, option_3, option_4,
                 wrong_choice, answer_choice, request_payload, started_at, created_at)
                VALUES
                ($1, 'processing', $2, $3, $4, $5, $6,
                 $7, $8, $9::jsonb, NOW(), NOW())
                RETURNING id
                """,
                user_id,
                question,
                opt_values[0],
                opt_values[1],
                opt_values[2],
                opt_values[3],
                wrong_choice,
                answer_choice,
                json.dumps(req_payload, ensure_ascii=False),
            )
            job_id = int(row["id"])

            # 컬럼이 있으면 퀴즈 연동 값만 보강
            try:
                await conn.execute(
                    """
                    UPDATE rag_solve_jobs
                    SET quiz_attempt_id = $2, quiz_attempt_answer_index = $3
                    WHERE id = $1
                    """,
                    job_id,
                    quiz_attempt_id,
                    quiz_attempt_answer_index,
                )
            except Exception:
                pass
        finally:
            await conn.close()

        # 2) 해설 생성은 백그라운드로 위임 — 클라이언트 종료와 무관하게 완료됨
        background_tasks.add_task(_run_rag_job_bg, job_id, exam_item, rebuild_db)

        return {"ok": True, "jobId": job_id}
    except HTTPException:
        raise
    except Exception as exc:
        import traceback
        tb = traceback.format_exc()
        print("[ERROR] /api/rag/jobs 500:", exc)
        print(tb)
        # 클라이언트에도 Traceback 일부 반환
        raise HTTPException(status_code=500, detail=f"{exc}\n{tb}") from exc

@app.post("/api/v1/test/save")
async def save_test_results(request: Request):
    """
    테스트 결과를 API 로그에 저장 (웹 대시보드에 표시)
    
    요청 예시:
    {
      "test_name": "최종 RAG 테스트",
      "total_questions": 10,
      "success_count": 10,
      "avg_elapsed_sec": 45.43,
      "results_file": "/path/to/results.json"
    }
    """
    try:
        body = await request.json()
        
        # 사용자 인증 (선택사항)
        user_id = request.headers.get("X-User-Id", "13")  # deamon user 기본값
        
        # 테스트 요약
        summary = {
            "test_name": body.get("test_name", "RAG Test"),
            "total_questions": body.get("total_questions"),
            "success_count": body.get("success_count"),
            "avg_elapsed_sec": body.get("avg_elapsed_sec"),
            "verdict_distribution": body.get("verdict_distribution", {}),
            "timestamp": datetime.now().isoformat()
        }
        
        # API 로그에 저장
        await log_api_request(
            endpoint="/api/v1/test/save",
            method="POST",
            request_payload=body,
            response_payload=summary,
            status_code=200,
            user_id=int(user_id)
        )
        
        return {"ok": True, "message": "테스트 결과 저장 완료", "summary": summary}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

@app.get("/api/v1/test/history")
async def get_test_history(user_id: int = 13, limit: int = 20):
    """
    사용자의 테스트 결과 이력 조회 (웹 대시보드에 표시)
    """
    try:
        conn = await asyncpg.connect(DATABASE_URL)
        try:
            results = await conn.fetch(
                """
                SELECT id, endpoint, request_payload, response_payload, status_code, response_time_ms, created_at
                FROM api_request_logs
                WHERE user_id = $1 AND endpoint LIKE '/api/v1/test/%'
                ORDER BY created_at DESC
                LIMIT $2
                """,
                user_id,
                limit
            )
            
            history = []
            for row in results:
                history.append({
                    "id": row["id"],
                    "endpoint": row["endpoint"],
                    "test_name": row["response_payload"].get("test_name") if row["response_payload"] else None,
                    "total_questions": row["response_payload"].get("total_questions") if row["response_payload"] else None,
                    "success_count": row["response_payload"].get("success_count") if row["response_payload"] else None,
                    "avg_elapsed_sec": row["response_payload"].get("avg_elapsed_sec") if row["response_payload"] else None,
                    "response_time_ms": row["response_time_ms"],
                    "created_at": row["created_at"].isoformat() if row["created_at"] else None
                })
            
            return {"ok": True, "total": len(history), "history": history}
        finally:
            await conn.close()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/rag/history")
async def get_rag_solve_history(user_id: int = 13, limit: int = 300):
    """
    사용자의 AI 해설 기록 조회 (웹 대시보드용)
    """
    try:
        limit = min(int(limit), 300)
        conn = await asyncpg.connect(DATABASE_URL)
        try:
            results = await conn.fetch(
                """
                SELECT id, status, question_text, 
                       option_1, option_2, option_3, option_4,
                       wrong_choice, answer_choice, result_payload,
                       created_at
                FROM rag_solve_jobs
                WHERE user_id = $1
                ORDER BY created_at DESC
                LIMIT $2
                """,
                user_id,
                limit
            )
            
            jobs = []
            for row in results:
                jobs.append({
                    "id": row["id"],
                    "status": row["status"],
                    "questionText": row["question_text"],
                    "option1": row["option_1"],
                    "option2": row["option_2"],
                    "option3": row["option_3"],
                    "option4": row["option_4"],
                    "wrongChoice": row["wrong_choice"],
                    "answerChoice": row["answer_choice"],
                    "resultPayload": row["result_payload"],
                    "createdAt": row["created_at"].isoformat() if row["created_at"] else None
                })
            
            return {"ok": True, "total": len(jobs), "jobs": jobs}
        finally:
            await conn.close()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/rag/jobs/{job_id}")
async def get_rag_job_detail(request: Request, job_id: int):
    """
    특정 AI 해설 작업의 상세 정보 조회
    """
    session_user = await _get_session_user_from_request(request)
    if not session_user or not session_user.get("id"):
        raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
    user_id = int(session_user["id"])
    try:
        conn = await asyncpg.connect(DATABASE_URL)
        try:
            row = await conn.fetchrow(
                """
                SELECT id, status, question_text,
                       option_1, option_2, option_3, option_4,
                       wrong_choice, answer_choice, result_payload,
                       error_message, created_at
                FROM rag_solve_jobs
                WHERE id = $1 AND user_id = $2
                """,
                job_id,
                user_id
            )
            
            if not row:
                raise HTTPException(status_code=404, detail="해설 기록을 찾을 수 없습니다")
            
            job = {
                "id": row["id"],
                "status": row["status"],
                "questionText": row["question_text"],
                "option1": row["option_1"],
                "option2": row["option_2"],
                "option3": row["option_3"],
                "option4": row["option_4"],
                "wrongChoice": row["wrong_choice"],
                "answerChoice": row["answer_choice"],
                "resultPayload": row["result_payload"],
                "errorMessage": row["error_message"],
                "createdAt": row["created_at"].isoformat() if row["created_at"] else None
            }
            
            return {"ok": True, "job": job}
        finally:
            await conn.close()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ─────────────────────────────────────────────
# Admin API (로그인 세션 기반 인증)
# ─────────────────────────────────────────────
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")


def _fetch_node_session_user(cookie_header: str) -> Optional[dict]:
    """Node auth(/api/auth/me)로 현재 로그인 사용자를 조회합니다."""
    if not cookie_header:
        return None
    try:
        req = urllib.request.Request(
            "http://127.0.0.1:3100/api/auth/me",
            headers={
                "Cookie": cookie_header,
                "Accept": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            if resp.status != 200:
                return None
            payload = json.loads(resp.read().decode("utf-8"))
            user = payload.get("user") if isinstance(payload, dict) else None
            return user if isinstance(user, dict) else None
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError):
        return None


async def _ensure_admin_schema(conn: asyncpg.Connection) -> None:
    await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE")
    await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_permissions JSONB")
    # deamon 계정은 항상 관리자 권한 보장
    await conn.execute("UPDATE users SET is_admin = TRUE WHERE lower(username) = 'deamon' AND is_admin = FALSE")


DEFAULT_ADMIN_PERMISSIONS = {
    "users": {"read": True, "write": True, "delete": True},
    "logs": {"read": True},
    "rag": {"read": True, "delete": True},
    "quiz": {"read": True, "delete": True},
    "questions": {"read": True},
}


def _merge_admin_permissions(raw: Any, username: str) -> dict:
    """DB의 admin_permissions(JSON)와 기본값을 합칩니다. deamon은 항상 전체 허용."""
    if str(username or "").lower() == "deamon":
        return json.loads(json.dumps(DEFAULT_ADMIN_PERMISSIONS))
    out = {k: dict(v) for k, v in DEFAULT_ADMIN_PERMISSIONS.items()}
    if raw is None:
        return out
    data = raw
    if isinstance(raw, str):
        try:
            data = json.loads(raw)
        except Exception:
            return out
    if not isinstance(data, dict):
        return out
    for section, actions in data.items():
        if section not in out or not isinstance(actions, dict):
            continue
        for act, val in actions.items():
            if act in out[section]:
                out[section][act] = bool(val)
    return out


def _admin_perm_ok(perms: dict, section: str, action: str) -> bool:
    sec = perms.get(section) or {}
    return bool(sec.get(action, False))


async def _get_session_user_from_request(request: Request) -> Optional[dict]:
    cookie_header = request.headers.get("cookie", "")
    loop = asyncio.get_running_loop()
    user = await loop.run_in_executor(None, lambda: _fetch_node_session_user(cookie_header))
    return user


async def _require_admin(request: Request) -> dict:
    # 비상용 토큰 유지(옵션) — 전체 관리자 권한
    token = request.headers.get("X-Admin-Token", "")
    if ADMIN_TOKEN and token and token == ADMIN_TOKEN:
        return {
            "id": None,
            "username": "token-admin",
            "isAdmin": True,
            "permissions": json.loads(json.dumps(DEFAULT_ADMIN_PERMISSIONS)),
        }

    session_user = await _get_session_user_from_request(request)
    if not session_user:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다.")

    user_id = session_user.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="세션 사용자 정보를 확인할 수 없습니다.")

    conn = await asyncpg.connect(DATABASE_URL)
    try:
        await _ensure_admin_schema(conn)
        row = await conn.fetchrow(
            "SELECT id, username, email, name, student_number, is_admin, admin_permissions FROM users WHERE id = $1",
            int(user_id),
        )
        if not row:
            raise HTTPException(status_code=403, detail="사용자 정보를 찾을 수 없습니다.")

        username = str(row["username"] or "").lower()
        is_admin = bool(row["is_admin"]) or username == "deamon"
        if username == "deamon" and not bool(row["is_admin"]):
            await conn.execute("UPDATE users SET is_admin = TRUE WHERE id = $1", int(row["id"]))

        if not is_admin:
            raise HTTPException(status_code=403, detail="관리자 권한이 필요합니다.")

        perms = _merge_admin_permissions(row["admin_permissions"], username)
        return {
            "id": int(row["id"]),
            "username": row["username"],
            "email": row["email"],
            "name": row["name"],
            "studentNumber": row["student_number"],
            "isAdmin": True,
            "permissions": perms,
        }
    finally:
        await conn.close()


async def _require_admin_perm(request: Request, section: str, action: str) -> dict:
    ctx = await _require_admin(request)
    if not _admin_perm_ok(ctx["permissions"], section, action):
        raise HTTPException(
            status_code=403,
            detail=f"'{section}' 영역의 '{action}' 권한이 없습니다.",
        )
    return ctx


@app.get("/api/admin/me")
async def admin_me(request: Request):
    session_user = await _get_session_user_from_request(request)
    if not session_user:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다.")

    user_id = session_user.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="세션 사용자 정보를 확인할 수 없습니다.")

    conn = await asyncpg.connect(DATABASE_URL)
    try:
        await _ensure_admin_schema(conn)
        row = await conn.fetchrow(
            "SELECT id, username, email, name, student_number, is_admin, admin_permissions FROM users WHERE id = $1",
            int(user_id),
        )
        if not row:
            raise HTTPException(status_code=403, detail="사용자 정보를 찾을 수 없습니다.")

        username = str(row["username"] or "").lower()
        is_admin = bool(row["is_admin"]) or username == "deamon"
        if username == "deamon" and not bool(row["is_admin"]):
            await conn.execute("UPDATE users SET is_admin = TRUE WHERE id = $1", int(row["id"]))
            is_admin = True

        perms = _merge_admin_permissions(row["admin_permissions"], username) if is_admin else None

        return {
            "ok": True,
            "user": {
                "id": int(row["id"]),
                "username": row["username"],
                "email": row["email"],
                "name": row["name"],
                "studentNumber": row["student_number"],
                "isAdmin": bool(is_admin),
                "permissions": perms,
            },
        }
    finally:
        await conn.close()


# ── 사용자 목록 ──
@app.get("/api/admin/users")
async def admin_list_users(request: Request):
    await _require_admin_perm(request, "users", "read")
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        await _ensure_admin_schema(conn)
        rows = await conn.fetch(
            "SELECT id, email, username, name, student_number, is_admin, admin_permissions, created_at FROM users ORDER BY id"
        )
        return {"ok": True, "users": [
            {"id": r["id"], "email": r["email"], "username": r["username"],
             "name": r["name"], "studentNumber": r["student_number"],
             "isAdmin": bool(r["is_admin"]),
             "adminPermissions": r["admin_permissions"],
             "createdAt": r["created_at"].isoformat() if r["created_at"] else None}
            for r in rows
        ]}
    finally:
        await conn.close()


# ── 사용자 수정 ──
@app.patch("/api/admin/users/{user_id}")
async def admin_update_user(user_id: int, request: Request):
    await _require_admin_perm(request, "users", "write")
    body = await request.json()
    updates = []
    params = [user_id]

    if "username" in body and body["username"]:
        params.append(str(body["username"]).strip())
        updates.append(f"username = ${len(params)}")
    if "email" in body and body["email"]:
        params.append(str(body["email"]).strip())
        updates.append(f"email = ${len(params)}")
    if "name" in body and body["name"]:
        params.append(str(body["name"]).strip())
        updates.append(f"name = ${len(params)}")
    if "isAdmin" in body:
        params.append(bool(body["isAdmin"]))
        updates.append(f"is_admin = ${len(params)}")
    if "adminPermissions" in body or "admin_permissions" in body:
        raw_perm = body.get("adminPermissions", body.get("admin_permissions"))
        if raw_perm is None:
            updates.append("admin_permissions = NULL")
        else:
            if not isinstance(raw_perm, dict):
                raise HTTPException(status_code=400, detail="adminPermissions는 JSON 객체여야 합니다.")
            params.append(json.dumps(raw_perm, ensure_ascii=False))
            updates.append(f"admin_permissions = ${len(params)}::jsonb")
    if "password" in body and body["password"]:
        pw_hash = bcrypt.hashpw(str(body["password"]).encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
        params.append(pw_hash)
        updates.append(f"password_hash = ${len(params)}")

    if not updates:
        raise HTTPException(status_code=400, detail="변경할 항목이 없습니다.")

    conn = await asyncpg.connect(DATABASE_URL)
    try:
        await _ensure_admin_schema(conn)
        result = await conn.execute(
            f"UPDATE users SET {', '.join(updates)} WHERE id = $1",
            *params
        )
        if result == "UPDATE 0":
            raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
        return {"ok": True}
    finally:
        await conn.close()


# ── 사용자 삭제 ──
@app.delete("/api/admin/users/{user_id}")
async def admin_delete_user(user_id: int, request: Request):
    await _require_admin_perm(request, "users", "delete")
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        await conn.execute("DELETE FROM refresh_tokens WHERE user_id = $1", user_id)
        await conn.execute("DELETE FROM user_api_tokens WHERE user_id = $1", user_id)
        await conn.execute("DELETE FROM quiz_attempt_answers WHERE attempt_id IN (SELECT id FROM quiz_attempts WHERE user_id = $1)", user_id)
        await conn.execute("DELETE FROM quiz_attempts WHERE user_id = $1", user_id)
        await conn.execute("DELETE FROM rag_solve_jobs WHERE user_id = $1", user_id)
        result = await conn.execute("DELETE FROM users WHERE id = $1", user_id)
        if result == "DELETE 0":
            raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
        return {"ok": True}
    finally:
        await conn.close()


# ── API 로그 목록 ──
@app.get("/api/admin/logs")
async def admin_list_logs(request: Request, limit: int = 100, offset: int = 0, endpoint: str = ""):
    await _require_admin_perm(request, "logs", "read")
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        safe_limit = min(max(int(limit or 20), 1), 100)
        safe_offset = max(int(offset or 0), 0)
        where = "WHERE endpoint ILIKE $3" if endpoint else ""
        params_count = [safe_limit, safe_offset, f"%{endpoint}%"] if endpoint else [safe_limit, safe_offset]
        rows = await conn.fetch(
            f"""SELECT id, endpoint, method, user_id, status_code, response_time_ms,
                       error_message, created_at
                FROM api_request_logs
                {where}
                ORDER BY created_at DESC LIMIT $1 OFFSET $2""",
            *params_count
        )
        total_row = await conn.fetchrow(
            f"SELECT COUNT(*) FROM api_request_logs {'WHERE endpoint ILIKE $1' if endpoint else ''}",
            *([ f"%{endpoint}%" ] if endpoint else [])
        )
        return {"ok": True, "total": total_row[0], "logs": [
            {"id": r["id"], "endpoint": r["endpoint"], "method": r["method"],
             "userId": r["user_id"], "statusCode": r["status_code"],
             "responseTimeMs": r["response_time_ms"],
             "errorMessage": r["error_message"],
             "createdAt": r["created_at"].isoformat() if r["created_at"] else None}
            for r in rows
        ]}
    finally:
        await conn.close()


@app.get("/api/admin/logs/{log_id}")
async def admin_get_log_detail(log_id: int, request: Request):
    await _require_admin_perm(request, "logs", "read")

    def _safe_payload(payload: Any, endpoint: str, max_chars: int = 120000):
        if payload is None:
            return None
        # 관리자 API 로그는 과거 재귀 적재로 매우 커질 수 있어 상세 payload는 생략
        if str(endpoint or "").startswith("/api/admin/"):
            return {
                "_omitted": True,
                "reason": "admin endpoint payload omitted to prevent recursive heavy rendering",
            }
        try:
            text = json.dumps(payload, ensure_ascii=False)
        except Exception:
            return payload
        if len(text) <= max_chars:
            return payload
        return {
            "_truncated": True,
            "_originalChars": len(text),
            "_preview": text[:max_chars],
        }

    conn = await asyncpg.connect(DATABASE_URL)
    try:
        row = await conn.fetchrow(
            """
            SELECT id, endpoint, method, user_id, status_code, response_time_ms,
                   request_payload, response_payload, error_message, created_at
            FROM api_request_logs
            WHERE id = $1
            LIMIT 1
            """,
            log_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="로그를 찾을 수 없습니다.")

        return {
            "ok": True,
            "log": {
                "id": row["id"],
                "endpoint": row["endpoint"],
                "method": row["method"],
                "userId": row["user_id"],
                "statusCode": row["status_code"],
                "responseTimeMs": row["response_time_ms"],
                "requestPayload": _safe_payload(row["request_payload"], row["endpoint"]),
                "responsePayload": _safe_payload(row["response_payload"], row["endpoint"]),
                "errorMessage": row["error_message"],
                "createdAt": row["created_at"].isoformat() if row["created_at"] else None,
            },
        }
    finally:
        await conn.close()


# ── RAG Jobs (전체) ──
@app.get("/api/admin/rag-jobs")
async def admin_list_rag_jobs(request: Request, limit: int = 100, offset: int = 0):
    await _require_admin_perm(request, "rag", "read")
    safe_limit = min(max(int(limit or 20), 1), 500)
    safe_offset = min(max(int(offset or 0), 0), 500_000)
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        rows = await conn.fetch(
            """SELECT j.id, j.user_id, u.username, j.status, j.question_text,
                      j.wrong_choice, j.answer_choice, j.result_payload,
                      j.error_message, j.created_at, j.completed_at
               FROM rag_solve_jobs j
               LEFT JOIN users u ON u.id = j.user_id
               ORDER BY j.created_at DESC LIMIT $1 OFFSET $2""",
            safe_limit, safe_offset
        )
        total_row = await conn.fetchrow("SELECT COUNT(*) FROM rag_solve_jobs")
        return {"ok": True, "total": total_row[0], "jobs": [
            {"id": r["id"], "userId": r["user_id"], "username": r["username"],
             "status": r["status"], "questionText": r["question_text"],
             "wrongChoice": r["wrong_choice"], "answerChoice": r["answer_choice"],
             "resultPayload": r["result_payload"],
             "errorMessage": r["error_message"],
             "createdAt": r["created_at"].isoformat() if r["created_at"] else None,
             "completedAt": r["completed_at"].isoformat() if r["completed_at"] else None}
            for r in rows
        ]}
    finally:
        await conn.close()


@app.delete("/api/admin/rag-jobs/{job_id}")
async def admin_delete_rag_job(job_id: int, request: Request):
    await _require_admin_perm(request, "rag", "delete")
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        result = await conn.execute("DELETE FROM rag_solve_jobs WHERE id = $1", job_id)
        if result == "DELETE 0":
            raise HTTPException(status_code=404, detail="해설 기록을 찾을 수 없습니다.")
        return {"ok": True, "deletedId": job_id}
    finally:
        await conn.close()


# ── 퀴즈 기록 (전체) ──
@app.get("/api/admin/quiz-attempts")
async def admin_list_quiz_attempts(request: Request, limit: int = 100, offset: int = 0):
    await _require_admin_perm(request, "quiz", "read")
    safe_limit = min(max(int(limit or 20), 1), 500)
    safe_offset = min(max(int(offset or 0), 0), 500_000)
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        rows = await conn.fetch(
            """SELECT a.id, a.user_id, u.username, a.total_questions, a.correct_count,
                      a.score, a.duration_sec, a.quiz_uid, a.created_at
               FROM quiz_attempts a
               LEFT JOIN users u ON u.id = a.user_id
               ORDER BY a.created_at DESC LIMIT $1 OFFSET $2""",
            safe_limit, safe_offset
        )
        total_row = await conn.fetchrow("SELECT COUNT(*) FROM quiz_attempts")
        return {"ok": True, "total": total_row[0], "attempts": [
            {"id": r["id"], "userId": r["user_id"], "username": r["username"],
             "totalQuestions": r["total_questions"], "correctCount": r["correct_count"],
             "score": r["score"], "durationSec": r["duration_sec"],
             "quizUid": r["quiz_uid"],
             "createdAt": r["created_at"].isoformat() if r["created_at"] else None}
            for r in rows
        ]}
    finally:
        await conn.close()


# ── 퀴즈 답안 상세 ──
@app.get("/api/admin/quiz-attempts/{attempt_id}/answers")
async def admin_get_attempt_answers(attempt_id: int, request: Request):
    await _require_admin_perm(request, "quiz", "read")
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        rows = await conn.fetch(
            """SELECT id, question_id, subject, question_text, selected_index, correct_index, is_correct
               FROM quiz_attempt_answers WHERE attempt_id = $1 ORDER BY id""",
            attempt_id
        )
        return {"ok": True, "answers": [
            {"id": r["id"], "questionId": r["question_id"], "subject": r["subject"],
             "questionText": r["question_text"], "selectedIndex": r["selected_index"],
             "correctIndex": r["correct_index"], "isCorrect": r["is_correct"]}
            for r in rows
        ]}
    finally:
        await conn.close()


@app.delete("/api/admin/quiz-attempts/{attempt_id}/rag-jobs")
async def admin_clear_attempt_rag_jobs(attempt_id: int, request: Request):
    """퀴즈 시도에 연결된 rag_solve_jobs만 삭제. 답안·시도 행은 유지 → 학습자가 퀴즈 상세에서 해설을 다시 신청 가능."""
    await _require_admin_perm(request, "rag", "delete")
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        row = await conn.fetchrow("SELECT id FROM quiz_attempts WHERE id = $1", attempt_id)
        if not row:
            raise HTTPException(status_code=404, detail="퀴즈 기록을 찾을 수 없습니다.")
        result = await conn.execute(
            "DELETE FROM rag_solve_jobs WHERE quiz_attempt_id = $1",
            attempt_id,
        )
        deleted = 0
        if isinstance(result, str) and result.upper().startswith("DELETE "):
            try:
                deleted = int(result.split()[-1])
            except ValueError:
                deleted = 0
        return {"ok": True, "attemptId": attempt_id, "deletedCount": deleted}
    finally:
        await conn.close()


@app.delete("/api/admin/quiz-attempts/{attempt_id}")
async def admin_delete_quiz_attempt(attempt_id: int, request: Request):
    await _require_admin_perm(request, "quiz", "delete")
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        await conn.execute("DELETE FROM rag_solve_jobs WHERE quiz_attempt_id = $1", attempt_id)
        await conn.execute("DELETE FROM quiz_attempt_answers WHERE attempt_id = $1", attempt_id)
        result = await conn.execute("DELETE FROM quiz_attempts WHERE id = $1", attempt_id)
        if result == "DELETE 0":
            raise HTTPException(status_code=404, detail="퀴즈 기록을 찾을 수 없습니다.")
        return {"ok": True, "deletedId": attempt_id}
    finally:
        await conn.close()


# ── 문제 목록 ──
@app.get("/api/admin/questions")
async def admin_list_questions(request: Request, limit: int = 50, offset: int = 0, subject: str = ""):
    await _require_admin_perm(request, "questions", "read")
    safe_limit = min(max(int(limit or 20), 1), 500)
    safe_offset = min(max(int(offset or 0), 0), 500_000)
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        where = "WHERE subject ILIKE $3" if subject else ""
        params = [safe_limit, safe_offset, f"%{subject}%"] if subject else [safe_limit, safe_offset]
        rows = await conn.fetch(
            f"""SELECT id, subject, question, option1, option2, option3, option4, answer
                FROM questions {where} ORDER BY id LIMIT $1 OFFSET $2""",
            *params
        )
        total_row = await conn.fetchrow(
            f"SELECT COUNT(*) FROM questions {'WHERE subject ILIKE $1' if subject else ''}",
            *([ f"%{subject}%" ] if subject else [])
        )
        return {"ok": True, "total": total_row[0], "questions": [
            {"id": r["id"], "subject": r["subject"], "question": r["question"],
             "option1": r["option1"], "option2": r["option2"],
             "option3": r["option3"], "option4": r["option4"], "answer": r["answer"]}
            for r in rows
        ]}
    finally:
        await conn.close()


# ── DB 테이블 통계 (대시보드용) ──
@app.get("/api/admin/stats")
async def admin_stats(request: Request):
    await _require_admin(request)
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        stats = {}
        tables = ["users", "api_request_logs", "rag_solve_jobs", "quiz_attempts",
                  "quiz_attempt_answers", "questions", "user_api_tokens", "refresh_tokens"]
        for t in tables:
            row = await conn.fetchrow(f"SELECT COUNT(*) FROM {t}")
            stats[t] = row[0]
        # 최근 24h 로그
        row = await conn.fetchrow(
            "SELECT COUNT(*) FROM api_request_logs WHERE created_at > NOW() - INTERVAL '24 hours'"
        )
        stats["logs_24h"] = row[0]
        # RAG 완료율
        row = await conn.fetchrow(
            "SELECT COUNT(*) FILTER (WHERE status='completed') AS done, COUNT(*) AS total FROM rag_solve_jobs"
        )
        stats["rag_completed"] = row["done"]
        stats["rag_total"] = row["total"]
        return {"ok": True, "stats": stats}
    finally:
        await conn.close()


