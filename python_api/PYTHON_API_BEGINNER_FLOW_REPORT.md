# Python API 초보자용 흐름도 설명

## 1) forge_analyze만 집중 설명
- 대상 엔드포인트: [python_api/app/main.py](python_api/app/main.py)
- 함수: forge_analyze

### 한 줄 요약
- 사용자의 문장을 보고 "지금 어떤 작업을 해야 하는지" 결정한 뒤, 그에 맞는 처리기(RAG/문제검색/모의고사)로 보내는 관제탑입니다.

### 단계별 흐름
1. 입력 수신
- payload(현재 질문), history(이전 대화)를 받습니다.

2. 모의고사 컨텍스트 분리
- 메시지 안에 모의고사 결과 블록이 있으면 분리해서 별도 컨텍스트로 잡습니다.

3. 온톨로지 분석 호출
- [python_api/app/rag/ontology_engine.py](python_api/app/rag/ontology_engine.py) 로 intent, intent_sequence, search_query, coordinate를 생성합니다.

4. intent 보정
- 사용자가 "모의고사 무관" 같은 요청을 하면 MOCK_EXAM_ANALYZE를 제거하고 CONCEPT_EXPLAIN 쪽으로 수정합니다.

5. 실제 분기 실행
- MOCK_EXAM_ANALYZE면 모의고사 분석 처리
- EXPLAIN_PROBLEM이면 문제 파싱 후 LEG 해설 처리
- QUESTION_SEARCH면 DB 문제 검색 처리
- CONCEPT_EXPLAIN이면 개념 LEG 처리
- 기타면 일반 RAG 답변 처리

6. 응답 조립
- analysis + assistant_message + route
- 필요 시 leg, recommended_questions, rag.evidence를 함께 반환

## 2) mock exam 분석 경로만 집중 설명
- 대상 함수: _handle_mock_exam_analysis
- 보조 서비스: [python_api/app/rag/mock_exam_service.py](python_api/app/rag/mock_exam_service.py)

### 한 줄 요약
- 모의고사 결과를 읽고, 사용자의 요구(통계/특정 번호 해설/관련 문제 추천)에 맞는 답을 만들어 주는 경로입니다.

### 단계별 흐름
1. 컨텍스트 확보
- 현재 payload + history에서 최근 모의고사 컨텍스트 JSON을 추출

2. 번호 지정 해설 우선
- "3번 해설" 같은 요청이면 해당 번호를 뽑아 RAG LEG 해설 생성

3. 특정 개념 질의 처리
- "VLAN 관련 문제 있었어?" 같은 질문이면 term lookup으로 모의고사 내부 문항 탐색

4. 일반 분석 답변
- 점수/오답/취약 과목/빈출 개념을 기반으로 코칭 답변 생성

5. 관련 문제 요청 결합
- 사용자가 "관련 문제/유사문제"를 같이 요청하면 문제은행 검색을 붙여서 함께 응답

6. concept explain 결합(optional)
- intent_sequence에 CONCEPT_EXPLAIN이 있으면 모의고사 분석 뒤에 개념 LEG도 이어서 생성

## 3) solve_items 내부 품질 복구 로직만 집중 설명
- 대상 파일: [python_api/app/rag/engine.py](python_api/app/rag/engine.py)
- 핵심 함수: solve_items

### 한 줄 요약
- 문제 해설을 만들되, 결과가 부실하면 자동으로 복구/재시도해서 최소 품질을 맞추는 엔진입니다.

### 내부 파이프라인
1. 캐시 조회
- 동일 문제면 메모리/디스크 캐시에서 즉시 반환

2. 벡터 검색
- search_query(없으면 문제 본문)로 Chroma 검색

3. 관련성 필터
- score + 키워드 겹침 기준으로 문서 정제
- 너무 적으면 완화 필터로 fallback

4. 컨텍스트 예산 빌드
- 문서를 점수순으로 뽑되, 총 문자 수 budget 안에서 구성

5. LLM JSON 생성
- Problem Explain LEG 프롬프트로 report 생성

6. body 검증/복구
- overview/analysis가 부실하면 재시도

7. audit/refined_evidence 복구
- 근거 id 불일치/비어 있음/중복이면 서버에서 정규화
- 필요 시 확장 컨텍스트로 1회 더 재생성

8. evidence_ids 재계산 + user_request_trace 보강
- 최종 산출물 일관성을 맞춘 뒤 반환

## 4) rag_service와 engine 차이 (핵심)

### rag_service는 무엇인가
- 파일: [python_api/app/rag/rag_service.py](python_api/app/rag/rag_service.py)
- 성격: 오케스트레이션용 서비스 레이어
- 주 용도
- 문제 검색(find_related_questions)
- 일반 답변(build_general_rag_reply)
- 개념 설명 LEG(build_concept_explain_leg_reply)
- 추천문제 참조 확장(resolve_referenced_question_payload)

### engine은 무엇인가
- 파일: [python_api/app/rag/engine.py](python_api/app/rag/engine.py)
- 성격: 문제 해설 전용 코어 엔진
- 주 용도
- ExamItem 기반 solve_items 실행
- 검색/필터/컨텍스트/JSON 생성/검증/복구/캐시 전담

### 비유로 이해
- rag_service: "상담실 데스크"
- 요청 종류를 보고 적절한 작업 조합을 구성
- engine: "정밀 진단 장비"
- 문제 해설을 고품질로 끝까지 생산

### 언제 무엇을 쓰는가
- 일반 질문/개념 설명/문제 추천: rag_service 경유
- 객관식 문제를 정답/오답까지 포함해 깊게 해설: engine.solve_items

### 왜 분리했는가
- 관심사 분리
- 문제 해설 코어 복잡도와 라우팅 로직 복잡도를 분리
- 유지보수성
- 해설 품질 튜닝은 engine에서 집중
- 분기/조합 정책은 rag_service와 main에서 수정
- 재사용성
- mock exam 번호 해설 같은 곳에서도 같은 solve_items를 재사용 가능

## 5) 실제 코드 읽기 순서(초보자 추천)
1. [python_api/app/main.py](python_api/app/main.py) 의 forge_analyze
2. [python_api/app/rag/ontology_engine.py](python_api/app/rag/ontology_engine.py)
3. [python_api/app/rag/rag_service.py](python_api/app/rag/rag_service.py)
4. [python_api/app/rag/mock_exam_service.py](python_api/app/rag/mock_exam_service.py)
5. [python_api/app/rag/engine.py](python_api/app/rag/engine.py)
