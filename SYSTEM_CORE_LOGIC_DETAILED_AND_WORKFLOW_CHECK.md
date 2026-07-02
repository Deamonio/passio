# Forge 시스템 핵심 로직 상세 설명 + Workflow PDF 일치성 점검

작성일: 2026-06-01
기준: 현재 저장소 코드(실행 로직 기준)

---

## 1) 한 줄 요약

Forge의 핵심은 `의도/좌표 분석(온톨로지) -> 분기 라우팅(REG) -> RAG/LEG 생성 -> (선택) 문제검색 결합` 구조입니다.  
주간 운영은 별도 배치 오케스트레이터가 `검증/리로드/태깅/DB 재구축/평가/정리`를 순차 실행합니다.

---

## 2) 온라인 추론 핵심 로직 (실시간 API)

### 2.1 진입점
- 엔드포인트: `/api/v1/forge/analyze` (동일 로직으로 `/api/forge/analyze`, `/api/ontology/analyze` 등도 매핑)
- 입력: `payload`, `history`, `conversation_key`

### 2.2 1단계: 온톨로지 분석
- `ForgeOntologyEngine.analyze(...)`가 다음을 생성
1. intent
2. intent_sequence (복합 요청 순서)
3. status (COMPLETE/INCOMPLETE)
4. coordinate / coordinates (과목/단원/개념)
5. entities, search_query
6. target_engine

핵심 포인트:
- 단일 intent가 아니라 복합 intent를 순서대로 처리하도록 설계됨
- 후속 대화(follow-up) 문맥을 반영해 좌표/질의를 보강함

### 2.3 2단계: 라우팅(REG) 분기
`status`, `intent`, `intent_sequence`, 사용자 문면을 종합해 실제 실행 경로(route)를 결정합니다.

주요 route 문자열(코드 기준):
- `ontology>etc`
- `ontology>rag>leg`
- `ontology>rag>concept-leg`
- `ontology>rag`
- `ontology>db>question-search`
- `ontology>rag>leg+db>question-search`
- `ontology>rag>concept-leg+db>question-search`

### 2.4 3단계: 해설 생성(LEG/RAG)
#### A. 문제 해설 LEG (`ontology>rag>leg`)
- 시험문항 형태를 파싱해 `ExamItem` 구성
- `solve_items(...)` 호출
- 결과: `report + evidence`

#### B. 개념 해설 LEG (`ontology>rag>concept-leg`)
- 문제 블록이 없거나 개념 설명이 중심일 때 개념 해설 생성기로 진입
- 필요 시 추천문제 검색과 결합 가능

#### C. 일반 RAG (`ontology>rag`)
- LEG 조건이 아니면 일반 RAG 답변 생성

#### D. 문제 검색 결합 (`...+db>question-search`)
- 사용자 요청이 "유사문제/관련문제" 계열이면 DB 질의 결과를 함께 응답

### 2.5 4단계: RAG 내부 품질 안전장치 (`solve_items`)
`solve_items`는 단순 검색-생성이 아니라 복수 안전장치를 갖습니다.

1. 캐시 우선 조회 (`solve_cache`)
2. 검색 질의 구성
- 온톨로지 search_query 우선
- 필요 시 문제 본문 fallback 질의
3. 벡터 검색 + 점수/길이/관련성 필터
4. 필터 결과 부족 시 완화 fallback
5. 표 형식 문서의 서술형 변환(table fix)
6. 컨텍스트 예산 기반 선택(문서 수/문자 수 제한)
7. 보고서 생성 후 body 검증/재시도
8. refined_evidence 감사(audit) 정규화/복구
9. evidence_id 동기화 + 최종 캐시 저장

즉, "한 번 생성"이 아니라 "검색 품질 확보 -> 생성 품질 검증 -> 근거 일관성 보정"까지 포함된 파이프라인입니다.

### 2.6 특수 경로: 모의고사 분석
- 모의고사 컨텍스트가 감지되면 `MOCK_EXAM_ANALYZE` 분기가 선행될 수 있음
- 오답 패턴/취약과목/개념 추출 및 후속 추천 흐름을 별도 처리

---

## 3) 주간 배치 핵심 로직

오케스트레이터: `python_api/scripts/run_weekly_batch.py`

실행 단계(코드상 9단계):
1. health check
2. backup
3. ontology structure validation
4. CSV reload
5. ontology tagging
6. RAG DB rebuild
7. performance evaluation
8. cache cleanup
9. weekly report generation

### 3.1 단계별 실제 실행 스크립트
- 1~2단계: `health_check_and_backup.py`
- 3단계: `validate_ontology_structure.py`
- 4단계: `reload_questions_from_csv.py`
- 5단계: `batch_tag_questions_ontology.py`
- 6단계: `RAG/main.py`
- 7단계: `performance_comparison/run_all.py`
- 8단계: `cache_cleanup.py`
- 9단계: 오케스트레이터 내부 JSON 요약 생성

---

## 4) Workflow PDF 일치성 점검 결과

