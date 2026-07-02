# Python API Pipeline Detailed Report

## 1. 보고서 개요

이 문서는 [python_api/app/main.py](python_api/app/main.py), [python_api/app/rag/engine.py](python_api/app/rag/engine.py), [python_api/app/rag/ontology_engine.py](python_api/app/rag/ontology_engine.py) 및 관련 모듈을 기준으로 현재 구현된 파이프라인을 코드 수준에서 해부한 기술 리포트다.

핵심 목적은 다음 세 가지다.

- 실제 요청이 들어왔을 때 시스템이 어떤 순서로 동작하는지 재현 가능한 수준으로 설명
- 각 모듈의 책임, 의존성, 실패 대응, 성능 병목 포인트를 구조적으로 정리
- 현재 구현의 강점과 리스크를 분리해, 다음 개선 우선순위를 제시

---

## 2. 분석 범위 및 방법

### 2.1 분석 범위

- API 엔트리: [python_api/app/main.py](python_api/app/main.py)
- RAG 핵심 엔진: [python_api/app/rag/engine.py](python_api/app/rag/engine.py)
- 온톨로지 의도 분석: [python_api/app/rag/ontology_engine.py](python_api/app/rag/ontology_engine.py)
- 컨텍스트/파싱/응답 템플릿:
  - [python_api/app/rag/conversation_context.py](python_api/app/rag/conversation_context.py)
  - [python_api/app/rag/mcq_payload.py](python_api/app/rag/mcq_payload.py)
  - [python_api/app/rag/problem_explain_leg.py](python_api/app/rag/problem_explain_leg.py)
  - [python_api/app/rag/concept_explain_leg.py](python_api/app/rag/concept_explain_leg.py)
  - [python_api/app/main.py](python_api/app/main.py) (mock exam helper block)
  - [python_api/app/rag/etc_reply.py](python_api/app/rag/etc_reply.py)
- 저장/캐시/모델:
  - [python_api/app/rag/chroma_store.py](python_api/app/rag/chroma_store.py)
  - [python_api/app/rag/solve_cache.py](python_api/app/rag/solve_cache.py)
  - [python_api/app/rag/models.py](python_api/app/rag/models.py)
- 설정/스키마/유틸:
  - [python_api/app/settings.py](python_api/app/settings.py)
  - [python_api/app/schemas.py](python_api/app/schemas.py)
  - [python_api/app/utils.py](python_api/app/utils.py)

### 2.2 분석 방법

- 엔트리포인트에서 하위 모듈로 내려가는 정적 호출 흐름 추적
- 주요 데이터 계약(Pydantic 모델, JSON 출력 스키마) 확인
- 실패 대응/폴백/재시도/캐시 동작 확인
- 운영 관점의 병목과 리스크를 코드 구조와 함께 평가

---

## 3. 시스템 아키텍처 요약

현재 python_api는 FastAPI 기반의 동기식 RAG 서비스다. 구조적으로는 아래 4계층으로 볼 수 있다.

1. API 계층
- FastAPI 라우터가 요청을 받고, 로깅/세마포어/예외 처리를 수행
- 핵심 엔드포인트: health, rag solve, forge analyze, leg explain, think stream

2. 의도/오케스트레이션 계층
- ForgeOntologyEngine이 사용자 메시지 의도와 좌표를 해석
- 의도에 따라 설명, 개념 설명, 문제 검색, ETC 응답 등 분기

3. RAG 실행 계층
- solve_items가 검색-필터링-컨텍스트 구성-LLM 생성-감사(audit) 보정까지 수행
- 캐시(메모리+디스크)와 근거 정합성 보정 로직 포함

4. 저장/외부 의존 계층
- Chroma(SQLite 백엔드) for vector retrieval
- Ollama for LLM/embedding
- PostgreSQL(asyncpg) for 문제 검색/관리 기능 일부

이 설계는 기능 분리가 명확하고 운영 방어장치(병렬 제한, 캐시, 폴백)가 존재한다는 점에서 실전형 구조에 가깝다.

---

## 4. 주요 엔드포인트와 실제 요청 생명주기

### 4.1 POST /api/v1/rag/solve

