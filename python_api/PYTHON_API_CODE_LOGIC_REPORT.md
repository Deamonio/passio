# Python API 코드 로직 상세 보고서

## 1) 시스템 한 줄 요약
- 이 서비스는 FastAPI 기반의 통합 백엔드이며, 크게 다음 4개 축으로 동작합니다.
- 온톨로지 분석: 사용자 발화를 intent와 지식 좌표로 구조화
- RAG 해설: 문제/개념 설명을 LLM + Chroma 근거 기반으로 생성
- 문제/모의고사 운영: 문제은행 조회, 모의고사 생성/제출/이력
- 운영/관리: 채팅 동기화, 로그, 관리자 API

## 2) 요청 처리의 큰 흐름
1. HTTP 요청이 [python_api/app/main.py](python_api/app/main.py)로 들어옵니다.
2. 미들웨어가 요청/응답을 로깅합니다.
3. 목적에 따라 라우팅됩니다.
- RAG 해설 직행: /api/v1/rag/solve
- 통합 의도 분석: /api/v1/forge/analyze
- 문제은행/모의고사/채팅/관리자 API
4. 핵심 비즈니스는 main 내부 헬퍼와 [python_api/app/rag](python_api/app/rag) 하위 서비스 모듈이 처리합니다.

## 3) 파일별 상세 설명

### A. 앱 루트 계층

#### [python_api/app/main.py](python_api/app/main.py)
- 역할: 전체 엔드포인트 진입점 + 라우팅 오케스트레이션
- 핵심 책임
- 앱 초기화, CORS, 라이프사이클(warmup)
- 공통 로깅 미들웨어
- 통합 분석 엔드포인트에서 intent 기반 분기
- RAG job 큐/이력 API
- 채팅 동기화/공유 API
- 문제은행/모의고사 API
- 관리자 API
- 대표 로직
- forge_analyze:
  - 사용자 입력에서 모의고사 컨텍스트 블록 분리
  - 온톨로지 분석 수행
  - intent_sequence를 기반으로 순차 분기
  - 분기 후보: mock exam 분석, 문제 해설 LEG, 개념 설명 LEG, 문제검색 DB, 일반 RAG
  - 필요 시 복합 응답(예: 해설 + 추천문제)
- _handle_mock_exam_analysis:
  - 모의고사 컨텍스트가 있으면 통계/번호별 해설/관련문제 추천 처리

#### [python_api/app/settings.py](python_api/app/settings.py)
- 역할: 환경변수 기반 런타임 설정 집합
- 핵심 책임
- Ollama 모델/호스트/타임아웃
- RAG 속도/품질 트레이드오프 파라미터
- Chroma 경로, 문서 경로
- 병렬성/토큰 길이 제한

#### [python_api/app/schemas.py](python_api/app/schemas.py)
- 역할: 간단 공용 API 스키마 정의
- 포함 모델
- ExecuteRequest, ExecuteResponse, HealthResponse

#### [python_api/app/models_chat.py](python_api/app/models_chat.py)
- 역할: SQLAlchemy 채팅/사용자 ORM 모델
- 포함 모델
- User, ChatRoom, Message, UserChatRoom
- 참고
- 현재 main의 대부분 DB 접근은 asyncpg SQL 직접 사용이므로, 이 파일은 ORM 호환/확장 기반의 모델 레이어 성격입니다.

#### [python_api/app/utils.py](python_api/app/utils.py)
- 역할: 공용 유틸
- 핵심 함수
- mask_sensitive: 로그 저장 시 password/token류 키 마스킹

#### [python_api/app/__init__.py](python_api/app/__init__.py)
- 역할: 패키지 마커
- 내용: 빈 파일

---

### B. RAG 핵심 계층

#### [python_api/app/rag/engine.py](python_api/app/rag/engine.py)
- 역할: 문제 해설 생성 엔진의 본체
- 핵심 함수
- solve_items:
  - 입력 ExamItem 리스트 순회
  - 캐시 조회
  - 벡터 검색 및 관련성 필터
  - 컨텍스트 예산(budget) 기반 문맥 구성
  - LEG 프롬프트로 JSON 생성
  - body/audit 품질 검증 및 복구
  - evidence_ids 정규화
  - 결과 캐시 저장
- 부가 로직
- 표 형식 문서를 서술형으로 사전 변환
- force_rebuild 시 보강 지식 삽입
- 타이밍 로그 출력

#### [python_api/app/rag/models.py](python_api/app/rag/models.py)
- 역할: RAG 요청/응답 모델
- 포함 모델
- ExamItem, SolveRequest, EvidenceItem, SolveResult, SolveResponse
- 특징
- ExamItem은 q, opts, wrong, ans 검증기 내장
- 온톨로지 좌표/사용자 추가요청 필드를 함께 담아 엔진에 전달

