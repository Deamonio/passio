# Python API Pipeline Presentation Script (10-12 min)

## 0. Opening (0:00-0:40)

안녕하세요. 오늘은 python_api 내부 파이프라인이 실제 요청을 어떻게 처리하는지, 그리고 현재 구현이 어떤 강점과 리스크를 갖는지를 코드 기준으로 설명드리겠습니다.

핵심 메시지는 세 가지입니다.

- 첫째, 이 시스템은 단순 RAG가 아니라 라우팅, 검색, 생성, 검증, 복구를 모두 포함한 운영형 구조입니다.
- 둘째, 품질은 검색 품질 단독이 아니라 검색 이후 추론 구성에서 크게 결정됩니다.
- 셋째, 현재 구현은 안정성 기반은 충분하지만, 재랭킹/좌표 정합/관측성 측면의 고도화 여지가 큽니다.

---

## 1. What This Service Is (0:40-2:00)

python_api는 FastAPI 기반 서비스이며, Ollama LLM과 Chroma 벡터 DB를 중심으로 동작합니다.

가장 중요한 엔드포인트는 두 개입니다.

- /api/v1/rag/solve: 문제를 직접 받아 RAG 기반 해설을 생성하는 경로
- /api/v1/forge/analyze: 사용자 요청의 의도를 먼저 분류하고, 그 결과에 따라 solve 또는 개념 설명/문제 검색으로 분기하는 오케스트레이션 경로

구조를 한 줄로 표현하면 다음과 같습니다.

"입력 메시지 -> 의도/좌표 분석 -> 검색/컨텍스트 구성 -> JSON 해설 생성 -> 근거 audit 보정 -> 응답 반환"

여기서 중요한 점은, 이 서비스가 생성만 하는 구조가 아니라 "근거 무결성"을 끝까지 확인한다는 것입니다.

---

## 2. Request Lifecycle Deep Dive (2:00-4:30)

### 2.1 /api/v1/rag/solve 경로

1) 요청이 들어오면 main.py에서 세마포어를 먼저 획득합니다.

- 이유: Chroma(SQLite 백엔드)의 동시 접근 충돌 완화
- 효과: 안정성 확보
- 대가: 병렬 처리량 상한 존재

2) solve_items가 문항별로 처리합니다.

- 캐시 조회(solve_cache_get)
- 벡터 검색(similarity_search_with_relevance_scores)
- 관련성 필터링(점수+키워드)
- 컨텍스트 예산화(_build_budgeted_context)
- LLM JSON 생성
- JSON/audit 유효성 검사
- 필요 시 repair 루프 실행
- refined_evidence 정합성 보정
- 결과 캐시 저장

3) 결과는 SolveResult(report + evidence) 형태로 반환됩니다.

### 2.2 /api/v1/forge/analyze 경로

이 경로는 먼저 ForgeOntologyEngine이 intent를 분류합니다.

대표 분기는 다음과 같습니다.

- EXPLAIN_PROBLEM -> MCQ 파싱 후 solve_items 호출
- CONCEPT_EXPLAIN -> concept_explain_leg 경로
- QUESTION_SEARCH -> DB 기반 유사 문제 조회
- ETC -> 일반 응답

즉, 동일 API여도 실제 내부 파이프라인은 intent에 따라 완전히 달라집니다.

---

## 3. Why This Pipeline Is Robust (4:30-6:30)

이 구현의 강점은 실패를 전제로 설계됐다는 점입니다.

### 3.1 검색 폴백

- 필터 후 문서가 너무 적으면 조건을 완화
- 그래도 부족하면 전체 후보를 사용
- 컨텍스트가 빈약하면 narrative fallback 지식 보강

### 3.2 생성 폴백

- JSON 파싱 실패 시 다중 추출 전략
- body/audit 불완전 시 repair_problem_explain_leg_audit 재호출
- refined_evidence의 id/관련성 재검증

### 3.3 운영 폴백

- 메모리 LRU + 디스크 캐시
- 세마포어로 과부하 제어
- 요청/응답 JSONL 로깅

이 세 가지가 결합되어 장애 확률을 낮추고 응답 일관성을 높입니다.

---

## 4. Current Technical Evaluation (6:30-8:50)

### 4.1 강점

1. 계층 분리가 명확함
- API, intent 분석, RAG 실행, 저장/캐시가 모듈 단위로 분리

2. 근거 추적 가능성 확보
- Problem Explain LEG 구조 + audit.refined_evidence

3. 실무형 방어 코드 보유
- 파싱 실패, 검색 부족, 문맥 부족 상황에 대한 대비 존재

### 4.2 리스크

1. Chroma SQLite 병목
- 락 충돌 회피를 위해 병렬 제한 필요
- 트래픽 급증 시 큐 대기 증가

2. 재랭킹 정교도 제한
- 현재는 규칙 기반 relevance가 중심
- 고난도 문항에서 미세 순위 오차 발생 가능

3. 좌표 정합 검증 부족
- ontology 결과를 강하게 검증하는 계층이 상대적으로 약함

4. 관측성 부족
- 로그는 있으나 품질 KPI 대시보드화는 미흡

---

## 5. Recommended Roadmap (8:50-10:40)

### P0: 즉시

- 실패 유형 KPI 분리
  - retrieval_empty_rate
  - audit_repair_rate
  - fallback_injection_rate
  - cache_hit_rate

- Ollama timeout/backoff 표준화

### P1: 단기

- semantic reranker 추가
- evidence span 추출(문서 전체가 아닌 근거 구간)
- ontology 좌표 허용 범위 검증

### P2: 중기

- 저장 계층 락 민감도 완화(구조 분리 검토)
- 자동 평가 루프(골드셋 기반 정기 회귀 테스트)

예상 효과는 단순 정확도 상승보다 "안정적 품질" 확보에 더 큽니다.

---

## 6. Closing (10:40-11:20)

정리하면, python_api는 이미 운영형 RAG의 핵심 요건을 갖췄습니다.

- 강한 점: 안정성, 근거 추적성, 모듈 분리
- 개선점: 재랭킹, 좌표 정합, 관측성

따라서 다음 단계의 핵심은 모델 교체보다 파이프라인 정교화입니다.

특히 "검색 성능" 자체가 아니라 "검색 결과를 정답/해설 품질로 연결하는 후단 구성"이 최종 성능의 결정요인이라는 점이 가장 중요한 기술적 결론입니다.

---

## Appendix: 예상 질문과 답변 포인트

Q1. 왜 세마포어를 쓰나요?
- A: Chroma SQLite 락 충돌을 완화해 안정성을 얻기 위해서입니다. 처리량은 일부 제한되지만 장애 확률이 크게 낮아집니다.

Q2. 왜 B처럼 검색이 좋아도 품질이 낮을 수 있나요?
- A: 검색은 후보를 주는 단계이고, 최종 답변 품질은 후보를 선택/조합/설명하는 후단 추론 설계에 좌우되기 때문입니다.

Q3. 현재 가장 큰 기술 부채는 무엇인가요?
- A: 의미기반 재랭킹의 부재와 좌표 정합 검증 부족, 그리고 운영 KPI 가시화 부족입니다.