입력:
- SolveRequest(items, rebuild_db)

실행 순서:
1) main.py 핸들러 진입
2) 전역 세마포어(BoundedSemaphore) 획득
3) solve_items 호출
4) 아이템별 결과를 SolveResponse로 래핑
5) 로깅/응답

핵심 포인트:
- 동시성 제어가 명시적이다. Chroma(SQLite) 락 충돌을 줄이기 위한 운영 장치다.

### 4.2 POST /api/v1/forge/analyze

입력:
- ForgeAnalyzeRequest(payload, history, 메타)

실행 순서:
1) mock exam 맥락 여부 확인
2) 필요 시 대화 문맥 증강(augment_payload_for_ontology_followup)
3) ForgeOntologyEngine.analyze 호출
4) intent 기반 분기:
- EXPLAIN_PROBLEM: MCQ 파싱 -> solve_items
- CONCEPT_EXPLAIN: concept_explain_leg 경로
- QUESTION_SEARCH: PostgreSQL 검색
- ETC: 일반 응답 경로
5) analysis/route/assistant_message/leg/recommended_questions 조합

핵심 포인트:
- 같은 엔드포인트 안에서 다중 업무를 처리하는 오케스트레이터 역할을 한다.
- intent_sequence를 통한 복합 의도 처리 기반이 이미 있다.

### 4.3 POST /api/v1/leg/explain, POST /api/v1/leg/think-stream

- leg/explain은 단일 설명형 워크플로를 명시적으로 호출하는 용도
- think-stream은 스트리밍 UX용 경로

---

## 5. solve_items 중심 파이프라인 상세

[python_api/app/rag/engine.py](python_api/app/rag/engine.py)의 solve_items는 본 시스템의 핵심 실행기다.

### 5.1 사전 준비 단계

- runtime tuning 로드(_rag_runtime_config)
- embeddings/LLM 객체 생성(ChatOllama, OllamaEmbeddings)
- Chroma 핸들 획득(get_langchain_chroma)

튜닝 값은 환경변수 + RAG_ALWAYS_FAST 조합으로 결정된다.

### 5.2 아이템 처리 단계(문항별)

1) 캐시 조회
- solve_cache_key(item) 생성
- solve_cache_get(key)로 메모리 LRU -> 디스크 캐시 순서 조회
- 히트 시 즉시 반환

2) 쿼리 구성
- item.search_query 우선, 없으면 문제 텍스트 기반
- force_rebuild 시 힌트 키워드 결합 가능

3) 벡터 검색
- similarity_search_with_relevance_scores(query, k=12)

4) 다단계 필터링
- 점수 임계 + 키워드 중첩 기준
- 너무 적게 남으면 조건 완화
- 최악의 경우 전체 후보 사용

5) 표 데이터 보정(선택)
- 파이프 기반 표 감지 시 llm_table로 서술형 변환

6) 컨텍스트 예산 구성
- _build_budgeted_context로 문서 우선순위 정렬
- 총 문자 예산, 문서 최소 개수, 문서별 clip 적용
- 중복 텍스트 제거

7) LLM 생성
- build_problem_explain_leg_prompt로 프롬프트 구성
- llm.invoke로 JSON 생성 유도

8) 후처리/검증
- extract_problem_explain_leg_json
- normalize_problem_explain_leg_report
- body/audit 유효성 검사
- 필요 시 repair_problem_explain_leg_audit 재호출
- _filter_refined_by_relevance로 근거 id 정합성 보정

9) 캐시 저장
- solve_cache_set(key, payload)

10) 응답 모델화
- SolveResult(report, evidence)

### 5.3 의미

이 파이프라인은 단순 RAG를 넘어서 아래를 동시에 해결하려고 설계되어 있다.

- 검색 빈약 시 폴백
- JSON 구조 붕괴 시 복구
- 근거 id 무결성 보정
- 과도한 문맥 길이 제어
- 반복 질의 캐시 가속

즉, 품질 방어 코드가 비교적 촘촘한 구현이다.

---

## 6. 온톨로지 기반 경로 상세

### 6.1 ForgeOntologyEngine 역할