#### [python_api/app/rag/chroma_store.py](python_api/app/rag/chroma_store.py)
- 역할: Chroma 영속 스토어 안전 초기화
- 핵심 책임
- 디렉터리 권한/존재 확인
- sqlite tenant/database 기본 행 보강
- 잠금/재시도 처리
- LangChain Chroma 객체 생성

#### [python_api/app/rag/solve_cache.py](python_api/app/rag/solve_cache.py)
- 역할: 해설 결과 캐시
- 구조
- 메모리 LRU + 디스크 JSON 이중 캐시
- TTL, 최대 개수, 경로를 env로 제어
- 핵심 함수
- solve_cache_key, solve_cache_get, solve_cache_set

#### [python_api/app/rag/problem_explain_leg.py](python_api/app/rag/problem_explain_leg.py)
- 역할: 문제 해설 LEG 프롬프트/파서/검증
- 핵심 함수
- build_problem_explain_leg_prompt
- extract_problem_explain_leg_json
- normalize_problem_explain_leg_report
- is_problem_explain_leg_body_valid
- repair_problem_explain_leg_audit

#### [python_api/app/rag/concept_explain_leg.py](python_api/app/rag/concept_explain_leg.py)
- 역할: 개념 설명 LEG 프롬프트/출력 포맷
- 핵심 함수
- build_concept_explain_leg_prompt
- format_concept_explain_leg_for_chat

#### [python_api/app/rag/mcq_payload.py](python_api/app/rag/mcq_payload.py)
- 역할: 자유 텍스트에서 문제/보기 구조 파싱
- 핵심 함수
- parse_mcq_payload_details
- parse_mcq_from_payload
- try_build_exam_item_for_explain_problem
- format_leg_report_for_chat

#### [python_api/app/rag/conversation_context.py](python_api/app/rag/conversation_context.py)
- 역할: 대화 이력 기반 보정
- 핵심 함수
- augment_payload_for_ontology_followup
- history_suggests_problem_explain
- format_history_for_leg_prompt
- 의미
- 짧은 후속 입력이 와도 이전 맥락(해설 요청)을 유지하도록 보조

#### [python_api/app/rag/etc_reply.py](python_api/app/rag/etc_reply.py)
- 역할: ETC intent 전용 자연 대화 답변 생성
- 특성
- 온톨로지 학습 요청이 아닌 잡담/일반대화 처리

#### [python_api/app/rag/rag_service.py](python_api/app/rag/rag_service.py)
- 역할: main에서 분리된 실행 서비스 레이어
- 핵심 함수
- find_related_questions: PostgreSQL trigram 검색
- format_question_search_reply
- build_general_rag_reply
- build_concept_explain_leg_reply
- resolve_referenced_question_payload: #1 같은 추천문제 참조 확장

#### [python_api/app/rag/mock_exam_service.py](python_api/app/rag/mock_exam_service.py)
- 역할: 모의고사 컨텍스트 처리 전담
- 핵심 함수
- 컨텍스트 블록 추출/제거
- 번호 지정 문제 추출
- 번호 지정 LEG 해설 생성
- 모의고사 요약/빈출 개념 추출
- 모의고사 맥락 LLM 답변 생성

#### [python_api/app/rag/ontology_engine.py](python_api/app/rag/ontology_engine.py)
- 역할: 통합 의도 및 지식 좌표 분석 엔진
- 핵심 클래스
- Coordinate, ForgeAnalysis, ForgeOntologyEngine
- 핵심 동작
- 지식 구조 JSON 로딩
- 시스템 프롬프트로 intent/status/coordinate/search_query 생성
- 좌표 유효성 검증 및 정규화
- fallback 분석 결과 제공

#### [python_api/app/rag/__init__.py](python_api/app/rag/__init__.py)
- 역할: 패키지 마커
- 내용: 빈 파일

---

### C. Ontology 분류 보조 계층

#### [python_api/app/rag/ontology/__init__.py](python_api/app/rag/ontology/__init__.py)
- 역할: ontology 서브패키지 설명

#### [python_api/app/rag/ontology/intents/common.py](python_api/app/rag/ontology/intents/common.py)
- 역할: intent 판정 공통 유틸
- 함수
- normalize_lookup_text
- extract_requested_question_count
- analysis_intent_sequence

#### [python_api/app/rag/ontology/intents/question_search_intent.py](python_api/app/rag/ontology/intents/question_search_intent.py)
- 역할: QUESTION_SEARCH 분기 규칙
- 함수
- has_explicit_question_search_request
- wants_question_search
- payload_has_question_block
- payload_wants_question_search

