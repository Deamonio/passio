# 🚀 Forge 주간 배치 시스템 - 빠른 시작 가이드

> **작성일**: 2026-05-13  
> **대상**: Forge AI 튜터 시스템 주간 관리 담당자

---

## 📌 개요

Forge 시스템의 **주간 정기 처리(Weekly Batch)**를 자동화하는 통합 시스템입니다.

**핵심 목표:**
- ✅ 데이터 품질 유지 (문제 정제, 온톨로지 태깅)
- ✅ RAG 지식베이스 최신화 (PDF/Markdown 반영)
- ✅ 성능 모니터링 (주간 평가 메트릭)
- ✅ 시스템 안정성 (백업, 헬스 체크)
- ✅ 리소스 최적화 (캐시 정리, 로그 정리)

---

## 🛠️ 생성된 파일 목록

| 파일 | 기능 | 주간 실행 | 소요 시간 |
|------|------|---------|---------|
| `python_api/scripts/run_weekly_batch.py` | **통합 배치 오케스트레이터** | ⭐ 메인 | 2.5~3시간 |
| `python_api/scripts/health_check_and_backup.py` | 헬스 체크 + DB/Chroma 백업 | Step 1-2 | 20분 |
| `python_api/scripts/validate_ontology_structure.py` | 온톨로지 구조 검증 | Step 3 | 5분 |
| `python_api/scripts/cache_cleanup.py` | 캐시/로그 정리 | Step 8 | 5분 |
| `WEEKLY_WORKFLOW_GUIDE.md` | 상세 설명서 | 참고 | - |

---

## 🎯 실행 방법 (3가지)

### **방식 1: 직접 실행 (테스트)**
```bash
cd /home/ubuntu/forge

# 단계별 상세 로그와 함께 실행
python3 python_api/scripts/run_weekly_batch.py

# 실행 결과 확인
cat logs/weekly_batch_result.json
```

### **방식 2: Crontab (Linux 스케줄러)**
```bash
# crontab -e 로 열고 다음 추가 (매주 일요일 새벽 2시)
0 2 * * 0 cd /home/ubuntu/forge && python3 python_api/scripts/run_weekly_batch.py

# 설정 확인
crontab -l | grep weekly_batch
```

### **방식 3: PM2 (권장 - 현재 운영 도구)**
```bash
# ecosystem.config.js 에 추가
{
  name: "forge-weekly-batch",
  script: "python_api/scripts/run_weekly_batch.py",
  interpreter: "/usr/bin/python3",
  cron: "0 2 * * 0",
  merge_logs: true,
  error_file: "logs/batch_error.log",
  out_file: "logs/batch_out.log"
}

# 재시작
pm2 restart ecosystem.config.js
```

---

## 📊 실행 흐름 (9단계)

```
시작 (예: 일요일 02:00)
   ↓
[1/9] 📊 헬스 체크 (API, DB, Ollama, 디스크) ─ 5분
   ↓
[2/9] 💾 DB 백업 (Postgres + Chroma) ─ 15분
   ↓
[3/9] ✅ 온톨로지 검증 (구조 일관성 확인) ─ 5분
   ↓
[4/9] 🔄 문제 데이터 리로드 (CSV → Postgres) ─ 10분
   ↓
[5/9] 🏷️  온톨로지 태깅 (각 문제의 개념 추출) ─ 30분
   ↓
[6/9] 🔨 RAG DB 재구축 (PDF/MD → 벡터 DB) ─ 45분
   ↓
[7/9] 📈 성능 평가 (120문제 × 3 파이프라인) ─ 60분
   ↓
[8/9] 🧹 캐시 정리 (오래된 파일 삭제) ─ 5분
   ↓
[9/9] 📋 리포트 생성 (결과 JSON) ─ 5분
   ↓
완료 ✅
```

---

## 📋 단계별 설명