[python_api/app/rag/ontology_engine.py](python_api/app/rag/ontology_engine.py)에서 다음을 수행한다.

- intent 분류
- status(COMPLETE/INCOMPLETE) 판단
- topic switched 여부 판단
- coordinate/coordinates 추출
- search_query 최적화

출력은 ForgeAnalysis 구조로 내려오며, 이후 main.py가 실행 경로를 결정한다.

### 6.2 왜 중요한가

이 계층은 "어떤 답변을 생성할지"보다 먼저 "어떤 파이프라인을 태울지"를 결정한다.
즉, 검색 품질 이전에 라우팅 품질을 좌우하는 상위 제어면(control plane)이다.

---

## 7. 데이터 계약(모델/스키마) 정리

### 7.1 입력 모델

- ExamItem
  - q, opts, wrong, ans
  - search_query, user_message
  - ontology_subject/chapter/concept
  - ontology_coordinates

- SolveRequest
  - items (min 1, max 50)
  - rebuild_db

### 7.2 출력 모델

- SolveResult
  - report: Problem Explain LEG JSON
  - evidence: id/text 리스트

- SolveResponse
  - ok, total, results

### 7.3 LEG 출력 형태

실제 출력은 header/body/audit/magic_tip 구조를 강제하려고 설계되어 있다.
여기서 audit.refined_evidence는 근거 추적성의 핵심이며, 생성 후 보정 루틴까지 연결된다.

---

## 8. 캐시/동시성/운영 제어

### 8.1 캐시

[python_api/app/rag/solve_cache.py](python_api/app/rag/solve_cache.py)

- 메모리 LRU + 디스크 JSON 이중 캐시
- TTL 기반 만료
- 원자적 쓰기(temp -> rename)

효과:
- 동일/유사 요청 재처리 비용 감소
- Ollama 호출량 감소

주의:
- 입력 해시 키 설계가 변경되면 캐시 히트율이 급감할 수 있다.

### 8.2 동시성

- 전역 BoundedSemaphore로 solve 경로 병렬 제한
- 목적: SQLite 기반 Chroma 락 충돌 완화

효과:
- 안정성 향상

트레이드오프:
- 큐 대기 증가 가능
- 대량 트래픽에서 처리량 상한이 명확함

---

## 9. 검색/재정렬/컨텍스트 빌드에 대한 평가

### 9.1 장점

- 검색 -> 필터 -> 완화 폴백의 3단계 설계
- 키워드 중첩과 점수를 함께 보는 하이브리드 판단
- context budget으로 토큰/문자 폭주 방지

### 9.2 한계

- 재랭킹이 규칙 중심이라 의미 기반 미세 순위조정이 약할 수 있음
- 문서 clip 기반 절단은 핵심 문맥 손실 가능
- table 감지 규칙이 단순해서 오탐/누락 가능

### 9.3 제안

- cross-encoder 계열 경량 reranker 추가
- evidence span 추출 계층(문서 전체 대신 근거 구간)
- clip 전에 문단 단위 importance slicing 적용

---

## 10. 실패 대응/폴백 로직 평가

현재 구현의 큰 강점은 "실패를 전제로 한 설계"다.

- 검색 결과 부족 시 완화
- JSON 파싱 실패 시 다중 추출 전략
- audit 불완전 시 repair 재호출
- 컨텍스트 빈약 시 narrative fallback

이는 운영 환경에서 치명 오류를 줄이는 데 매우 효과적이다.

다만 아래는 추가 개선이 필요하다.

- Ollama timeout/backoff 재시도 전략의 표준화
- 실패 유형(검색 실패, 파싱 실패, repair 실패)별 메트릭 분리
- fallback 사용률을 지표화해 품질 저하 조기 감지

---

## 11. 현재 구현의 강점

1. 오케스트레이션 분리
- API/의도분석/실행엔진/저장계층이 코드상 분리되어 있어 유지보수성이 좋다.

2. 운영 안전장치
- 세마포어, 캐시, 폴백, 보정 로직이 실제 장애를 막는 구조다.

3. 근거 추적성
- audit.refined_evidence 중심 설계로 설명 가능성을 확보한다.

