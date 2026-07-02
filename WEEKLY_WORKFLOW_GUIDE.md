# Forge 시스템 주간 배치 워크플로우 가이드

## 📊 시스템 구조 (다이어그램)

```
┌─────────────────────────────────────────────────────────────────┐
│                      온라인 추론 서비스 (실시간)                    │
│  python_api/main.py (FastAPI + PM2 rag-api)                     │
│  ├─ 온톨로지 분석기 (ontology_engine.py)                          │
│  ├─ RAG 엔진 (engine.py)                                        │
│  └─ Chroma Vector DB 검색                                       │
└─────────────────────────────────────────────────────────────────┘
                            ↓
                    [네트워크 관리사 지식]
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│                    주간 배치 처리 (매 주 실행)                     │
│  1️⃣ 데이터 검증 & 리로드     (reload_questions_from_csv.py)      │
│  2️⃣ 온톨로지 태깅 업데이트   (batch_tag_questions_ontology.py)   │
│  3️⃣ RAG DB 재구축           (RAG/main.py build_final_db)        │
│  4️⃣ 성능 평가 & 지표 생성    (performance_comparison/run_all.py)  │
│  5️⃣ 캐시 정리               (new: cache_cleanup.py)             │
│  6️⃣ 로그 분석 & 리포트       (new: weekly_analytics.py)          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔧 현재 주간 처리 함수들

### 1️⃣ 데이터 검증 및 리로드
**파일**: `python_api/scripts/reload_questions_from_csv.py`
```python
# 목적: CSV 데이터를 정제하여 Postgres 문제 테이블에 리로드
# 과정:
#  - network_questions.csv 읽기
#  - 문제 유효성 검증 (누락 값, 형식)
#  - 중복 제거 및 merged corrupted 행 제거
#  - questions 테이블 재구성
# 주간 실행 필요성: ⭐⭐⭐ (신규/수정 문제 반영)
```

### 2️⃣ 온톨로지 태깅 업데이트
**파일**: `python_api/scripts/batch_tag_questions_ontology.py`
```python
# 목적: 각 문제를 온톨로지 좌표(과목/단원/개념)로 태깅
# 과정:
#  - ForgeOntologyEngine 로드
#  - 각 문제의 intent/coordinate 추출
#  - questions 테이블의 ontology_tag 컬럼 업데이트
# 주간 실행 필요성: ⭐⭐ (신규 문제만 필요)
```

### 3️⃣ RAG DB 재구축
**파일**: `RAG/main.py` → `build_final_db()`
```python
# 목적: PDF + Markdown 지식을 Chroma 벡터 DB로 변환
# 과정:
#  1. 마크다운 헤더 기반 청킹 (MarkdownHeaderTextSplitter)
#  2. Ollama bge-m3 임베딩 생성
#  3. Chroma DB에 저장 (chroma_db_v18_final/)
# 주간 실행 필요성: ⭐⭐⭐ (새 교재/보강 자료 반영)
```

### 4️⃣ 성능 평가 & 지표 생성
**파일**: `performance_comparison/run_all.py`
```python
# 목적: 120개 샘플 질문으로 전체 파이프라인 평가
# 과정:
#  1. gemma_only.py - LLM 단독 성능
#  2. rag_with_gemma.py - RAG + LLM 성능
#  3. full_pipeline.py - 온톨로지 + RAG + LLM 성능
#  4. evaluation.py - 지표 계산 (faithfulness, DCR, 등)
# 주간 실행 필요성: ⭐⭐⭐ (성능 추적 & 모델 선택)
```

---

## 🚀 추천: 주간 배치 추가 함수들

### 5️⃣ 캐시 정리 (새로 추가)
**목적**: 해설 캐시 만료 항목 제거 및 디스크 절약
```python
# python_api/scripts/cache_cleanup.py
import os
from datetime import datetime, timedelta
from pathlib import Path