### [1/9] 헬스 체크
```
확인 항목:
- ✅ FastAPI RAG 서비스 (http://127.0.0.1:8001)
- ✅ Web 프론트엔드 (http://127.0.0.1:3000)
- ✅ Ollama LLM 서비스 (http://100.79.44.109:11434)
- ✅ PostgreSQL 데이터베이스
- ✅ Chroma 벡터 DB
- ✅ 디스크 여유 공간
- ✅ 시스템 메모리

문제 감지 시 → 경고 후 계속 진행
```

### [2/9] 데이터 백업
```
생성되는 백업 파일:
- ./backups/postgres/questions_backup_YYYYMMDD_HHMMSS.sql
- ./backups/chroma/chroma_db_v18_final_YYYYMMDD_HHMMSS/
- ./backups/config/config_YYYYMMDD_HHMMSS/

자동 정리: 7일 이상 된 백업 삭제
```

### [3/9] 온톨로지 검증
```
검증 내용:
- 모든 과목이 정의되었는가?
- 각 과목에 단원이 있는가?
- 각 단원에 개념이 있는가?
- 개념 중복이 없는가?

문제 발견 시 → 경고만 하고 계속 진행
```

### [4/9] 문제 데이터 리로드
```
프로세스:
1. data/csv/network_questions.csv 읽기
2. 유효성 검증 (누락 값, 형식 확인)
3. 중복 제거 & 손상된 행 제거
4. PostgreSQL questions 테이블 재구성

결과: 최대 ~3000개 문제 로드
```

### [5/9] 온톨로지 태깅
```
각 문제에 대해:
1. ForgeOntologyEngine으로 의도 분석
2. 지식 좌표(과목/단원/개념) 추출
3. questions 테이블의 ontology_tag 업데이트

시간 소요: 문제 수에 따라 (30~60분)
```

### [6/9] RAG DB 재구축
```
지식 소스:
1. PDF: 네트워크관리사.pdf
2. Markdown: theory_only.md
3. 보강 지식: 누락 키워드 서술형

처리:
1. 마크다운 헤더 기반 청킹
2. Ollama bge-m3로 임베딩 생성
3. Chroma에 저장

결과: chroma_db_v18_final/ 업데이트
```

### [7/9] 성능 평가
```
3가지 파이프라인 비교:
1. LLM 단독 (gemma-only)
2. RAG + LLM
3. 온톨로지 + RAG + LLM (Full Pipeline)

지표:
- 정확도 (is_correct)
- 형식 점수 (format_score)
- 근거 커버리지 (evidence_coverage)
- 응답 시간 (latency_sec)
- 신뢰도 (faithfulness)

결과: performance_comparison/results/ 에 CSV/JSON 저장
```

### [8/9] 캐시 정리
```
정리 대상:
- 7일 이상 된 solve_cache 항목
- 30일 이상 된 로그 파일
- 임시 파일 (.tmp, .bak)

절약 용량: 보통 50~200 MB
```

### [9/9] 리포트 생성
```
생성 파일: logs/weekly_batch_result.json

내용:
{
  "timestamp": "2026-05-13T02:45:30",
  "status": "SUCCESS|PARTIAL|FAILED",
  "total_steps": 9,
  "successful_steps": 9,
  "elapsed_seconds": 9123,
  "steps": {
    "health_check": "✅ 완료",
    "backup": "✅ 완료",
    ...
  }
}
```

---

## 🔍 모니터링 및 로그

### 실행 중
```bash
# 실시간 로그 모니터링
tail -f logs/weekly_batch_YYYYMMDD_HHMMSS.log

# PM2 로그 보기
pm2 logs forge-weekly-batch
```

### 실행 후 결과 확인
```bash
# 최종 결과
cat logs/weekly_batch_result.json | jq .

# 헬스 체크 결과
cat logs/health_check_result.json | jq .

# 성능 평가 결과
cat performance_comparison/results/full_pipeline_evaluated_judge.csv | head
```

---

## ⚠️ 주의사항

### 1. 리소스 요구사항
| 항목 | 요구사항 | 비고 |
|------|---------|------|
| CPU | 2+ 코어 | 성능 평가 단계에서 높음 |
| 메모리 | 4GB+ | RAG DB 재구축 시 2GB+ 필요 |
| 디스크 | 2GB+ 여유 | 백업 + 평가 결과 저장 |
| 시간 | 2.5~3시간 | 주말 비업무 시간 권장 |