## 결론
현재 워크스페이스에서 확인 가능한 PDF는 `data/pdf/network.pdf` 1개이며, 내용은 "네트워크관리사 교재 표지" 이미지입니다.  
즉, 시스템 워크플로우 다이어그램 PDF가 아니므로 "워크플로우와 로직 일치성"을 직접 검증할 수 없습니다.

## 확인 근거
- PDF 텍스트 추출 결과: 유의미한 워크플로우 텍스트 없음
- 페이지 시각 확인 결과: 프로세스 다이어그램이 아닌 책 표지

따라서 "위 workflow.pdf"가 별도 파일이라면 해당 파일(또는 경로)을 지정해주면 정확 대조가 가능합니다.

## 4.1 첨부 도식(이미지) 기준 일치성 점검

사용자가 추가로 제공한 시스템 도식 이미지를 기준으로, 실제 코드와 항목별로 대조한 결과입니다.

### 전체 판단
- 전반 구조는 대체로 일치 (약 80~90%)
- 특히 "Ontology 분석 -> REG 라우팅 -> RAG/LEG 생성 -> 근거 검증"의 큰 골격은 코드와 동일
- 다만 일부는 도식이 단순화되어 있어 코드의 실제 분기/검증 조건보다 좁게 표현됨

### 항목별 대조표
| 도식 항목 | 코드 일치 여부 | 점검 결과 |
|---|---|---|
| User Query Layer (Next.js -> FastAPI) | 일치 | 웹(Next.js)와 API(FastAPI) 분리 구조가 실제와 일치 |
| Request Analysis (Intent, Intent Sequence, is_topic_switch, coordinate, status, query rewriting) | 일치 | 온톨로지 엔진 출력 스키마가 동일 개념을 포함 |
| REG Route Controller | 대부분 일치 | Problem/Concept/Question 분기는 맞지만, 실제 코드는 복합 route(LEG+DB 결합)가 더 많음 |
| Question Request -> Database 경로 | 부분 일치 | 실제는 DB 단독뿐 아니라 LEG 결과와 DB 추천문제 결합 경로도 존재 |
| RAG 검색 + Chroma | 일치 | 벡터 검색 기반 및 관련성 필터/완화 fallback 구조 존재 |
| DB Query (PostgreSQL) | 일치 | question bank/related question 조회 경로 존재 |
| Response Generation (LLM 해설 생성) | 일치 | LEG report(overview/analysis/correction/insight/answer) 생성 구조와 부합 |
| Refined Evidence Verification | 부분 일치 | 검증/복구 로직은 존재하나 "문서 수 >= 2"가 절대 하드룰로 강제되지는 않음 |
| Response Body Audit | 일치 | body 유효성 검사 및 재시도 로직 존재 |
| Auto-Correction Engine | 일치 | audit 복구 + 확장 컨텍스트 재시도로 자동 보정 수행 |
| LLM 최종 정제 | 일치 | 최종 응답 생성 단계에서 정규화/정제 수행 |

### 도식이 코드보다 단순화된 지점 (중요)
1. REG 분기의 실제 route 수
- 도식: Problem/Concept/Question 중심
- 코드: `ontology>rag>leg`, `ontology>rag>concept-leg`, `ontology>db>question-search`, `ontology>rag>leg+db>question-search`, `ontology>rag>concept-leg+db>question-search`, `ontology>rag`, `ontology>etc` 등 다중 경로

2. 상태(Status) 기반 "Redirect to Chat" 표현
- 도식: 상태 미충족 시 redirect
- 코드: status가 INCOMPLETE일 때 `assistant_message`를 즉시 반환하는 형태이며, 별도 "redirect 노드"가 구현된 것은 아님

3. 근거 검증의 문서 수 조건
- 도식: supporting documents count >= 2를 명시
- 코드: refined evidence 비어있음/불일치 복구는 강하게 수행하지만, 항상 2개 이상을 강제하는 절대 규칙은 아님

### 코드 기준 최종 결론
- 첨부 도식은 "논문/설계 설명용 상위 아키텍처"로는 매우 잘 맞음
- 운영/구현 상세를 정확히 반영하려면, route 문자열과 결합 경로(LEG+DB), 그리고 audit 조건의 실제 강제 수준을 주석으로 보완하는 것이 가장 정확함

---

## 5) 코드 vs 가이드 불일치(중요)

아래는 워크플로우 문서와 실제 코드 실행 사이의 실질적 차이입니다.

1. CSV 리로드 실제 반영 누락 가능성
- `reload_questions_from_csv.py`는 DB 반영을 위해 `--apply`가 필요함
- 하지만 `run_weekly_batch.py`는 4단계에서 `--apply` 없이 호출
- 결과적으로 "정제/검증 파일 생성만 하고 DB 테이블은 바뀌지 않을 가능성"이 있음