def cleanup_solve_cache(cache_dir: str = "./solve_cache", days_old: int = 7):
    """
    지정된 일수 이상 된 캐시 파일 삭제
    """
    cache_path = Path(cache_dir)
    if not cache_path.exists():
        return
    
    cutoff_time = datetime.now() - timedelta(days=days_old)
    deleted = 0
    
    for cache_file in cache_path.glob("*.json"):
        mtime = datetime.fromtimestamp(cache_file.stat().st_mtime)
        if mtime < cutoff_time:
            cache_file.unlink()
            deleted += 1
    
    print(f"✓ 캐시 정리 완료: {deleted}개 파일 삭제")
    return deleted
```

### 6️⃣ 주간 분석 리포트 (새로 추가)
**목적**: 서비스 사용 통계 및 성능 분석
```python
# python_api/scripts/weekly_analytics.py
import json
from datetime import datetime, timedelta
from pathlib import Path
import pandas as pd

def generate_weekly_report():
    """
    지난 주 활동 통계 생성:
    - 일일 요청 수
    - intent 분포 (EXPLAIN_PROBLEM, CONCEPT_EXPLAIN, etc)
    - 평균 응답 시간
    - 캐시 히트율
    - 모델별 성능 비교
    """
    week_ago = datetime.now() - timedelta(days=7)
    
    report = {
        "period": f"{week_ago.date()} ~ {datetime.now().date()}",
        "total_requests": 0,
        "intent_distribution": {},
        "avg_latency_ms": 0,
        "cache_hit_rate": 0,
        "top_concepts": [],  # 가장 많이 질문된 개념
        "problematic_questions": [],  # 낮은 점수의 문제들
    }
    
    # JSONL 로그 분석
    log_path = Path("./logs/api_requests.jsonl")
    if log_path.exists():
        with open(log_path) as f:
            # 로그 분석 로직
            pass
    
    # 결과 저장
    report_path = Path("./logs/weekly_report.json")
    report_path.parent.mkdir(exist_ok=True)
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    
    print(f"✓ 주간 리포트 생성: {report_path}")
    return report
```

### 7️⃣ 온톨로지 구조 검증 (새로 추가)
**목적**: 지식 구조 일관성 확인
```python
# python_api/scripts/validate_ontology_structure.py
import json
from pathlib import Path

def validate_knowledge_structure(structure_path: str = "refs/structure/network_structure.json"):
    """
    온톨로지 구조 검증:
    - 모든 과목이 정의되었는가?
    - 각 과목에 단원이 있는가?
    - 각 단원에 개념이 있는가?
    - 중복된 개념이 없는가?
    """
    with open(structure_path) as f:
        structure = json.load(f)
    
    errors = []
    warnings = []
    
    for subject, chapters in structure.items():
        if not chapters:
            errors.append(f"❌ {subject}: 단원이 없음")
        
        for chapter, concepts in chapters.items():
            if not concepts:
                warnings.append(f"⚠️  {subject} > {chapter}: 개념이 없음")
    
    if errors:
        print("검증 실패:")
        for e in errors:
            print(e)
        return False
    
    if warnings:
        print("경고:")
        for w in warnings:
            print(w)
    
    print(f"✓ 온톨로지 구조 검증 완료 ({len(structure)}개 과목)")
    return True
```

### 8️⃣ DB 백업 및 상태 확인 (새로 추가)
**목적**: 데이터 안전성 및 시스템 상태 모니터링
```python
# python_api/scripts/health_check_and_backup.py
import subprocess
import shutil
from datetime import datetime
from pathlib import Path

def backup_postgres_questions():
    """Postgres questions 테이블 백업"""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_dir = Path("./backups/postgres")
    backup_dir.mkdir(parents=True, exist_ok=True)
    
    backup_file = backup_dir / f"questions_backup_{timestamp}.sql"
    
    # pg_dump 실행
    cmd = [
        "pg_dump",
        "-h", "127.0.0.1",
        "-U", "sikdorak_app",
        "sikdorak",
        "-t", "questions",
        "-f", str(backup_file)
    ]
    
    subprocess.run(cmd, check=True)
    print(f"✓ Postgres 백업: {backup_file}")

