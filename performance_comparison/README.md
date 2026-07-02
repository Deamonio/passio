# Performance Comparison

120문제 샘플에 대해 아래 3개 실험군을 동일 포맷으로 비교합니다.

1. `LLM-only`: 문제만 LLM에 입력
2. `Naive RAG`: 문제 전체 텍스트로 RAG 검색 후 LLM에 근거+문제 입력
3. `Full Pipeline`: 온톨로지 분석 + RAG solve 전체 경로

## Output Format

모든 실험군은 동일한 해설 텍스트 구조로 저장됩니다.

- `[정답]`
- `[정답 근거]`
- `[오답 포인트]`
- `[한줄 요약]`

## Metrics (해설 전용 4대 지표)

1. `지식 좌표 일치도 (Knowledge Mapping Precision)`

- `좌표일치도`: 예측 좌표(`pred_subject`)와 정답 과목 좌표 일치율
- `계층이탈률`: 해설 내 타 과목 개념 침범 비율

2. `근거충실도 (Faithfulness)`
공식:

$$
Score = \frac{\#(근거 문서로 지지되는 해설 문장)}{\#(해설 전체 문장)}
$$

3. `근거 정밀도 (Context Precision)`
상위 K 근거 문서의 랭크 가중 평균 관련도 점수.

4. `정답정확도 (Answer Correctness)`
`AI_정답 == 답`이면 1, 아니면 0.

5. `논리적 정답 추론력 (Reasoning Accuracy)`

- `오답소거논리점수`: 4개 보기 오답 근거 설명의 완결성
- `전문용어정확도`: 온톨로지 표준 용어 정합성

6. `LLM-as-a-Judge` (필수)

- 점수: `LLM_정확성_1to5`, `LLM_완결성_1to5`, `LLM_가독성_1to5`
- 기본 모델: `gpt-4o`
- `--require-judge=1` 기본값: API 키 없으면 평가 실패(필수 모드)

7. `시간 측정`

- `latency_sec`: 생성 파이프라인 지연
- `judge_latency_sec`: LLM Judge 호출 지연
- `eval_latency_sec`: 전체 평가 계산 지연
1~5점 리커트 스케일. `OPENAI_API_KEY`가 있으면 LLM judge(`gpt-4o` 기본), 없으면 규칙 기반 대체 점수 사용.

파생 지표:

- `환각발생률 = 1 - 근거충실도`
- `오답원인`(잘못된 문서 참조/환각/논리 오류 등)

## Run

사전 조건:

- Ollama 서버 실행 (`gemma3:latest` 모델 준비)
- API 서버 실행 (`http://127.0.0.1:8001`)

전체 실행:

```bash
cd /home/ubuntu/forge/performance_comparison
python3 run_all.py --input sample_120_questions.csv --limit 0
```

빠른 검증(예: 5문제):

```bash
python3 run_all.py --input sample_120_questions.csv --limit 5

# LLM-as-a-Judge 사용(필수 기본)
export OPENAI_API_KEY=...
python3 run_all.py --input sample_120_questions.csv --judge-model gpt-4o

# 로컬 임시 검증(비권장): judge 비필수
python3 run_all.py --input sample_120_questions.csv --require-judge 0
```

## Key Files

- `common.py`: 공통 로더/포맷/스코어 유틸
- `gemma_only.py`: 실험군 A
- `rag_with_gemma.py`: 실험군 B
- `full_pipeline.py`: 실험군 C
- `evaluation.py`: 실험 결과 평가
- `performance_analysis.py`: 요약표/그래프/리포트 생성
- `results/`: 결과 CSV, 그래프, 리포트

## DDR/DCR Test

권장 정의(반복 실행 테스트):

- `DDR (Deterministic/Decision Reproducibility Rate)`: 동일 문항을 여러 번 실행했을 때 답변이 일관되게 동일한 비율
- `DCR (Decision Change Rate)`: 동일 문항 반복 실행에서 답변이 바뀐 비율 (`DCR = 1 - DDR`)

레거시(결함 기반) 모드도 지원:

- `metric-mode=defect`에서 기존 방식의 `DDR(결함률)`/`DCR(결함개선률)` 계산

스크립트:

- `ddr_dcr_test.py`

실행 예시:

```bash
cd /home/ubuntu/forge/performance_comparison

# 권장 모드(consistency): 반복 실행 결과로 DDR/DCR 계산
python3 ddr_dcr_test.py \
	--metric-mode consistency \
	--runs results/full_pipeline_evaluated_judge.csv results/gemma_only_evaluated_judge.csv \
	--answer-column AI_정답 \
	--output-json results/ddr_dcr_summary.json

# 레거시 모드(defect): 정답/환각/형식/LLM 점수 게이트 기준 결함
python3 ddr_dcr_test.py \
	--metric-mode defect \
	--mode quality \
	--target results/full_pipeline_evaluated_judge.csv \
	--baseline results/gemma_only_evaluated_judge.csv
```