#### [python_api/app/rag/ontology/intents/mock_exam_intent.py](python_api/app/rag/ontology/intents/mock_exam_intent.py)
- 역할: MOCK_EXAM_ANALYZE 분기 규칙
- 함수
- payload_excludes_mock_context
- wants_mock_exam_analysis

#### [python_api/app/rag/ontology/intents/__init__.py](python_api/app/rag/ontology/intents/__init__.py)
- 역할: intent helper export 집합
- 의미
- main에서 필요한 helper를 한 곳에서 import 가능하게 정리

## 4) 통합 분석 엔드포인트 상세 시퀀스
- 대상: [python_api/app/main.py](python_api/app/main.py) 의 forge_analyze

1. 입력 정리
- payload, history 수신
- 모의고사 컨텍스트 마커 블록 제거/탐지

2. 빠른 모의고사 분기 선체크
- wants_mock_exam_analysis가 true면 모의고사 분석 경로 우선 시도

3. 온톨로지 분석
- ForgeOntologyEngine.analyze 호출
- intent, intent_sequence, coordinate, search_query 확보

4. intent 교정
- 사용자가 모의고사 제외를 명시한 경우 MOCK_EXAM_ANALYZE 제거 후 CONCEPT_EXPLAIN으로 보정

5. 본 분기 처리
- MOCK_EXAM_ANALYZE: _handle_mock_exam_analysis
- ETC: build_etc_reply
- EXPLAIN_PROBLEM 가능 시: mcq 파싱 후 solve_items 기반 LEG 생성
- QUESTION_SEARCH 동반 시: DB 문제 추천 결합
- CONCEPT_EXPLAIN: concept LEG 생성
- 최종 fallback: 일반 RAG 답변

6. 응답 조합
- analysis + assistant_message + route
- 필요 시 leg, rag evidence, recommended_questions 동시 반환

## 5) 모의고사 분석 경로 상세
- 대상: [python_api/app/main.py](python_api/app/main.py) 의 _handle_mock_exam_analysis + [python_api/app/rag/mock_exam_service.py](python_api/app/rag/mock_exam_service.py)

1. context 추출 실패 시 즉시 종료
2. MOCK_EXAM_ANALYZE 단계가 아니면 종료
3. 번호 지정 해설 요청이면 build_mock_numbered_leg_reply 우선
4. 특정 개념 포함 문항 조회 요청이면 term lookup 응답
5. 일반 분석 요청이면 build_mock_exam_leg_reply
6. 관련 문제 요청이 동반되면 find_related_questions 결합
7. intent_sequence에 CONCEPT_EXPLAIN이 있으면 개념 LEG를 추가 결합

## 6) 문제 검색 로직 상세
- 대상: [python_api/app/rag/rag_service.py](python_api/app/rag/rag_service.py)

1. 검색어 구성
- 온톨로지 좌표, search_query, entities, payload 토큰 결합
2. DB 검색
- trigram similarity + subject 가중치
3. 결과가 빈약하면 fallback
- subject 기반 최신 문제 또는 전체 최신 문제
4. 사용자 응답 문구 생성
- 추천 개수/후속 액션 안내 포함

## 7) 현재 구조의 장점
- 분기 로직과 실행 로직 분리
- intent helper 모듈화로 규칙 변경이 쉬움
- LEG 품질 가드(검증/복구) 내장
- 모의고사 맥락 처리가 별도 서비스로 분리됨

## 8) 코드 읽을 때 추천 진입 순서
1. [python_api/app/main.py](python_api/app/main.py)
2. [python_api/app/rag/ontology_engine.py](python_api/app/rag/ontology_engine.py)
3. [python_api/app/rag/ontology/intents/common.py](python_api/app/rag/ontology/intents/common.py)
4. [python_api/app/rag/ontology/intents/question_search_intent.py](python_api/app/rag/ontology/intents/question_search_intent.py)
5. [python_api/app/rag/ontology/intents/mock_exam_intent.py](python_api/app/rag/ontology/intents/mock_exam_intent.py)
6. [python_api/app/rag/rag_service.py](python_api/app/rag/rag_service.py)
7. [python_api/app/rag/mock_exam_service.py](python_api/app/rag/mock_exam_service.py)
8. [python_api/app/rag/engine.py](python_api/app/rag/engine.py)
9. [python_api/app/rag/problem_explain_leg.py](python_api/app/rag/problem_explain_leg.py)
10. [python_api/app/rag/mcq_payload.py](python_api/app/rag/mcq_payload.py)

## 9) 이해 포인트 요약
- ontology 계층은 중간 분류소가 맞습니다.
- main은 최종 오케스트레이터, rag 하위는 실행 서비스입니다.
- intents는 분석 결과를 라우팅 조건으로 바꾸는 룰 엔진입니다.
- solve_items는 실제 문제 해설 품질을 책임지는 핵심 엔진입니다.