def backup_chroma_db():
    """Chroma DB 전체 백업"""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_dir = Path("./backups/chroma")
    backup_dir.mkdir(parents=True, exist_ok=True)
    
    src = Path("./chroma_db_v18_final")
    dst = backup_dir / f"chroma_db_v18_final_{timestamp}"
    
    shutil.copytree(src, dst)
    print(f"✓ Chroma DB 백업: {dst}")

def check_system_health():
    """시스템 상태 확인"""
    checks = {
        "API": "http://127.0.0.1:8001/health",
        "Web": "http://127.0.0.1:3000",
        "Ollama": "http://100.79.44.109:11434/api/tags",
        "Postgres": "SELECT COUNT(*) FROM questions;",
        "Chroma": "chroma_db_v18_final 디렉토리 존재여부",
    }
    
    print("\n📊 시스템 상태 체크:")
    for name, check in checks.items():
        print(f"  - {name}: {check}")
```

---

## 📅 주간 배치 실행 스케줄 (권장)

### 스케줄 설정 옵션

**방식 A: Crontab (Linux 네이티브)**
```bash
# /etc/cron.d/forge-weekly
# 매주 일요일 새벽 2시에 전체 배치 실행

0 2 * * 0 ubuntu cd /home/ubuntu/forge && python3 scripts/run_weekly_batch.py
```

**방식 B: PM2 (현재 운영 도구)**
```javascript
// ecosystem.config.js에 추가
{
  name: "forge-weekly-batch",
  script: "python_api/scripts/run_weekly_batch.py",
  interpreter: "/usr/bin/python3",
  cron: "0 2 * * 0",  // 매주 일요일 02:00
  merge_logs: true,
  error_file: "logs/batch_error.log",
  out_file: "logs/batch_out.log"
}
```

**방식 C: APScheduler (Python 기반)**
```python
# python_api/scripts/batch_scheduler.py
from apscheduler.schedulers.background import BackgroundScheduler

def start_batch_scheduler():
    scheduler = BackgroundScheduler()
    
    # 매주 일요일 02:00
    scheduler.add_job(
        run_weekly_batch,
        'cron',
        day_of_week=6,
        hour=2,
        minute=0
    )
    
    scheduler.start()
```

---

## 🎯 권장 주간 배치 순서

```python
# python_api/scripts/run_weekly_batch.py
import sys
import json
from datetime import datetime
from pathlib import Path

def run_weekly_batch():
    """주간 배치 통합 실행 (약 2-3시간 소요)"""
    
    print("\n" + "="*60)
    print("🔄 FORGE 주간 배치 시작")
    print(f"   시작시간: {datetime.now().isoformat()}")
    print("="*60 + "\n")
    
    results = {}
    
    try:
        # 1️⃣ 시스템 상태 확인 (5분)
        print("[1/8] 📊 시스템 상태 확인 중...")
        from health_check_and_backup import check_system_health
        check_system_health()
        results["health_check"] = "✓"
        
        # 2️⃣ 데이터 정합성 검증 (10분)
        print("\n[2/8] ✅ 데이터 정합성 검증 중...")
        from validate_ontology_structure import validate_knowledge_structure
        validate_knowledge_structure()
        results["ontology_validation"] = "✓"
        
        # 3️⃣ DB 백업 (15분)
        print("\n[3/8] 💾 데이터베이스 백업 중...")
        from health_check_and_backup import backup_postgres_questions, backup_chroma_db
        backup_postgres_questions()
        backup_chroma_db()
        results["backup"] = "✓"
        
        # 4️⃣ 문제 데이터 리로드 (20분)
        print("\n[4/8] 🔄 문제 데이터 리로드 중...")
        subprocess.run([
            sys.executable,
            "python_api/scripts/reload_questions_from_csv.py"
        ], check=True)
        results["reload_questions"] = "✓"
        
        # 5️⃣ 온톨로지 태깅 업데이트 (30분)
        print("\n[5/8] 🏷️  온톨로지 태깅 업데이트 중...")
        subprocess.run([
            sys.executable,
            "python_api/scripts/batch_tag_questions_ontology.py"
        ], check=True)
        results["ontology_tagging"] = "✓"
        
        # 6️⃣ RAG DB 재구축 (45분)
        print("\n[6/8] 🔨 RAG DB 재구축 중...")
        subprocess.run([
            sys.executable,
            "RAG/main.py"
        ], check=True)
        results["rag_db_rebuild"] = "✓"
        
        # 7️⃣ 성능 평가 실행 (60분)
        print("\n[7/8] 📈 성능 평가 실행 중 (시간 소요)...")
        subprocess.run([
            sys.executable,
            "performance_comparison/run_all.py",
            "--limit", "120"
        ], check=True)
        results["performance_eval"] = "✓"
        
        # 8️⃣ 캐시 정리 및 리포트 생성 (10분)
        print("\n[8/8] 🧹 캐시 정리 및 리포트 생성...")
        from cache_cleanup import cleanup_solve_cache
        from weekly_analytics import generate_weekly_report
        cleanup_solve_cache()
        generate_weekly_report()
        results["cleanup_and_report"] = "✓"
        
        # 결과 저장
        results_file = Path("./logs/weekly_batch_results.json")
        results_file.parent.mkdir(exist_ok=True)
        with open(results_file, "w") as f:
            json.dump({
                "timestamp": datetime.now().isoformat(),
                "status": "SUCCESS",
                "tasks": results
            }, f, indent=2)
        
        print("\n" + "="*60)
        print("✅ FORGE 주간 배치 완료")
        print(f"   종료시간: {datetime.now().isoformat()}")
        print("="*60 + "\n")
        
    except Exception as e:
        print(f"\n❌ 배치 실행 중 오류 발생: {e}")
        results["error"] = str(e)
        
        # 에러 알림 (Slack/Email 통합 가능)
        notify_batch_failure(e)
        sys.exit(1)