### 2. 선택적 실행
```bash
# 헬스 체크만 실행
python3 python_api/scripts/health_check_and_backup.py --health-only

# 백업만 실행
python3 python_api/scripts/health_check_and_backup.py --backup-only --cleanup

# 캐시만 정리
python3 python_api/scripts/cache_cleanup.py --dry-run  # 미리보기

# 온톨로지 검증만
python3 python_api/scripts/validate_ontology_structure.py --stats
```

### 3. 오류 처리
- **Step 1-3 (헬스/백업/검증)**: 실패해도 계속 진행
- **Step 4-6 (데이터/태깅/RAG)**: 실패하면 **중단**
- **Step 7 (성능 평가)**: 실패해도 계속 진행
- **Step 8-9 (정리/리포트)**: 실패해도 계속 진행

---

## 📈 개선점 & 향후 계획

### 단기 (1개월)
- [ ] 성능 평가 결과의 자동 이메일/Slack 알림
- [ ] 배치 실행 시간 로그 (병목 지점 분석)
- [ ] 캐시 히트율 모니터링

### 중기 (3개월)
- [ ] 증분 RAG DB 업데이트 (전체 재구축 대신)
- [ ] 병렬 처리 (일부 단계는 동시 실행 가능)
- [ ] 웹 대시보드 (배치 진행률 시각화)

### 장기 (6개월)
- [ ] A/B 테스트 자동화 (모델 비교)
- [ ] 자동 롤백 (성능 저하 시)
- [ ] 비용 추적 (Ollama 호출 비용 등)

---

## 🆘 문제 해결

### 배치가 오래 걸리는 경우
```bash
# 1. 병목 단계 확인
cat logs/weekly_batch_YYYYMMDD_HHMMSS.log | grep -E "^\[.\/"

# 2. 개별 단계 스킵 가능
# run_weekly_batch.py 에서 해당 step 함수 주석 처리

# 3. RAG DB 재구축 스킵 (새 자료 없으면)
# → performance_comparison/run_all.py 만 실행
```

### 백업 용량 초과
```bash
# 구 백업 수동 삭제
rm -rf ./backups/postgres/questions_backup_202405*.sql

# 또는 보관 기간 단축
python3 python_api/scripts/health_check_and_backup.py --cleanup --days-to-keep 3
```

### 성능 평가 실패
```bash
# 개별 파이프라인 테스트
python3 performance_comparison/full_pipeline.py --input sample_120_questions.csv --limit 5

# 결과 확인
cat performance_comparison/results/full_pipeline_results_raw.json | jq '.[:1]'
```

---

## 📚 참고 문서

- **상세 가이드**: [WEEKLY_WORKFLOW_GUIDE.md](WEEKLY_WORKFLOW_GUIDE.md)
- **배포 기록**: [deployment-notes.md](deployment-notes.md)
- **시스템 다이어그램**: [SYSTEM_WORKFLOW_DIAGRAM_GUIDE.md](SYSTEM_WORKFLOW_DIAGRAM_GUIDE.md)

---

## ✅ 체크리스트 (첫 실행 시)

- [ ] 스크립트 권한 확인: `ls -l python_api/scripts/run_weekly_batch.py`
- [ ] 로그 디렉토리 생성: `mkdir -p logs`
- [ ] 백업 디렉토리 생성: `mkdir -p backups/postgres backups/chroma backups/config`
- [ ] 테스트 실행: `python3 python_api/scripts/run_weekly_batch.py`
- [ ] 결과 확인: `cat logs/weekly_batch_result.json`
- [ ] 스케줄러 설정 (Crontab 또는 PM2)
- [ ] 알림 채널 설정 (선택사항)

---

**마지막 업데이트**: 2026-05-13  
**버전**: 1.0  
**상태**: ✅ 프로덕션 준비 완료
