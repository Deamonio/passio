# LLM-only vs Full Pipeline 비교 보고서

## 1. 실험 조건
- 문항 수: 120문항
- 반복 횟수: LLM-only 10회, Full Pipeline 10회
- 총 실행 수: LLM-only 1200회, Full Pipeline 1200회
- DDR/DCR 기준: consistency 모드 (동일 문항 반복 실행 일치/변경)

## 2. 핵심 비교 요약
| 항목 | LLM-only | Full Pipeline |
|---|---:|---:|
| DDR | 100.00% | 100.00% |
| DCR | 0.00% | 0.00% |
| 평균 정확도 | 75.00% | 71.67% |
| 정확도 범위(최소~최대) | 75.00% ~ 75.00% | 71.67% ~ 71.67% |
| 평균 지연시간(초/문항) | 5.65 | 9.68 |
| 지연 범위(최소~최대, 초/문항) | 5.58 ~ 5.82 | 6.65 ~ 35.53 |
| 총 실행시간(10회 합계) | 113.00분 (1.88시간) | 193.55분 (3.23시간) |

## 3. 해석
- 일관성: 두 실험군 모두 DDR 100%, DCR 0%로 반복 실행에 대해 완전한 결정성을 보였습니다.
- 정확도: LLM-only가 Full Pipeline 대비 3.33%p 높았습니다. (75.00% vs 71.67%)
- 속도: LLM-only가 평균 1.71배 빠릅니다. (5.65초 vs 9.68초 / 문항)
- 운영 관점: 현재 설정에서는 변동성 리스크보다 정확도/지연시간 트레이드오프가 주요 의사결정 포인트입니다.

## 4. 권장 사항
- 품질 우선(정확도+속도): 현재 데이터셋 기준으로 LLM-only 우세
- 근거/설명 품질 우선: Full Pipeline의 RAG 근거 및 구조화된 해설 장점 유지
- 다음 단계: 동일 34개 오답 문항(Full Pipeline)과 30개 오답 문항(LLM-only)을 교집합/차집합 분석하여 개선 타깃 분리

## 5. 참조 파일
- LLM-only DDR/DCR 요약: results/repeats_gemma_only/ddr_dcr_consistency_summary.json
- Full Pipeline DDR/DCR 요약: results/repeats_full_pipeline/ddr_dcr_consistency_summary.json