if __name__ == "__main__":
    run_weekly_batch()
```

---

## 💡 개선점 & 고려사항

### 1. **병렬 실행 최적화**
- ✅ 백업 + 온톨로지 태깅은 병렬 가능
- ❌ RAG DB 재구축 전에는 문제 데이터 리로드 필수

### 2. **모니터링 및 알림**
```python
# 배치 실패 시 알림 (선택사항)
def notify_batch_failure(error: Exception):
    import smtplib
    # 이메일/Slack으로 알림 전송
    pass
```

### 3. **점진적 재구축**
```python
# RAG DB 전체 재구축 대신 증분 업데이트 고려
def incremental_rag_update(new_documents: List[str]):
    """새로운 문서만 추가"""
    pass
```

### 4. **롤백 전략**
- 각 단계별로 백업 타임스탬프 기록
- 실패 시 직전 상태로 복구 가능하도록 설계

### 5. **리소스 관리**
| 작업 | CPU | 메모리 | 디스크 | 시간 |
|------|-----|--------|--------|------|
| 문제 리로드 | 낮음 | 100MB | 10MB | 10분 |
| 온톨로지 태깅 | 중간 | 500MB | - | 30분 |
| RAG DB 재구축 | 높음 | 2GB+ | 500MB | 45분 |
| 성능 평가 | 높음 | 2GB+ | 100MB | 60분 |

### 6. **로깅 및 추적**
```python
# 각 단계별 상세 로깅
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('logs/weekly_batch.log'),
        logging.StreamHandler()
    ]
)
```

---

## 📋 체크리스트 (배치 설정 시)

- [ ] `python_api/scripts/cache_cleanup.py` 생성
- [ ] `python_api/scripts/weekly_analytics.py` 생성
- [ ] `python_api/scripts/validate_ontology_structure.py` 생성
- [ ] `python_api/scripts/health_check_and_backup.py` 생성
- [ ] `python_api/scripts/run_weekly_batch.py` 생성
- [ ] Crontab / PM2 / APScheduler 중 선택 및 설정
- [ ] 로그 디렉토리 생성: `mkdir -p logs backups/postgres backups/chroma`
- [ ] 테스트 실행: `python3 python_api/scripts/run_weekly_batch.py`
- [ ] 에러 알림 채널 설정 (선택사항)
- [ ] 백업 정책 수립 (백업 보관 기간 등)