2. 주간 리포트의 평가 파일 체크 경로 불일치
- `run_all.py` 결과 파일명: `full_pipeline_evaluated.csv`
- `run_weekly_batch.py` 9단계 체크 파일명: `full_pipeline_evaluated_judge.csv`
- 결과적으로 성능 결과 존재 판단이 잘못될 수 있음

이 두 항목은 "문서상 기대 동작"과 "실제 운영 동작"을 어긋나게 만들 수 있는 핵심 포인트입니다.

---

## 6) 시스템 로직을 다이어그램으로 그릴 때 필수 반영 요소

다이어그램에는 아래 4개 축이 반드시 들어가야 코드와 동일해집니다.

1. Ontology Analyze (intent + coordinates + search_query)
2. Route Controller(REG) with route strings
3. LEG/RAG 생성 경로 + DB question-search 결합 경로
4. 주간 배치 9단계(특히 reload/apply, evaluation output)

---

## 7) 권장 후속 조치

1. 실제 workflow PDF 파일 경로를 확정해 이 문서의 4절에 "항목별 일치/불일치 표"를 추가
2. `run_weekly_batch.py` 4단계에 `--apply` 추가 여부를 운영 정책에 맞게 확정
3. `run_weekly_batch.py` 9단계 평가결과 파일명 체크를 `full_pipeline_evaluated.csv` 기준으로 정정

---

## 8) 도식에 바로 반영할 수정 라벨 5개

아래 5개 라벨을 도식에 추가/수정하면, 구현 코드와의 정합성이 크게 올라갑니다.

1. REG 출력 라벨 확장
- `ontology>rag>leg`
- `ontology>rag>concept-leg`
- `ontology>db>question-search`
- `ontology>rag>leg+db>question-search`
- `ontology>rag>concept-leg+db>question-search`

2. Status 분기 라벨 정정
- 기존: `Redirect to Chat`
- 권장: `status=INCOMPLETE -> assistant_message 즉시 반환`

3. Request Analysis 라벨 보강
- `intent_sequence (multi-intent order)`
- `payload_onto (follow-up context augmented)`

4. Retrieval 라벨 보강
- `similarity + relevance filter`
- `fallback (완화 필터/원문 재조회)`

5. Audit/Correction 라벨 보강
- `body validation + retry`
- `refined_evidence repair + evidence_id derive`

---

## 9) 현재 도식에서 빠진 핵심 로직

도식의 상위 구조는 정확하지만, 아래 구현 핵심이 빠져 있어 운영 동작을 완전히 설명하진 못합니다.

1. Follow-up 맥락 증강 입력
- 사용자 원문(payload_user)과 별개로, 온톨로지 분석 입력(payload_onto)에 이전 대화 맥락을 증강해 넣는 단계가 있음

2. Multi-intent 순차 실행
- 단일 intent가 아니라 `intent_sequence` 순서에 따라 `MOCK_EXAM_ANALYZE -> CONCEPT_EXPLAIN` 같은 연쇄 실행이 가능함

3. Mock Exam 특수 분기
- 일반 RAG 이전에 모의고사 컨텍스트를 감지해 별도 분석/응답 경로로 우회할 수 있음

4. LEG + 문제검색 결합 응답
- 해설(LEG)만 반환하는 것이 아니라, 같은 응답에서 추천문제 DB 검색 결과를 결합하는 route가 있음

5. RAG 동시성 제어
- solve 실행에 세마포어를 사용해 과도한 병렬 호출을 제어함 (busy/timeout 방지 목적)

6. 검색 2단 fallback
- search_query로 miss가 나면 문제 본문으로 재조회
- 관련성 필터 결과가 부족하면 완화 기준으로 재선정

7. Table-to-Text 변환
- 표 형태 문서를 별도 LLM 호출로 서술형으로 변환 후 본 생성 단계에 투입

8. 컨텍스트 예산화
- 검색된 문서를 전부 넣지 않고 문서별 cap과 총량 budget으로 선택해 품질/속도 균형을 맞춤

9. Body 재시도 + Audit 자동복구
- 응답 body가 부실하면 재생성
- refined evidence 불일치면 서버에서 강제 복구

10. Evidence ID 자동 유도
- 최종 보고서에서 `refined_evidence` 기준으로 `evidence_ids`를 자동 동기화

11. 캐시 오염 방지 정책
- 근거(evidence)가 비어 있는 결과는 캐시에 저장하지 않음

12. 운영 로그 수집 미들웨어
- 요청/응답/지연시간을 API 로그 테이블에 남기는 계측 레이어가 별도로 존재

---

## 부록) 핵심 흐름 요약 다이어그램 (텍스트)

`User Payload`
-> `ForgeOntologyEngine.analyze`
-> `Route Decision`
-> (`LEG` | `Concept LEG` | `General RAG` | `Question Search`)
-> `Assistant Response (+ evidence, optional recommended_questions)`

`Weekly Scheduler`
-> `Health`
-> `Backup`
-> `Validate`
-> `Reload`
-> `Tag`
-> `Rebuild`
-> `Evaluate`
-> `Cleanup`
-> `Report`