4. 확장성 기반
- intent_sequence, mock exam, question search 등 멀티 시나리오 확장 포인트가 이미 구현되어 있다.

---

## 12. 현재 구현의 리스크 및 기술부채

1. SQLite/Chroma 병목
- 병렬 처리 제한으로 안정성은 확보했지만 처리량 상한이 낮다.

2. 라우팅 품질 검증 부족
- ontology 좌표가 잘못돼도 강한 검증/보정 계층이 상대적으로 약하다.

3. 재랭킹 정교도
- 규칙 기반 relevance는 빠르지만 고난도 문항에서 오탐 가능성 존재.

4. 동기/비동기 혼합 비용
- 일부 경로에서 asyncpg 호출이 sync 문맥과 섞여 운영 효율 저하 가능성.

5. 관측성(Observability) 부족
- 현재 로그는 있으나, 단계별 품질 지표를 체계적으로 집계하는 대시보드성 구조는 약함.

---

## 13. 우선순위 개선안(실행 순서 제안)

### P0 (즉시)

- 실패 유형별 지표화
  - retrieval_empty_rate
  - audit_repair_rate
  - fallback_injection_rate
  - cache_hit_rate

- timeout/backoff 표준화
  - Ollama 호출 재시도 정책 분리

### P1 (단기)

- 재랭킹 계층 개선
  - semantic reranker 도입
  - evidence span 추출

- ontology 좌표 검증
  - 허용 좌표 사전 검증
  - 좌표 confidence 기반 라우팅 가드

### P2 (중기)

- 저장 계층 확장
  - Chroma 운영 분리 또는 락 영향 낮은 구조 검토

- 품질 평가 루프 자동화
  - gold set 기반 주기 평가
  - intent별 성능 리포트 자동 생성

---

## 14. 결론

현재 python_api 파이프라인은 "단순 RAG 데모" 수준을 넘어, 운영 실패를 견디도록 설계된 실전형 구조다. 특히 solve_items의 다단계 방어 로직과 forge_analyze의 intent 기반 분기 체계는 실서비스 관점에서 강한 장점이다.

다만 다음 단계에서 경쟁력을 결정하는 요소는 명확하다.

- 검색 정밀도 자체보다, 검색 결과를 정답 선택/설명 품질로 연결하는 후단 추론 구조의 정교화
- ontology 라우팅 품질의 검증 가능성 확보
- 실패/폴백 메트릭 기반의 운영 가시성 강화

요약하면, 현재 구현은 "확장 가능한 안정형 베이스"로 평가할 수 있으며, 재랭킹·좌표검증·관측성 개선을 통해 품질 상한을 실질적으로 끌어올릴 수 있다.

---

## 15. 모듈 인덱스(빠른 참조)

- API 엔트리: [python_api/app/main.py](python_api/app/main.py)
- RAG 코어: [python_api/app/rag/engine.py](python_api/app/rag/engine.py)
- 온톨로지: [python_api/app/rag/ontology_engine.py](python_api/app/rag/ontology_engine.py)
- LEG 템플릿/보정:
  - [python_api/app/rag/problem_explain_leg.py](python_api/app/rag/problem_explain_leg.py)
  - [python_api/app/rag/concept_explain_leg.py](python_api/app/rag/concept_explain_leg.py)
- 페이로드/문맥/기타:
  - [python_api/app/rag/mcq_payload.py](python_api/app/rag/mcq_payload.py)
  - [python_api/app/rag/conversation_context.py](python_api/app/rag/conversation_context.py)
  - [python_api/app/main.py](python_api/app/main.py) (mock exam helper block)
  - [python_api/app/rag/etc_reply.py](python_api/app/rag/etc_reply.py)
- 저장/캐시:
  - [python_api/app/rag/chroma_store.py](python_api/app/rag/chroma_store.py)
  - [python_api/app/rag/solve_cache.py](python_api/app/rag/solve_cache.py)
- 모델/설정/유틸:
  - [python_api/app/rag/models.py](python_api/app/rag/models.py)
  - [python_api/app/settings.py](python_api/app/settings.py)
  - [python_api/app/schemas.py](python_api/app/schemas.py)
  - [python_api/app/utils.py](python_api/app/utils.py)
